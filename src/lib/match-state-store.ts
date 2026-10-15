import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeMatchState, type DismissReason, type MatchChannel, type MatchEvent, type MatchState } from "@/lib/match-state";

/**
 * Eşleşme durumu YAZIMI (CRM-G4) — `demand_property_matches` için tek yazım yolu.
 * Tablo yoksa (migration henüz uygulanmadı) ya da yazım reddedilirse sessizce `false` döner: durum kaydı ana işi
 * (gönderim, gizleme bildirimi) asla bozmaz.
 */

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

function logWriteError(label: string, error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code && MISSING_TABLE.has(error.code)) return;
  console.error(label, { code: error.code });
}

export type RecordMatchEventInput = {
  tenantId: string;
  actorId: string;
  demandId: string;
  propertyId: string;
  customerId: string | null;
  event: MatchEvent;
  channel?: MatchChannel | null;
  score?: number | null;
  shareToken?: string | null;
  dismissReason?: DismissReason | null;
  dismissNote?: string | null;
};

/** Tek çift için olay yazar (oku → birleştir → upsert). Çağıranın oturumlu istemcisi (RLS) beklenir. */
export async function recordMatchEvent(supabase: SupabaseClient, input: RecordMatchEventInput): Promise<MatchState | null> {
  try {
    const { data: existing, error: readError } = await supabase
      .from("demand_property_matches")
      .select("state, sent_at, send_count")
      .eq("tenant_id", input.tenantId)
      .eq("demand_id", input.demandId)
      .eq("property_id", input.propertyId)
      .maybeSingle();
    if (readError) {
      logWriteError("recordMatchEvent read", readError);
      return null;
    }
    const current = existing as { state: MatchState; sent_at: string | null; send_count: number | null } | null;
    const state = mergeMatchState(current, input.event);
    const nowIso = new Date().toISOString();
    const row: Record<string, unknown> = {
      tenant_id: input.tenantId,
      demand_id: input.demandId,
      property_id: input.propertyId,
      customer_id: input.customerId,
      state,
      updated_at: nowIso,
    };
    if (input.event.kind === "send") {
      row.sent_at = nowIso;
      row.sent_by = input.actorId;
      row.send_count = Number(current?.send_count ?? 0) + 1;
      row.channel = input.channel ?? "link";
      if (input.score != null) row.score_at_send = Math.max(0, Math.min(100, Math.round(input.score)));
      if (input.shareToken) row.share_token = input.shareToken;
    }
    if (input.event.kind === "dismiss") {
      row.dismissed_at = nowIso;
      row.dismissed_by = input.actorId;
      row.dismiss_reason = input.dismissReason ?? "other";
      row.dismiss_note = input.dismissNote ? input.dismissNote.slice(0, 300) : null;
    }
    if (input.event.kind === "restore") {
      row.dismissed_at = null;
      row.dismissed_by = null;
      row.dismiss_reason = null;
      row.dismiss_note = null;
    }
    const { error } = await supabase.from("demand_property_matches").upsert(row, { onConflict: "demand_id,property_id" });
    if (error) {
      logWriteError("recordMatchEvent upsert", error);
      return null;
    }
    return state;
  } catch (e) {
    console.error("recordMatchEvent", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Yalnız kanal düzeltmesi (gönderim şeridinde WhatsApp/SMS seçildi): sayaç artmaz. */
export async function recordMatchChannel(
  supabase: SupabaseClient,
  input: { tenantId: string; demandId: string; propertyId: string; channel: MatchChannel },
): Promise<boolean> {
  const { error } = await supabase
    .from("demand_property_matches")
    .update({ channel: input.channel, updated_at: new Date().toISOString() })
    .eq("tenant_id", input.tenantId)
    .eq("demand_id", input.demandId)
    .eq("property_id", input.propertyId)
    .not("sent_at", "is", null);
  logWriteError("recordMatchChannel", error);
  return !error;
}

/**
 * Sistem önerisi ("suggested"): yalnız satırı OLMAYAN çiftler yazılır (var olan durum ezilmez). service_role istemcisi
 * (bildirim akışı) ile çağrılır; tenant_id her satırda açık.
 */
export async function recordSuggestedMatches(
  client: SupabaseClient,
  tenantId: string,
  pairs: { demandId: string; propertyId: string; customerId: string | null }[],
): Promise<void> {
  if (pairs.length === 0) return;
  const rows = pairs.map((p) => ({
    tenant_id: tenantId,
    demand_id: p.demandId,
    property_id: p.propertyId,
    customer_id: p.customerId,
    state: "suggested",
  }));
  const { error } = await client
    .from("demand_property_matches")
    .upsert(rows, { onConflict: "demand_id,property_id", ignoreDuplicates: true });
  logWriteError("recordSuggestedMatches", error);
}
