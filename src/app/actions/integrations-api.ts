"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import {
  deriveEndpointSecret,
  generateApiKey,
  hashApiKey,
  parseApiScopes,
  parseWebhookEvents,
  validateWebhookUrl,
} from "@/lib/integrations-api/core";
import { postWebhook, webhookSigningSecret } from "@/lib/integrations-api/webhooks";
import { actionErrorMessage } from "@/lib/action-errors";

const PATH = "/app/ayarlar/api-webhook";
const UUID = /^[0-9a-f-]{36}$/i;
const NOT_READY = "API/webhook altyapısı henüz etkin değil (veritabanı güncellemesi bekleniyor).";
const MAX_KEYS = 10;
const MAX_ENDPOINTS = 5;

export type IntegrationResult = { ok?: boolean; error?: string; key?: string; secret?: string; status?: number | null };

function missing(error: { code?: string | null } | null): boolean {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202"));
}

/** Yeni API anahtarı: tam anahtar YALNIZ bu yanıtta döner; DB'de sha256 özeti saklanır. */
export async function createApiKey(_prev: IntegrationResult, formData: FormData): Promise<IntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 80) return { error: "Anahtar adı 1-80 karakter olmalı." };
  const scopes = parseApiScopes(formData.getAll("scopes"));
  if (scopes.length === 0) return { error: "En az bir okuma kapsamı seçin." };
  const supabase = await createClient();
  const { count, error: countError } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", gate.tenantId)
    .is("revoked_at", null);
  if (countError) return { error: missing(countError) ? NOT_READY : actionErrorMessage(countError, "Anahtarlar okunamadı.") };
  if ((count ?? 0) >= MAX_KEYS) return { error: `En çok ${MAX_KEYS} etkin anahtar olabilir; kullanılmayanı iptal edin.` };
  const { key, prefix } = generateApiKey();
  const { error } = await supabase
    .from("api_keys")
    .insert({ tenant_id: gate.tenantId, name, key_prefix: prefix, key_hash: hashApiKey(key), scopes, created_by: gate.userId });
  if (error) return { error: missing(error) ? NOT_READY : actionErrorMessage(error, "Anahtar oluşturulamadı.") };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "api_key.create", entityType: "api_key", newValue: { prefix, scopes } });
  revalidatePath(PATH);
  return { ok: true, key };
}

export async function revokeApiKey(formData: FormData): Promise<IntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Anahtar bulunamadı." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .is("revoked_at", null);
  if (error) return { error: actionErrorMessage(error, "Anahtar iptal edilemedi.") };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "api_key.revoke", entityType: "api_key", entityId: id });
  revalidatePath(PATH);
  return { ok: true };
}

export async function createWebhookEndpoint(_prev: IntegrationResult, formData: FormData): Promise<IntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!webhookSigningSecret()) return { error: "Webhook kanalı kapalı: platform imza anahtarı (WEBHOOK_SIGNING_SECRET) tanımlı değil." };
  const url = validateWebhookUrl(formData.get("url"));
  if (!url.ok) return { error: url.error };
  const events = parseWebhookEvents(formData.getAll("events"));
  if (events.length === 0) return { error: "En az bir olay seçin." };
  const supabase = await createClient();
  const { count, error: countError } = await supabase
    .from("webhook_endpoints")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", gate.tenantId);
  if (countError) return { error: missing(countError) ? NOT_READY : actionErrorMessage(countError, "Uçlar okunamadı.") };
  if ((count ?? 0) >= MAX_ENDPOINTS) return { error: `En çok ${MAX_ENDPOINTS} webhook adresi tanımlanabilir.` };
  const { error } = await supabase.from("webhook_endpoints").insert({ tenant_id: gate.tenantId, url: url.url, events, created_by: gate.userId });
  if (error) return { error: missing(error) ? NOT_READY : actionErrorMessage(error, "Webhook eklenemedi.") };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "webhook.create", entityType: "webhook_endpoint", newValue: { host: new URL(url.url).host, events } });
  revalidatePath(PATH);
  return { ok: true };
}

export async function setWebhookActive(formData: FormData): Promise<IntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  if (!UUID.test(id)) return { error: "Webhook bulunamadı." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("webhook_endpoints")
    .update({ active, failure_count: 0, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: actionErrorMessage(error, "Webhook güncellenemedi.") };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: active ? "webhook.activate" : "webhook.deactivate", entityType: "webhook_endpoint", entityId: id });
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteWebhookEndpoint(formData: FormData): Promise<IntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Webhook bulunamadı." };
  const supabase = await createClient();
  const { error } = await supabase.from("webhook_endpoints").delete().eq("id", id).eq("tenant_id", gate.tenantId);
  if (error) return { error: actionErrorMessage(error, "Webhook silinemedi.") };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "webhook.delete", entityType: "webhook_endpoint", entityId: id });
  revalidatePath(PATH);
  return { ok: true };
}

/** İmza sırrını gösterir (saklanmaz, türetilir). `rotate=1` ise sürüm artırılır: eski sır hemen geçersiz olur. */
export async function revealWebhookSecret(formData: FormData): Promise<IntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const serverSecret = webhookSigningSecret();
  if (!serverSecret) return { error: "Webhook kanalı kapalı." };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Webhook bulunamadı." };
  const rotate = String(formData.get("rotate") ?? "") === "1";
  const supabase = await createClient();
  const { data: ep } = await supabase.from("webhook_endpoints").select("id, secret_version").eq("id", id).eq("tenant_id", gate.tenantId).maybeSingle();
  if (!ep) return { error: "Webhook bulunamadı." };
  let version = Number(ep.secret_version) || 1;
  if (rotate) {
    version += 1;
    const { error } = await supabase
      .from("webhook_endpoints")
      .update({ secret_version: version, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", gate.tenantId);
    if (error) return { error: actionErrorMessage(error, "İmza anahtarı yenilenemedi.") };
  }
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: rotate ? "webhook.secret_rotate" : "webhook.secret_reveal", entityType: "webhook_endpoint", entityId: id });
  if (rotate) revalidatePath(PATH);
  return { ok: true, secret: deriveEndpointSecret(serverSecret, id, version) };
}

/** Test olayı: kuyruğa yazmadan imzalı örnek gövdeyi hemen gönderir ve HTTP durumunu döndürür. */
export async function sendTestWebhook(formData: FormData): Promise<IntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const serverSecret = webhookSigningSecret();
  if (!serverSecret) return { error: "Webhook kanalı kapalı." };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Webhook bulunamadı." };
  const supabase = await createClient();
  const { data: ep } = await supabase.from("webhook_endpoints").select("id, url, secret_version").eq("id", id).eq("tenant_id", gate.tenantId).maybeSingle();
  if (!ep) return { error: "Webhook bulunamadı." };
  const checked = validateWebhookUrl(ep.url);
  if (!checked.ok) return { error: checked.error };
  const now = Math.floor(Date.now() / 1000);
  const outcome = await postWebhook(
    {
      id: `test-${now}`,
      endpointId: String(ep.id),
      url: checked.url,
      secretVersion: Number(ep.secret_version) || 1,
      payload: { event: "test", occurred_at: new Date().toISOString(), tenant_id: gate.tenantId, entity: null, data: { message: "EmlakSoft webhook test olayı" } },
    },
    serverSecret,
    now,
  );
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "webhook.test", entityType: "webhook_endpoint", entityId: id, newValue: { status: outcome.status } });
  return outcome.ok ? { ok: true, status: outcome.status } : { error: `Test başarısız: ${outcome.error ?? "bilinmeyen hata"}`, status: outcome.status };
}
