"use server";

import { createCustomer, type CustomerResult } from "@/app/actions/customers";
import { createCall, type CallResult } from "@/app/actions/calls";
import { createAppointment, type AppointmentResult } from "@/app/actions/appointments";
import { createProperty, type PropertyResult } from "@/app/actions/properties";
import { createDemand } from "@/app/actions/demands";
import { createTask } from "@/app/actions/tasks";
import { getSetting } from "@/lib/settings/read";
import { DEFAULT_COMMISSION_RATE } from "@/lib/commission";
import { requirePermission } from "@/lib/require-permission";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { createClient } from "@/lib/supabase/server";
import { parseTrLocalDateTime, toTrLocalInput } from "@/lib/clock";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { isOwnerSideCustomerType } from "@/lib/demand-criteria";
import { validateGeoChain } from "@/lib/geo/reader";
import { isValidPoint, suggestGeoForPoint, type GeoPointSuggestion } from "@/lib/geo/nearest";
import { onceByRequest, readRequestId, scopeMismatchError, supabaseSubmissionStore, type SubmissionKind } from "@/lib/field-capture/submission-guard";
import { extractNoteFieldsForTenant, NOTE_FIELDS_MAX_TEXT } from "@/lib/field-capture/note-fields-server";
import type { NoteFieldSuggestions } from "@/lib/field-capture/note-fields";
import { QUICK_INTENT_TYPES, QUICK_INTENT_TRANSACTION, buildQuickPropertyTitle, type QuickIntent } from "./quick-intents";

/**
 * Hızlı kayıt sarmalayıcıları: doğrulama, yetki, otomasyon ve çakışma freni mevcut
 * server action'larda KALIR (createCustomer / createCall / createAppointment);
 * burada yalnız hızlı formun alanları o action'ların FormData sözleşmesine çevrilir.
 *
 * Saha: her form bir istek kimliği (`client_request_id`) taşır; çevrimdışı kuyruk aynı isteği yeniden gönderse de
 * `onceByRequest` ikinci kaydı açmaz (bkz. src/lib/field-capture/submission-guard.ts). Nottan çıkarılan ve kullanıcının
 * ONAYLADIĞI öneriler `fx_*` alanlarıyla gelir: müşteri kaydından sonra talep (bütçe/oda/bölge) ve takip görevi açılır.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ek işlem özeti: ana kayıt açıldı, onaylanan öneriler ayrıca uygulandı (ya da neden uygulanamadı). */
export type QuickExtras = { applied?: string[]; skipped?: string[] };

async function guarded<T extends { ok?: boolean; id?: string; error?: string }>(
  formData: FormData,
  kind: SubmissionKind,
  gateModule: "customers" | "calls" | "appointments" | "properties",
  run: () => Promise<T>,
): Promise<T | { ok?: boolean; id?: string; error?: string }> {
  const requestId = readRequestId(formData);
  const claimsScope = formData.has("client_tenant_id") || formData.has("client_user_id");
  if (!requestId && !claimsScope) return run();
  const gate = await requirePermission(gateModule, "create");
  if (!gate.ok) return { error: gate.error };
  // Kuyruk öğesi başka oturumda (kullanıcı/ofis) sıraya alındıysa bu oturumun adına kayıt AÇILMAZ.
  const mismatch = scopeMismatchError(formData, { tenantId: gate.tenantId, userId: gate.userId });
  if (mismatch) return { error: mismatch };
  if (!requestId) return run();
  return onceByRequest(supabaseSubmissionStore(await createClient()), { tenantId: gate.tenantId, userId: gate.userId }, kind, requestId, run);
}

/** Onaylanan takip görevi (müşteriye bağlı). Yetki yoksa ya da hata olursa ana kaydı bozmaz. */
async function applyApprovedTask(formData: FormData, customerId: string | null, extras: QuickExtras) {
  const title = String(formData.get("fx_task_title") ?? "").trim().slice(0, 200);
  if (!title) return;
  const fd = new FormData();
  fd.set("title", title);
  fd.set("kind", /\bara/i.test(title) ? "call" : "followup");
  fd.set("priority", "normal");
  const due = parseTrLocalDateTime(String(formData.get("fx_task_due") ?? ""));
  if (due) fd.set("due_at", toTrLocalInput(due));
  if (customerId) fd.set("customer_id", customerId);
  const res = await createTask({}, fd);
  if (res.ok) (extras.applied ??= []).push("Takip görevi açıldı");
  else (extras.skipped ??= []).push(`Görev açılamadı: ${res.error ?? "bilinmeyen hata"}`);
}

export async function quickCreateCustomer(formData: FormData): Promise<CustomerResult & QuickExtras> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!fullName) return { error: "Ad soyad zorunlu." };
  if (!phone) return { error: "Telefon zorunlu." };

  const intent = String(formData.get("intent") ?? "") as QuickIntent;
  const type = QUICK_INTENT_TYPES[intent];
  const out = new FormData();
  out.set("full_name", fullName);
  out.set("phone", phone);
  if (type) out.set("type", type);
  out.set("notes", String(formData.get("notes") ?? ""));

  return guarded(formData, "customer", "customers", async () => {
    const res = await createCustomer({}, out);
    if (!res.ok || !res.id) return res;
    const extras: QuickExtras = {};

    // Onaylanan talep önerisi (alıcı/kiracı tarafı): bütçe, oda, bölge → talep kaydı (createDemand doğrular).
    const demand = new FormData();
    demand.set("customer_id", res.id);
    let hasDemand = false;
    for (const [from, to] of [
      ["fx_budget_min", "budget_min"],
      ["fx_budget_max", "budget_max"],
      ["fx_rooms", "rooms"],
      ["fx_province_id", "demand_province_id"],
      ["fx_district_id", "demand_district_id"],
      ["fx_neighborhood_id", "demand_neighborhood_id"],
    ] as const) {
      const v = String(formData.get(from) ?? "").trim().slice(0, 64);
      if (v) {
        demand.set(to, v);
        hasDemand = true;
      }
    }
    const tx = QUICK_INTENT_TRANSACTION[intent];
    if (hasDemand && tx && !isOwnerSideCustomerType(type)) {
      demand.set("transaction_type", tx);
      const d = await createDemand({}, demand);
      if (d.ok) (extras.applied ??= []).push("Talep açıldı");
      else (extras.skipped ??= []).push(`Talep açılamadı: ${d.error ?? "bilinmeyen hata"}`);
    }
    await applyApprovedTask(formData, res.id, extras);
    return { ...res, ...extras };
  });
}

export async function quickLogCall(formData: FormData): Promise<CallResult & QuickExtras> {
  const customerId = String(formData.get("customer_id") ?? "").trim();
  let phone = String(formData.get("phone") ?? "").trim();

  if (!customerId && !phone) return { error: "Müşteri seçin ya da telefon girin." };
  if (phone) {
    const parsed = parsePhoneStrict(phone);
    if (!parsed.ok) return { error: parsed.error ?? PHONE_ERROR_MESSAGE };
  } else {
    // Telefon girilmediyse seçilen müşterinin kayıtlı numarası kullanılır (RLS + müşteri görüntüleme izni).
    const gate = await requirePermission("customers", "view");
    if (!gate.ok) return { error: gate.error };
    const supabase = await createClient();
    const { data } = await supabase
      .from("customers")
      .select("phone")
      .eq("id", customerId)
      .is("deleted_at", null)
      .maybeSingle();
    phone = data?.phone ?? "";
    if (!phone) return { error: "Bu müşterinin kayıtlı telefonu yok. Telefon numarasını girin." };
  }

  const out = new FormData();
  out.set("customer_id", customerId);
  out.set("phone", phone);
  out.set("direction", String(formData.get("direction") ?? "outbound"));
  out.set("disposition", String(formData.get("disposition") ?? ""));
  out.set("notes", String(formData.get("notes") ?? ""));
  return guarded(formData, "call", "calls", async () => {
    const res = await createCall(out);
    if (!res.ok) return res;
    const extras: QuickExtras = {};
    await applyApprovedTask(formData, UUID_RE.test(customerId) ? customerId : null, extras);
    return { ...res, ...extras };
  });
}

export async function quickCreateAppointment(formData: FormData): Promise<AppointmentResult> {
  const when = parseTrLocalDateTime(String(formData.get("when") ?? ""));
  if (!when) return { error: "Geçerli bir tarih ve saat girin." };
  const [date, time] = toTrLocalInput(when).split("T");

  const out = new FormData();
  out.set("customer_id", String(formData.get("customer_id") ?? ""));
  out.set("property_id", String(formData.get("property_id") ?? ""));
  out.set("appointment_type", String(formData.get("appointment_type") ?? ""));
  out.set("date", date);
  out.set("time", time);
  if (formData.get("confirm_conflict") === "1") out.set("confirm_conflict", "1");
  return guarded(formData, "appointment", "appointments", () => createAppointment(out));
}

/**
 * Sahadan hızlı portföy: tür, işlem, fiyat, oda, m², konum (isteğe bağlı) → TASLAK portföy (createProperty zaten `draft`
 * açar; mükerrer freni, havuz yönlendirmesi, fiyat sağlığı, eşleşme bildirimi orada). Başlık otomatik, komisyon oranı ofis
 * varsayılanı (`office.commission.default_rate`); ikisi de tam formda değiştirilir. Fotoğraf, dönen kimlikle aynı ekranda
 * mevcut medya yükleyicisiyle (filigran + küçültme + belge türü) eklenir. GPS'ten önerilen ve kullanıcının UYGULADIĞI
 * il/ilçe/mahalle zinciri doğrulanarak yazılır.
 */
export async function quickCreateProperty(formData: FormData): Promise<PropertyResult> {
  const gate = await requirePermission("properties", "create");
  if (!gate.ok) return { error: gate.error };
  const transactionType = String(formData.get("transaction_type") ?? "").trim();
  const propertyType = String(formData.get("property_type") ?? "").trim();
  if (!transactionType || !propertyType) return { error: "İşlem ve portföy türü seçin." };
  const rooms = String(formData.get("rooms") ?? "").trim().slice(0, 20);
  const sqmRaw = String(formData.get("sqm") ?? "").trim().replace(",", ".");
  const sqm = sqmRaw ? Number(sqmRaw) : null;
  if (sqm !== null && (!Number.isFinite(sqm) || sqm <= 0 || sqm > 1_000_000)) return { error: "Geçerli bir m² girin." };

  const chain = {
    province_id: String(formData.get("province_id") ?? "").trim(),
    district_id: String(formData.get("district_id") ?? "").trim(),
    neighborhood_id: String(formData.get("neighborhood_id") ?? "").trim(),
  };
  for (const v of Object.values(chain)) if (v && !UUID_RE.test(v)) return { error: "Konum önerisi geçersiz; yeniden konum alın." };
  if (chain.province_id || chain.district_id || chain.neighborhood_id) {
    const geoError = await validateGeoChain({
      province_id: chain.province_id || null,
      district_id: chain.district_id || null,
      neighborhood_id: chain.neighborhood_id || null,
    });
    if (geoError) return { error: geoError };
  }

  const rate = Number(await getSetting<number>("office.commission.default_rate", { tenantId: gate.tenantId }).catch(() => DEFAULT_COMMISSION_RATE));
  const out = new FormData();
  out.set("title", buildQuickPropertyTitle({ rooms, propertyType, transactionType, sqm }));
  out.set("transaction_type", transactionType);
  out.set("property_type", propertyType);
  out.set("list_price", String(formData.get("list_price") ?? ""));
  out.set("commission_rate", String(Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_COMMISSION_RATE));
  out.set("rooms", rooms);
  if (sqm !== null) out.set("sqm", String(sqm));
  for (const k of ["lat", "lng", "address_line"]) out.set(k, String(formData.get(k) ?? "").slice(0, 200));
  for (const [k, v] of Object.entries(chain)) if (v) out.set(k, v);
  if (formData.get("allow_duplicate") === "1") out.set("allow_duplicate", "1");
  return guarded(formData, "property", "properties", () => createProperty(out));
}

/* ------------------------------ Saha yardımcıları ------------------------------ */

export type QuickLocationResult = { ok: true; suggestion: GeoPointSuggestion | null } | { ok: false; error: string };

/** GPS konumundan il/ilçe/mahalle önerisi (yalnız öneri; forma kullanıcı uygular). */
export async function suggestQuickLocation(lat: number, lng: number): Promise<QuickLocationResult> {
  const gate = await requirePermission("properties", "create");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!isValidPoint(lat, lng)) return { ok: false, error: "Konum geçersiz." };
  try {
    return { ok: true, suggestion: await suggestGeoForPoint(await createClient(), { lat, lng }) };
  } catch (e) {
    console.error("suggestQuickLocation", e instanceof Error ? e.message : "bilinmeyen hata");
    return { ok: false, error: "Konum önerisi şu an alınamadı." };
  }
}

export type QuickNoteFieldsResult =
  | { ok: true; fields: NoteFieldSuggestions; ai: "kapali" | "kullanildi" | "gerek-yok" | "hata" }
  | { ok: false; error: string };

/**
 * Not / sesli not dökümünden alan önerisi (bütçe, oda, bölge, randevu tarihi, sonraki görev). Kural tabanlı; ofiste
 * "Sesli not ve AI özeti" açık ve anahtar/kota varsa AI eksikleri tamamlar. Hiçbir şey kaydedilmez.
 */
export async function extractQuickNoteFields(text: string): Promise<QuickNoteFieldsResult> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { ok: false, error: gate.error };
  const body = String(text ?? "").trim().slice(0, NOTE_FIELDS_MAX_TEXT);
  if (!body) return { ok: false, error: "Önce notu yazın ya da söyleyin." };
  const { fields, ai } = await extractNoteFieldsForTenant(body, { tenantId: gate.tenantId, userId: gate.userId, allowAi: true });
  return { ok: true, fields, ai };
}
