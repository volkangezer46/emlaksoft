import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchExternal } from "@/lib/external-fetch";
import { deriveEndpointSecret, signWebhookBody, signingSecretReady, type WebhookEvent } from "@/lib/integrations-api/core";

/**
 * Giden webhook teslimi. Olay üretimi server action'ların başarılı yazmasından SONRA `after()` içinde yapılır
 * (yanıtı geciktirmez, hata asıl işlemi bozmaz). Akış: `webhook_enqueue` RPC (oturumlu istemci; veri kayıttan, örnek kayıt
 * olay üretmez) → anında imzalı POST (5 sn) → `webhook_mark_delivery`. Başarısızlar `public-mutation-outbox` cron'unun
 * adımıyla (`runWebhookRetries`, çağıranın service_role istemcisi) geri çekilmeli yeniden denenir (en çok 6 deneme).
 * `WEBHOOK_SIGNING_SECRET` yoksa kanal KAPALI: kuyruğa da yazılmaz.
 */

const TIMEOUT_MS = 5_000;

export function webhookSigningSecret(): string | null {
  const s = process.env.WEBHOOK_SIGNING_SECRET;
  return signingSecretReady(s) ? s : null;
}

export type DeliveryTarget = { id: string; endpointId: string; url: string; secretVersion: number; payload: unknown };
export type DeliveryOutcome = { ok: boolean; status: number | null; error: string | null };

export async function postWebhook(target: DeliveryTarget, serverSecret: string, nowSeconds: number): Promise<DeliveryOutcome> {
  const body = JSON.stringify(target.payload);
  const secret = deriveEndpointSecret(serverSecret, target.endpointId, target.secretVersion);
  const event = (target.payload as { event?: string } | null)?.event ?? "unknown";
  try {
    const res = await fetchExternal(
      target.url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "EmlakSoft-Webhook/1",
          "X-EmlakSoft-Event": event,
          "X-EmlakSoft-Delivery": target.id,
          "X-EmlakSoft-Signature": signWebhookBody(secret, nowSeconds, body),
        },
        body,
      },
      { timeoutMs: TIMEOUT_MS },
    );
    // Gövde okunmaz (boyut/zaman sınırı); bağlantı kapatılır.
    await res.body?.cancel().catch(() => undefined);
    return { ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    return { ok: false, status: null, error: name === "TimeoutError" || name === "AbortError" ? "Zaman aşımı" : "Bağlantı hatası" };
  }
}

type EnqueueRow = { delivery_id: string; endpoint_id: string; url: string; secret_version: number; payload: unknown };

/**
 * Olay bildir (server action'dan çağrılır; asla fırlatmaz). Çağrı yanıt gönderildikten sonra çalışır.
 */
export function emitWebhook(event: WebhookEvent, entityType: "customer" | "property" | "deal", entityId: string | null | undefined): void {
  if (!entityId) return;
  const serverSecret = webhookSigningSecret();
  if (!serverSecret) return;
  try {
    after(async () => {
      try {
        const db = await createClient();
        const { data, error } = await db.rpc("webhook_enqueue", { p_event: event, p_entity_type: entityType, p_entity_id: entityId });
        if (error || !Array.isArray(data) || data.length === 0) return;
        const now = Math.floor(Date.now() / 1000);
        await Promise.all(
          (data as EnqueueRow[]).map(async (r) => {
            const outcome = await postWebhook(
              { id: r.delivery_id, endpointId: r.endpoint_id, url: r.url, secretVersion: r.secret_version, payload: r.payload },
              serverSecret,
              now,
            );
            await db.rpc("webhook_mark_delivery", { p_id: r.delivery_id, p_ok: outcome.ok, p_status: outcome.status, p_error: outcome.error });
          }),
        );
      } catch {
        /* teslim cron'da yeniden denenir */
      }
    });
  } catch {
    /* after() bağlam dışı (test/betik): olay atlanır */
  }
}

/**
 * Bekleyen teslimleri yeniden dener (cron adımı). İstemci ÇAĞIRANDAN gelir (cron'un mevcut service_role istemcisi);
 * sorgular tablo düzeyinde (tenant_id taşınır). Çalıştırma başına en çok `limit` satır.
 */
export async function runWebhookRetries(db: SupabaseClient, nowMs: number, limit = 40): Promise<{ attempted: number; delivered: number; skipped: boolean }> {
  const serverSecret = webhookSigningSecret();
  if (!serverSecret) return { attempted: 0, delivered: 0, skipped: true };
  const nowIso = new Date(nowMs).toISOString();
  const { data: rows, error } = await db
    .from("webhook_deliveries")
    .select("id, tenant_id, endpoint_id, payload, attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(limit);
  if (error || !rows || rows.length === 0) return { attempted: 0, delivered: 0, skipped: Boolean(error) };
  const endpointIds = [...new Set(rows.map((r) => String(r.endpoint_id)))];
  const { data: endpoints } = await db.from("webhook_endpoints").select("id, tenant_id, url, active, secret_version, failure_count").in("id", endpointIds);
  const byId = new Map(((endpoints ?? []) as { id: string; tenant_id: string; url: string; active: boolean; secret_version: number; failure_count: number }[]).map((e) => [e.id, e]));
  let delivered = 0;
  const now = Math.floor(nowMs / 1000);
  for (const r of rows as { id: string; tenant_id: string; endpoint_id: string; payload: unknown; attempts: number }[]) {
    const ep = byId.get(r.endpoint_id);
    if (!ep || ep.tenant_id !== r.tenant_id || !ep.active) {
      await db.from("webhook_deliveries").update({ status: "failed", last_error: "Uç kapalı veya silindi" }).eq("id", r.id).eq("tenant_id", r.tenant_id);
      continue;
    }
    const outcome = await postWebhook({ id: r.id, endpointId: ep.id, url: ep.url, secretVersion: ep.secret_version, payload: r.payload }, serverSecret, now);
    const attempts = r.attempts + 1;
    const backoffMin = Math.min(720, 2 ** attempts * 5);
    await db
      .from("webhook_deliveries")
      .update({
        attempts,
        status: outcome.ok ? "delivered" : attempts >= 6 ? "failed" : "pending",
        delivered_at: outcome.ok ? nowIso : null,
        next_attempt_at: new Date(nowMs + backoffMin * 60_000).toISOString(),
        last_status_code: outcome.status,
        last_error: outcome.ok ? null : (outcome.error ?? "").slice(0, 300),
      })
      .eq("id", r.id)
      .eq("tenant_id", r.tenant_id);
    await db
      .from("webhook_endpoints")
      .update({ last_status: outcome.status, last_delivery_at: nowIso, failure_count: outcome.ok ? 0 : ep.failure_count + 1 })
      .eq("id", ep.id)
      .eq("tenant_id", ep.tenant_id);
    if (outcome.ok) delivered += 1;
  }
  return { attempted: rows.length, delivered, skipped: false };
}
