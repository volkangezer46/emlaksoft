"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now, trDayKey } from "@/lib/clock";
import { parsePhoneStrict } from "@/lib/phone-rules";
import {
  diffByKey,
  isUuid,
  isValidDay,
  parseWorkProfile,
  pausedUntilIso,
  regionKey,
  specialtyKey,
  validateRegions,
  validateSpecialties,
  type Parsed,
  type RegionRow,
  type SpecialtyRow,
} from "@/lib/advisor/advisor-profile";
import { allowedFromOptions, isAdvisorSchemaMissing, loadSpecialtyOptions } from "@/lib/advisor/advisor-store";
import { changedFieldNames, ibanError, last4, normalizeIban, normalizeTc, tcError } from "@/lib/advisor/pii-mask";
import {
  decryptPii,
  encryptPii,
  getPiiKeyFromEnv,
  PII_DISABLED_MESSAGE,
  PII_KEY_VERSION,
  piiAad,
  type PiiField,
} from "@/lib/advisor/pii-crypto";

export type AdvisorProfileResult = { ok?: boolean; error?: string; message?: string; warnings?: string[] };
export type RevealResult = { ok: true; value: string } | { ok: false; error: string };

const NOT_READY = "Danışman profili bu ortamda henüz etkin değil.";
const OWNER_ONLY = "Bu işlemi yalnız ofis sahibi veya genel müdür yapabilir.";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Ctx = { tenantId: string; actorId: string };

const isManagerRole = (role: string) => role === "owner" || role === "gm";

function dbError(scope: string, error: { message?: string; code?: string }, fallback: string): string {
  if (isAdvisorSchemaMissing(error)) return NOT_READY;
  console.error(scope, error.message);
  return fallback;
}

async function targetInTenant(supabase: Supabase, tenantId: string, profileId: string): Promise<boolean> {
  if (!isUuid(profileId)) return false;
  const { data } = await supabase.from("profiles").select("id").eq("id", profileId).eq("tenant_id", tenantId).maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------------------
// İç yazıcılar (yetki kapısı çağıran action'da geçilmiştir)
// ---------------------------------------------------------------------------

async function writeWork(supabase: Supabase, ctx: Ctx, profileId: string, fd: FormData): Promise<AdvisorProfileResult> {
  const parsed = parseWorkProfile({ get: (k) => (fd.get(k) === null ? null : String(fd.get(k))), getAll: (k) => fd.getAll(k).map(String) });
  if (!parsed.ok) return { error: parsed.error };
  const { pool_paused_until_day, ...rest } = parsed.value;
  const { error } = await supabase.from("advisor_profiles").upsert(
    {
      tenant_id: ctx.tenantId,
      profile_id: profileId,
      ...rest,
      pool_paused_until: pausedUntilIso(pool_paused_until_day),
    },
    { onConflict: "profile_id" },
  );
  if (error) return { error: dbError("saveAdvisorWorkProfile", error, "İş profili kaydedilemedi.") };
  await logActivity({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: "advisor_profile.updated",
    entityType: "profile",
    entityId: profileId,
    newValue: { fields: Object.keys(rest).sort() },
  });
  return { ok: true };
}

function parseJson(raw: FormDataEntryValue | null): unknown {
  if (raw === null || String(raw).trim() === "") return [];
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

async function writeSpecialties(supabase: Supabase, ctx: Ctx, profileId: string, raw: unknown): Promise<AdvisorProfileResult> {
  const allowed = allowedFromOptions(await loadSpecialtyOptions());
  const parsed: Parsed<SpecialtyRow[]> = validateSpecialties(raw, allowed);
  if (!parsed.ok) return { error: parsed.error };

  const { data: existingRaw, error: readError } = await supabase
    .from("advisor_specialties")
    .select("id, kind, value, transaction_type, level, price_min, price_max, experience_years")
    .eq("tenant_id", ctx.tenantId)
    .eq("profile_id", profileId);
  if (readError) return { error: dbError("saveAdvisorSpecialties", readError, "Uzmanlıklar okunamadı.") };
  const existing = ((existingRaw ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    kind: r.kind as SpecialtyRow["kind"],
    value: r.value as string,
    transaction_type: (r.transaction_type as SpecialtyRow["transaction_type"]) ?? null,
    level: Number(r.level) as SpecialtyRow["level"],
    price_min: r.price_min === null ? null : Number(r.price_min),
    price_max: r.price_max === null ? null : Number(r.price_max),
    experience_years: r.experience_years === null ? null : Number(r.experience_years),
  }));

  const diff = diffByKey<SpecialtyRow>(
    existing,
    parsed.value,
    specialtyKey,
    (a, b) => a.level !== b.level || a.price_min !== b.price_min || a.price_max !== b.price_max || a.experience_years !== b.experience_years,
  );

  if (diff.remove.length) {
    const { error } = await supabase.from("advisor_specialties").delete().eq("tenant_id", ctx.tenantId).eq("profile_id", profileId).in("id", diff.remove);
    if (error) return { error: dbError("saveAdvisorSpecialties.delete", error, "Uzmanlıklar kaydedilemedi.") };
  }
  for (const u of diff.update) {
    const { error } = await supabase
      .from("advisor_specialties")
      .update({ level: u.row.level, price_min: u.row.price_min, price_max: u.row.price_max, experience_years: u.row.experience_years })
      .eq("id", u.id)
      .eq("tenant_id", ctx.tenantId);
    if (error) return { error: dbError("saveAdvisorSpecialties.update", error, "Uzmanlıklar kaydedilemedi.") };
  }
  if (diff.insert.length) {
    const { error } = await supabase
      .from("advisor_specialties")
      .insert(diff.insert.map((r) => ({ ...r, tenant_id: ctx.tenantId, profile_id: profileId })));
    if (error) return { error: dbError("saveAdvisorSpecialties.insert", error, "Uzmanlıklar kaydedilemedi.") };
  }
  await logActivity({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: "advisor_specialties.updated",
    entityType: "profile",
    entityId: profileId,
    newValue: { added: diff.insert.length, updated: diff.update.length, removed: diff.remove.length },
  });
  return { ok: true };
}

/** İl > ilçe > mahalle bağları: ilçe seçilen ile, mahalle seçilen ilçeyle uyumlu olmalı (geo_* herkese açık okunur). */
async function checkRegionGeo(supabase: Supabase, rows: RegionRow[]): Promise<string | null> {
  const districtIds = [...new Set(rows.map((r) => r.district_id).filter((x): x is string => !!x))];
  const hoodIds = [...new Set(rows.map((r) => r.neighborhood_id).filter((x): x is string => !!x))];
  const provinceIds = [...new Set(rows.map((r) => r.province_id))];
  if (provinceIds.length) {
    const { data } = await supabase.from("geo_provinces").select("id").in("id", provinceIds);
    if ((data ?? []).length !== provinceIds.length) return "Seçilen il bulunamadı.";
  }
  const districtProvince = new Map<string, string>();
  if (districtIds.length) {
    const { data } = await supabase.from("geo_districts").select("id, province_id").in("id", districtIds);
    for (const d of (data ?? []) as { id: string; province_id: string }[]) districtProvince.set(d.id, d.province_id);
    if (districtProvince.size !== districtIds.length) return "Seçilen ilçe bulunamadı.";
  }
  const hoodDistrict = new Map<string, string>();
  if (hoodIds.length) {
    const { data } = await supabase.from("geo_neighborhoods").select("id, district_id").in("id", hoodIds);
    for (const h of (data ?? []) as { id: string; district_id: string }[]) hoodDistrict.set(h.id, h.district_id);
    if (hoodDistrict.size !== hoodIds.length) return "Seçilen mahalle bulunamadı.";
  }
  for (const r of rows) {
    if (r.district_id && districtProvince.get(r.district_id) !== r.province_id) return "İlçe, seçilen ile ait değil.";
    if (r.neighborhood_id && hoodDistrict.get(r.neighborhood_id) !== r.district_id) return "Mahalle, seçilen ilçeye ait değil.";
  }
  return null;
}

async function writeRegions(supabase: Supabase, ctx: Ctx, profileId: string, raw: unknown): Promise<AdvisorProfileResult> {
  const parsed = validateRegions(raw);
  if (!parsed.ok) return { error: parsed.error };
  const geoError = await checkRegionGeo(supabase, parsed.value);
  if (geoError) return { error: geoError };

  const { data: existingRaw, error: readError } = await supabase
    .from("advisor_regions")
    .select("id, province_id, district_id, neighborhood_id, weight")
    .eq("tenant_id", ctx.tenantId)
    .eq("profile_id", profileId);
  if (readError) return { error: dbError("saveAdvisorRegions", readError, "Bölgeler okunamadı.") };
  const existing = ((existingRaw ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    province_id: r.province_id as string,
    district_id: (r.district_id as string | null) ?? null,
    neighborhood_id: (r.neighborhood_id as string | null) ?? null,
    weight: Number(r.weight) as RegionRow["weight"],
  }));

  const diff = diffByKey<RegionRow>(existing, parsed.value, regionKey, (a, b) => a.weight !== b.weight);
  if (diff.remove.length) {
    const { error } = await supabase.from("advisor_regions").delete().eq("tenant_id", ctx.tenantId).eq("profile_id", profileId).in("id", diff.remove);
    if (error) return { error: dbError("saveAdvisorRegions.delete", error, "Bölgeler kaydedilemedi.") };
  }
  for (const u of diff.update) {
    const { error } = await supabase.from("advisor_regions").update({ weight: u.row.weight }).eq("id", u.id).eq("tenant_id", ctx.tenantId);
    if (error) return { error: dbError("saveAdvisorRegions.update", error, "Bölgeler kaydedilemedi.") };
  }
  if (diff.insert.length) {
    const { error } = await supabase
      .from("advisor_regions")
      .insert(diff.insert.map((r) => ({ ...r, tenant_id: ctx.tenantId, profile_id: profileId })));
    if (error) return { error: dbError("saveAdvisorRegions.insert", error, "Bölgeler kaydedilemedi.") };
  }
  await logActivity({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: "advisor_regions.updated",
    entityType: "profile",
    entityId: profileId,
    newValue: { added: diff.insert.length, updated: diff.update.length, removed: diff.remove.length },
  });
  return { ok: true };
}

const PRIVATE_FIELD_NAMES = [
  "national_id",
  "birth_date",
  "address_line",
  "private_province_id",
  "private_district_id",
  "emergency_name",
  "emergency_phone",
  "emergency_relation",
  "bank_name",
  "iban_holder",
  "iban",
] as const;

function clean(fd: FormData, key: string, max: number): string | null {
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? null : v.slice(0, max);
}

/** Formda kimlik/kişisel alanlardan en az biri dolu mu (boş danışman için gereksiz satır yazılmaz). */
function hasPrivateInput(fd: FormData): boolean {
  return (
    PRIVATE_FIELD_NAMES.some((k) => String(fd.get(k) ?? "").trim() !== "") ||
    String(fd.get("clear_national_id") ?? "") === "1" ||
    String(fd.get("clear_iban") ?? "") === "1"
  );
}

async function writePrivate(supabase: Supabase, ctx: Ctx, profileId: string, fd: FormData): Promise<AdvisorProfileResult> {
  const birth = clean(fd, "birth_date", 10);
  if (birth && (!isValidDay(birth) || birth < "1900-01-01" || birth > trDayKey(now()))) {
    return { error: "Doğum tarihi geçerli bir geçmiş tarih olmalı." };
  }
  const provinceId = clean(fd, "private_province_id", 36);
  const districtId = clean(fd, "private_district_id", 36);
  if ((provinceId && !isUuid(provinceId)) || (districtId && !isUuid(districtId))) return { error: "İl veya ilçe geçersiz." };
  if (districtId && !provinceId) return { error: "İlçe için önce il seçilmeli." };
  if (districtId && provinceId) {
    const { data } = await supabase.from("geo_districts").select("province_id").eq("id", districtId).maybeSingle();
    if (!data || data.province_id !== provinceId) return { error: "İlçe, seçilen ile ait değil." };
  }

  const phoneRaw = String(fd.get("emergency_phone") ?? "").trim();
  let emergencyPhone: string | null = null;
  if (phoneRaw) {
    const p = parsePhoneStrict(phoneRaw);
    if (!p.ok) return { error: p.error ?? "Acil durum telefonu geçersiz." };
    emergencyPhone = p.stored;
  }

  const payload: Record<string, unknown> = {
    tenant_id: ctx.tenantId,
    profile_id: profileId,
    birth_date: birth,
    address_line: clean(fd, "address_line", 400),
    province_id: provinceId,
    district_id: districtId,
    emergency_name: clean(fd, "emergency_name", 120),
    emergency_phone: emergencyPhone,
    emergency_relation: clean(fd, "emergency_relation", 60),
    bank_name: clean(fd, "bank_name", 80),
    iban_holder: clean(fd, "iban_holder", 120),
  };

  // TC ve IBAN: yalnız anahtar varsa; açık değer bu fonksiyondan çıkmaz (şifreli metin + son 4).
  const tcRaw = normalizeTc(String(fd.get("national_id") ?? ""));
  const ibanRaw = normalizeIban(String(fd.get("iban") ?? ""));
  const clearTc = String(fd.get("clear_national_id") ?? "") === "1";
  const clearIban = String(fd.get("clear_iban") ?? "") === "1";
  if (tcRaw || ibanRaw) {
    const key = getPiiKeyFromEnv();
    if (!key) return { error: `TC kimlik / IBAN kaydedilemedi. ${PII_DISABLED_MESSAGE}.` };
    if (tcRaw) {
      const err = tcError(tcRaw);
      if (err) return { error: err };
      payload.national_id_enc = encryptPii(tcRaw, key, piiAad(profileId, "national_id"));
      payload.national_id_last4 = last4(tcRaw);
    }
    if (ibanRaw) {
      const err = ibanError(ibanRaw);
      if (err) return { error: err };
      payload.iban_enc = encryptPii(ibanRaw, key, piiAad(profileId, "iban"));
      payload.iban_last4 = last4(ibanRaw);
    }
    payload.enc_key_version = PII_KEY_VERSION;
  }
  if (clearTc && !tcRaw) {
    payload.national_id_enc = null;
    payload.national_id_last4 = null;
  }
  if (clearIban && !ibanRaw) {
    payload.iban_enc = null;
    payload.iban_last4 = null;
  }

  const { error } = await supabase.from("advisor_private").upsert(payload, { onConflict: "profile_id" });
  if (error) return { error: dbError("saveAdvisorPrivate", error, "Kimlik ve kişisel bilgiler kaydedilemedi.") };

  // Yalnız alan ADLARI (değer asla; açık TC/IBAN loga girmez).
  const names = changedFieldNames({
    ...Object.fromEntries(Object.entries(payload).filter(([k]) => k !== "tenant_id" && k !== "profile_id" && k !== "national_id_enc" && k !== "iban_enc" && k !== "national_id_last4" && k !== "iban_last4" && k !== "enc_key_version")),
    ...(tcRaw || clearTc ? { national_id: 1 } : {}),
    ...(ibanRaw || clearIban ? { iban: 1 } : {}),
  });
  await logActivity({
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    action: "advisor_private.updated",
    entityType: "profile",
    entityId: profileId,
    newValue: { fields: names },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Dışa açık action'lar
// ---------------------------------------------------------------------------

/** İş profili (istihdam, belgeler, kapasite, mesai, havuz). Yalnız ofis sahibi / genel müdür. */
export async function saveAdvisorWorkProfile(profileId: string, formData: FormData): Promise<AdvisorProfileResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda danışman profili düzenlenemez." };
  if (!isManagerRole(gate.role)) return { error: OWNER_ONLY };
  const supabase = await createClient();
  if (!(await targetInTenant(supabase, gate.tenantId, profileId))) return { error: "Danışman bu ofise ait değil." };
  const res = await writeWork(supabase, { tenantId: gate.tenantId, actorId: gate.userId }, profileId, formData);
  if (res.ok) revalidatePath(`/app/ekip/${profileId}`);
  return res.ok ? { ok: true, message: "İş profili kaydedildi." } : res;
}

/** Uzmanlık satırlarının tamamını eşitler (JSON dizisi). Yalnız ofis sahibi / genel müdür. */
export async function saveAdvisorSpecialties(profileId: string, specialtiesJson: string): Promise<AdvisorProfileResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda danışman profili düzenlenemez." };
  if (!isManagerRole(gate.role)) return { error: OWNER_ONLY };
  const supabase = await createClient();
  if (!(await targetInTenant(supabase, gate.tenantId, profileId))) return { error: "Danışman bu ofise ait değil." };
  const raw = parseJson(specialtiesJson);
  if (raw === null) return { error: "Uzmanlık listesi okunamadı." };
  const res = await writeSpecialties(supabase, { tenantId: gate.tenantId, actorId: gate.userId }, profileId, raw);
  if (res.ok) revalidatePath(`/app/ekip/${profileId}`);
  return res.ok ? { ok: true, message: "Uzmanlıklar kaydedildi." } : res;
}

/** Bölge satırlarının tamamını eşitler (JSON dizisi). Yalnız ofis sahibi / genel müdür. */
export async function saveAdvisorRegions(profileId: string, regionsJson: string): Promise<AdvisorProfileResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda danışman profili düzenlenemez." };
  if (!isManagerRole(gate.role)) return { error: OWNER_ONLY };
  const supabase = await createClient();
  if (!(await targetInTenant(supabase, gate.tenantId, profileId))) return { error: "Danışman bu ofise ait değil." };
  const raw = parseJson(regionsJson);
  if (raw === null) return { error: "Bölge listesi okunamadı." };
  const res = await writeRegions(supabase, { tenantId: gate.tenantId, actorId: gate.userId }, profileId, raw);
  if (res.ok) revalidatePath(`/app/ekip/${profileId}`);
  return res.ok ? { ok: true, message: "Bölgeler kaydedildi." } : res;
}

/**
 * Kimlik ve kişisel bilgiler. Yetki: ofis sahibi / genel müdür (herkes için) veya KENDİSİ (yalnız kendi satırı).
 * Şube müdürü / muhasebe yazamaz (RLS de reddeder).
 */
export async function saveAdvisorPrivate(profileId: string, formData: FormData): Promise<AdvisorProfileResult> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda kimlik bilgileri düzenlenemez." };
  const self = gate.userId === profileId;
  if (!self) {
    if (!isManagerRole(gate.role)) return { error: OWNER_ONLY };
    const teamGate = await requirePermission("team", "edit");
    if (!teamGate.ok) return { error: teamGate.error };
  }
  const supabase = await createClient();
  if (!(await targetInTenant(supabase, gate.tenantId, profileId))) return { error: "Danışman bu ofise ait değil." };
  const res = await writePrivate(supabase, { tenantId: gate.tenantId, actorId: gate.userId }, profileId, formData);
  if (res.ok) revalidatePath(`/app/ekip/${profileId}`);
  return res.ok ? { ok: true, message: "Kimlik ve kişisel bilgiler kaydedildi." } : res;
}

/**
 * TC kimlik / IBAN "göster": yalnız ofis sahibi, genel müdür veya kişinin kendisi. Her gösterim `advisor_pii.reveal`
 * denetim kaydı yazar (alan adı + kim; DEĞER YOK). Denetim kaydı yazılamazsa değer GÖSTERİLMEZ.
 */
export async function revealAdvisorPii(profileId: string, field: PiiField): Promise<RevealResult> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (gate.impersonating) return { ok: false, error: "Destek oturumunda kimlik bilgisi gösterilemez." };
  if (field !== "national_id" && field !== "iban") return { ok: false, error: "Geçersiz alan." };
  const self = gate.userId === profileId;
  if (!self && !isManagerRole(gate.role)) return { ok: false, error: OWNER_ONLY };
  if (!isUuid(profileId)) return { ok: false, error: "Danışman bulunamadı." };

  const key = getPiiKeyFromEnv();
  if (!key) return { ok: false, error: PII_DISABLED_MESSAGE };

  const supabase = await createClient();
  const column = field === "national_id" ? "national_id_enc" : "iban_enc";
  const { data, error } = await supabase
    .from("advisor_private")
    .select(column)
    .eq("tenant_id", gate.tenantId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) return { ok: false, error: dbError("revealAdvisorPii", error, "Bilgi okunamadı.") };
  const cipher = (data as Record<string, string | null> | null)?.[column] ?? null;
  if (!cipher) return { ok: false, error: "Kayıtlı değer yok." };
  const plain = decryptPii(cipher, key, piiAad(profileId, field));
  if (plain === null) return { ok: false, error: "Değer çözülemedi (anahtar değişmiş olabilir)." };

  const logged = await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "advisor_pii.reveal",
    entityType: "profile",
    entityId: profileId,
    newValue: { field, self },
  });
  if (!logged.ok) return { ok: false, error: "Denetim kaydı yazılamadığı için değer gösterilmedi." };
  return { ok: true, value: plain };
}

/**
 * Yeni danışman akışı: hesap açıldıktan sonra iş profili + uzmanlık + bölge + (doluysa) kimlik yazılır.
 * Hesap zaten açıldığı için hata durumunda `warnings` döner; danışman ekleme başarısı bozulmaz.
 */
export async function saveAdvisorExtras(profileId: string, formData: FormData): Promise<AdvisorProfileResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda danışman profili düzenlenemez." };
  if (!isManagerRole(gate.role)) return { error: OWNER_ONLY };
  const supabase = await createClient();
  if (!(await targetInTenant(supabase, gate.tenantId, profileId))) return { error: "Danışman bu ofise ait değil." };
  const ctx = { tenantId: gate.tenantId, actorId: gate.userId };

  const warnings: string[] = [];
  const note = (label: string, r: AdvisorProfileResult) => {
    if (!r.ok && r.error) warnings.push(`${label}: ${r.error}`);
  };

  note("İş profili", await writeWork(supabase, ctx, profileId, formData));

  const specs = parseJson(formData.get("specialties_json"));
  if (specs === null) warnings.push("Uzmanlık: liste okunamadı.");
  else if (Array.isArray(specs) && specs.length > 0) note("Uzmanlık", await writeSpecialties(supabase, ctx, profileId, specs));

  const regions = parseJson(formData.get("regions_json"));
  if (regions === null) warnings.push("Bölgeler: liste okunamadı.");
  else if (Array.isArray(regions) && regions.length > 0) note("Bölgeler", await writeRegions(supabase, ctx, profileId, regions));

  if (hasPrivateInput(formData)) note("Kimlik ve kişisel", await writePrivate(supabase, ctx, profileId, formData));

  revalidatePath(`/app/ekip/${profileId}`);
  return { ok: true, warnings: warnings.length ? warnings : undefined };
}
