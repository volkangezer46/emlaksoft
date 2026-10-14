"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";
import {
  BASE_CATALOG,
  CUSTOM_PLANS_MAX,
  PLAN_DEFINITIONS_SETTING_KEY,
  PLAN_FIELD_LIMITS,
  RECOMMENDED_CATALOG_OVERRIDES,
  applyPlanOverrides,
  catalogPlanDefs,
  customPlanRecord,
  diffAgainstDefault,
  isCustomPlanIdFormat,
  resolveCatalogSettings,
  sanitizeCustomPlan,
  sanitizeSeatTiers,
  serializePlanCatalogSettings,
  type PlanCatalogSettings,
} from "@/lib/billing/plan-overrides";
import { parsePlanForm } from "@/lib/billing/plan-form";
import { PLAN_DEFINITIONS_TAG } from "@/lib/billing/plan-definitions";
import { PLAN_SUPPORT_TAG, getPlanSupport } from "@/lib/billing/plan-support";
import { isPlanId, type PlanDef, type PlanId } from "@/lib/billing/plans";
import { EF_WELCOME_SETTING_KEY } from "@/lib/ef-credits/config";
import { validateSeatCatalog } from "@/lib/billing/seat-pricing";
import {
  SEAT_SETTINGS_KEY,
  SEAT_WARN_PERCENT_MAX,
  SEAT_WARN_PERCENT_MIN,
  serializeSeatSettings,
} from "@/lib/billing/seat-settings";
import { actionErrorMessage } from "@/lib/action-errors";

export type PlanOpResult = { ok?: boolean; error?: string; notice?: string };

async function guard(action: string) {
  const staff = await requirePlatformModule("billing");
  if (staff.role !== "super_admin") {
    return { error: "Paket tanımları yalnız süper admin tarafından değiştirilir." } as const;
  }
  const rl = await checkRateLimit(`billing-plans:${action}:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." } as const;
  return { staff } as const;
}

async function loadSettings(): Promise<PlanCatalogSettings> {
  return resolveCatalogSettings(await getPlatformSetting(PLAN_DEFINITIONS_SETTING_KEY));
}

async function persist(settings: PlanCatalogSettings, staffId: string): Promise<boolean> {
  const ok = await setPlatformSetting(PLAN_DEFINITIONS_SETTING_KEY, serializePlanCatalogSettings(settings), staffId);
  if (ok) {
    updateTag(PLAN_DEFINITIONS_TAG);
    revalidatePath("/admin/billing/planlar");
    revalidatePath("/fiyatlar");
    revalidatePath("/kayit");
    revalidatePath("/app/abonelik");
    revalidatePath("/");
  }
  return ok;
}

/** Düzenlenen paket: taban (kod varsayılanı + düzenleme) ya da adminden eklenen (tam tanım). */
type PlanTarget = { kind: "base"; id: PlanId; base: PlanDef } | { kind: "custom"; id: string; def: PlanDef };

function resolveTarget(settings: PlanCatalogSettings, id: string): PlanTarget | null {
  if (isPlanId(id)) return { kind: "base", id, base: BASE_CATALOG.find((p) => p.id === id)! };
  if (!isCustomPlanIdFormat(id)) return null;
  const def = (settings.customPlans ?? []).find((p) => p.id === id);
  return def ? { kind: "custom", id, def } : null;
}

function replaceCustom(settings: PlanCatalogSettings, next: PlanDef): PlanDef[] {
  return (settings.customPlans ?? []).map((p) => (p.id === next.id ? next : p));
}

/** Eklenen paket depoya yazılabilir mi (aynı doğrulayıcı okuma tarafında da çalışır; kayıt sessizce düşmesin). */
function customRecordValid(def: PlanDef): boolean {
  return sanitizeCustomPlan(def.id, customPlanRecord(def)) !== null;
}

/**
 * Paket kimliği kayıt defteri (`billing_plans`, 20261014002000): FK hedefi. Yeni paket satırı, kademe ve arşiv durumu
 * buraya yazılır; tanımın kendisi platform_settings belgesinde kalır. `archived_at`'ı SQL satış kapısı
 * (billing_plan_is_hidden) da okur; ayrışma her zaman "satışa kapalı" yönündedir ve her kayıtta defter belgeyle eşitlenir.
 * Sıra: önce defter, sonra belge (belge yazılamazsa defter yeniden denemede aynı değere yazılır; idempotent).
 */
async function writePlanRegistry(
  id: string,
  change: { create: true; tier: PlanId; staffId: string } | { create?: false; tier?: PlanId; archived?: boolean },
): Promise<string | null> {
  const admin = createAdminClient();
  const stamp = new Date().toISOString();
  const { error } = change.create
    ? // Upsert: önceki denemede satır açılıp tanım yazılamadıysa aynı kimlikle yeniden denenebilir (taban kimlik buraya gelmez).
      await admin
        .from("billing_plans")
        .upsert({ id, tier: change.tier, is_base: false, archived_at: null, created_by: change.staffId, updated_at: stamp }, { onConflict: "id" })
    : await admin
        .from("billing_plans")
        .update({
          ...(change.tier ? { tier: change.tier } : {}),
          ...(change.archived === undefined ? {} : { archived_at: change.archived ? stamp : null }),
          updated_at: stamp,
        })
        .eq("id", id)
        .eq("is_base", false);
  if (error) {
    console.error("writePlanRegistry", error.code, error.message);
    return error.code === "23505" ? "Bu paket kimliği zaten kullanılıyor." : "Paket kayıt defteri güncellenemedi; değişiklik kaydedilmedi.";
  }
  return null;
}

/** Form `tier` alanı: taban kademe kimliği (eklenen paketin dahil modülleri bu kademeden gelir). */
function parseTier(raw: FormDataEntryValue | null): PlanId | null {
  const v = String(raw ?? "").trim();
  return isPlanId(v) ? v : null;
}

/**
 * plan_entitlements (kota tetikleyicilerinin tek kaynağı) ile senkron. Yazma yetkisi/şema yoksa
 * limit değişikliği REDDEDİLİR; böylece panel ile veritabanı kotası ayrışmaz.
 */
async function syncEntitlements(plan: PlanDef): Promise<string | null> {
  const support = await getPlanSupport();
  if (!support.entitlementWrite) {
    return "Limit değişikliği için 20260817000210 migration'ı uygulanmalı (plan_entitlements yazma yetkisi yok). Fiyat ve metin alanları yine kaydedilebilir.";
  }
  if (plan.id === "business" && !support.businessPlan) return "Business paketi için migration henüz uygulanmamış.";
  if (!isPlanId(plan.id) && !support.catalogEngine) return "Eklenen paket için 20261014002000 migration'ı uygulanmalı.";
  const admin = createAdminClient();
  const { error } = await admin.from("plan_entitlements").upsert(
    {
      plan: plan.id,
      seat_limit: plan.limits.seats,
      customer_limit: plan.limits.customers,
      active_property_limit: plan.limits.activeProperties,
      branch_limit: plan.limits.branches,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "plan" },
  );
  if (error) {
    console.error("syncEntitlements", error.message);
    return "Kota tablosu güncellenemedi; değişiklik kaydedilmedi.";
  }
  return null;
}

/**
 * Tek paketin tanımını (fiyat, limit, kota, özellik, görünürlük) kaydeder. Taban pakette varsayılandan fark (diff),
 * adminden eklenen pakette tam tanım (+ modül kademesi `tier`) yazılır. Mevcut aboneliklerin kayıtlı ve kilitli
 * tutarı değişmez (fiyat kilidi `quoteFromDefinition` / SQL `plan_campaign_lock_amount`).
 */
export async function savePlanDefinition(formData: FormData): Promise<PlanOpResult> {
  const g = await guard("save");
  if ("error" in g) return { error: g.error };
  const id = String(formData.get("plan_id") ?? "");
  const settings = await loadSettings();
  const target = resolveTarget(settings, id);
  if (!target) return { error: "Geçersiz paket." };

  const fields: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") fields[k] = v;
  const parsed = parsePlanForm(target.kind === "base" ? target.base : target.def, fields);
  if ("error" in parsed) return { error: parsed.error };

  const support = await getPlanSupport();
  if (id === "business" && parsed.plan.hidden === false && !support.businessPlan) {
    return { error: "Business paketi migration uygulanmadan yayına alınamaz (gizli kalır)." };
  }

  const nextOverrides = { ...settings.overrides };
  let nextCustom = settings.customPlans ?? [];
  let diff: unknown;
  // Eklenen pakette kayıt defteri satırı (tier/archived_at) her kayıtta belgedeki değere eşitlenir (idempotent):
  // önceki bir denemede defter ile belge ayrıştıysa bu kayıt onları yeniden hizalar.
  let registrySync: { tier: PlanId; archived: boolean } | null = null;
  if (target.kind === "base") {
    const d = diffAgainstDefault(target.base, parsed.plan);
    if (Object.keys(d).length > 0) nextOverrides[target.id] = d;
    else delete nextOverrides[target.id];
    diff = d;
  } else {
    const tier = parseTier(formData.get("tier")) ?? target.def.tier ?? "office";
    const next: PlanDef = { ...parsed.plan, id, tier, custom: true };
    if (target.def.archived) next.archived = true;
    if (!customRecordValid(next)) return { error: "Paket tanımı eksik ya da geçersiz." };
    registrySync = { tier, archived: Boolean(next.archived) };
    nextCustom = replaceCustom(settings, next);
    diff = { tier, monthlyTry: next.monthlyTry, limits: next.limits, hidden: Boolean(next.hidden) };
  }

  const effective = catalogPlanDefs({ overrides: nextOverrides, customPlans: nextCustom });
  if (!effective.some((p) => !p.hidden && !p.archived)) return { error: "En az bir paket yayında kalmalı." };
  const seatReport = validateSeatCatalog(effective);
  if (seatReport.errors.length > 0) return { error: `Ek kullanıcı fiyatlaması geçersiz: ${seatReport.errors[0]}` };

  const before = catalogPlanDefs(settings).find((p) => p.id === id)!;
  const limitsChanged = JSON.stringify(before.limits) !== JSON.stringify(parsed.plan.limits);
  let notice: string | undefined;
  if (limitsChanged) {
    const err = await syncEntitlements(parsed.plan);
    if (err) return { error: err };
    notice = "Limitler kota tablosuyla senkronlandı. Mevcut aboneliklerin tutarı değişmez.";
  }
  if (registrySync) {
    const err = await writePlanRegistry(id, registrySync);
    if (err) return { error: err };
  }

  if (!(await persist({ ...settings, overrides: nextOverrides, customPlans: nextCustom }, g.staff.id))) {
    return { error: actionErrorMessage(null, "Ayar kaydedilemedi.") };
  }
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "billing.plan.save",
    entityType: "plan",
    entityId: id,
    meta: { diff },
  });
  const warn = seatReport.warnings.length > 0 ? ` Uyarı: ${seatReport.warnings[0]}` : "";
  return {
    ok: true,
    notice: `${notice ?? "Paket kaydedildi. Mevcut aboneliklerin tutarı değişmez; yeni ödemeler yeni fiyatla alınır."}${warn}`,
  };
}

/** Paketin düzenlemelerini siler; plans.ts varsayılanına döner (limitler de senkronlanır). Eklenen paketin varsayılanı yoktur. */
export async function resetPlanDefinition(formData: FormData): Promise<PlanOpResult> {
  const g = await guard("reset");
  if ("error" in g) return { error: g.error };
  const id = String(formData.get("plan_id") ?? "");
  if (!isPlanId(id)) return { error: isCustomPlanIdFormat(id) ? "Eklenen paketin kod varsayılanı yok; arşivleyebilirsiniz." : "Geçersiz paket." };
  const settings = await loadSettings();
  if (!settings.overrides[id]) return { ok: true, notice: "Paket zaten varsayılanda." };
  const base = BASE_CATALOG.find((p) => p.id === id)!;
  const current = applyPlanOverrides(settings.overrides).find((p) => p.id === id)!;
  if (JSON.stringify(current.limits) !== JSON.stringify(base.limits)) {
    const err = await syncEntitlements(base);
    if (err) return { error: err };
  }
  const next = { ...settings.overrides };
  delete next[id];
  if (!(await persist({ ...settings, overrides: next }, g.staff.id))) return { error: actionErrorMessage(null, "Ayar kaydedilemedi.") };
  await logPlatformActivity({ actorId: g.staff.id, action: "billing.plan.reset", entityType: "plan", entityId: id });
  return { ok: true, notice: "Varsayılana dönüldü." };
}

/** Önerilen kataloğu (sahibin fiyatlandırma kararı) uygular. Limit değişimleri kota tablosuna yazılır. */
export async function applyRecommendedCatalog(): Promise<PlanOpResult> {
  const g = await guard("recommended");
  if ("error" in g) return { error: g.error };
  const settings = await loadSettings();
  const next = { ...RECOMMENDED_CATALOG_OVERRIDES };
  const effective = applyPlanOverrides(next);
  const before = applyPlanOverrides(settings.overrides);
  for (const plan of effective) {
    if (plan.id === "business") continue; // Business migration + RPC olmadan satılmaz; gizli kalır
    const prev = before.find((p) => p.id === plan.id)!;
    if (JSON.stringify(prev.limits) !== JSON.stringify(plan.limits)) {
      const err = await syncEntitlements(plan);
      if (err) return { error: err };
    }
  }
  // business önerisi (fiyat/limit) kayda girer ama gizli kalır
  if (!(await persist({ ...settings, overrides: next }, g.staff.id))) return { error: actionErrorMessage(null, "Ayar kaydedilemedi.") };
  await logPlatformActivity({ actorId: g.staff.id, action: "billing.plan.apply_recommended", entityType: "plan" });
  return { ok: true, notice: "Önerilen katalog uygulandı. Mevcut abonelikler kendi tutarını korur." };
}

/** Kampanya (Founders) ve deneme günü ayarları. */
export async function saveCampaignSettings(formData: FormData): Promise<PlanOpResult> {
  const g = await guard("campaign");
  if ("error" in g) return { error: g.error };
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > PLAN_FIELD_LIMITS.campaignNameMax) return { error: "Kampanya adı 2-60 karakter olmalı." };
  const quotaRaw = String(formData.get("quota") ?? "").trim();
  if (!/^\d+$/.test(quotaRaw) || Number(quotaRaw) < 1 || Number(quotaRaw) > PLAN_FIELD_LIMITS.limitMax) {
    return { error: "Kampanya kotası pozitif tam sayı olmalı." };
  }
  const trialRaw = String(formData.get("trial_days") ?? "").trim();
  if (!/^\d+$/.test(trialRaw) || Number(trialRaw) < PLAN_FIELD_LIMITS.trialDaysMin || Number(trialRaw) > PLAN_FIELD_LIMITS.trialDaysMax) {
    return { error: `Deneme süresi ${PLAN_FIELD_LIMITS.trialDaysMin}-${PLAN_FIELD_LIMITS.trialDaysMax} gün olmalı.` };
  }
  const active = formData.get("active") === "on";
  const lockPrice = formData.get("lock_price") === "on";
  const support = await getPlanSupport();
  if (active && !support.priceLock) {
    return { error: "Kampanya, kilitli fiyat şeması (20260817000220) uygulanmadan etkinleştirilemez." };
  }
  const settings = await loadSettings();
  const next: PlanCatalogSettings = {
    ...settings,
    campaign: { name, quota: Number(quotaRaw), active, lockPrice },
  };
  // Deneme süresi: plan başına değil, TEK platform ayarı (K1: default_trial_days).
  if (!(await setPlatformSetting("default_trial_days", trialRaw, g.staff.id))) return { error: actionErrorMessage(null, "Deneme süresi kaydedilemedi.") };
  if (!(await persist(next, g.staff.id))) return { error: actionErrorMessage(null, "Ayar kaydedilemedi.") };
  updateTag(PLAN_SUPPORT_TAG);
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "billing.campaign.save",
    entityType: "plan",
    meta: { name, quota: Number(quotaRaw), active, lockPrice, trialDays: Number(trialRaw) },
  });
  return {
    ok: true,
    notice: support.trialSetting
      ? "Kaydedildi."
      : "Kaydedildi. Deneme günü, 20260816010100 migration'ı uygulanana kadar 14 gün olarak verilir.",
  };
}

/**
 * Fiyat simülatöründen "uygula": tek paketin taban fiyatı + ek kullanıcı kademeleri/yuvarlama/azami koltuk.
 * Katalog düzeyinde doğrulanır (hata varsa yazılmaz). Mevcut abonelerin kayıtlı/kilitli tutarı değişmez.
 */
export async function applySimulatedSeatPricing(formData: FormData): Promise<PlanOpResult> {
  const g = await guard("seat-apply");
  if ("error" in g) return { error: g.error };
  const id = String(formData.get("plan_id") ?? "");
  const settings = await loadSettings();
  const target = resolveTarget(settings, id);
  if (!target) return { error: "Geçersiz paket." };

  const priceRaw = String(formData.get("monthly_try") ?? "").trim();
  if (!/^\d+$/.test(priceRaw) || Number(priceRaw) < 1 || Number(priceRaw) > PLAN_FIELD_LIMITS.priceMax) {
    return { error: "Aylık taban fiyat pozitif tam sayı olmalı." };
  }
  let tiersJson: unknown;
  try {
    tiersJson = JSON.parse(String(formData.get("seat_tiers_json") ?? "null"));
  } catch {
    return { error: actionErrorMessage(null, "Kademe verisi okunamadı.") };
  }
  const tiers = sanitizeSeatTiers(tiersJson);
  if (tiers === undefined) return { error: "Kademeler geçersiz (tam sayı, en fazla 12 kademe)." };
  const roundingRaw = String(formData.get("seat_rounding") ?? "none");
  if (roundingRaw !== "none" && roundingRaw !== "x9" && roundingRaw !== "x0") return { error: "Yuvarlama düzeni geçersiz." };
  const maxRaw = String(formData.get("max_seats") ?? "").trim();
  if (maxRaw && (!/^\d+$/.test(maxRaw) || Number(maxRaw) < 1 || Number(maxRaw) > PLAN_FIELD_LIMITS.maxSeatsMax)) {
    return { error: "Azami kullanıcı pozitif tam sayı olmalı." };
  }

  const current = catalogPlanDefs(settings).find((p) => p.id === id)!;
  const edited: PlanDef = {
    ...current,
    monthlyTry: Number(priceRaw),
    extraSeatTiers: tiers,
    maxSeats: maxRaw ? Number(maxRaw) : null,
    seatRounding: roundingRaw === "none" ? null : roundingRaw,
  };
  if (current.campaignMonthlyTry && current.campaignMonthlyTry >= edited.monthlyTry) {
    return { error: "Taban fiyat, kampanya fiyatının üstünde kalmalı; önce kampanya fiyatını güncelleyin." };
  }
  const nextOverrides = { ...settings.overrides };
  let nextCustom = settings.customPlans ?? [];
  if (target.kind === "base") {
    const diff = diffAgainstDefault(target.base, edited);
    if (Object.keys(diff).length > 0) nextOverrides[target.id] = diff;
    else delete nextOverrides[target.id];
  } else {
    if (!customRecordValid(edited)) return { error: "Paket tanımı geçersiz." };
    nextCustom = replaceCustom(settings, edited);
  }
  const effective = catalogPlanDefs({ overrides: nextOverrides, customPlans: nextCustom });
  const report = validateSeatCatalog(effective);
  if (report.errors.length > 0) return { error: `Uygulanamadı: ${report.errors[0]}` };

  if (!(await persist({ ...settings, overrides: nextOverrides, customPlans: nextCustom }, g.staff.id))) {
    return { error: actionErrorMessage(null, "Ayar kaydedilemedi.") };
  }
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "billing.seat_pricing.apply",
    entityType: "plan",
    entityId: id,
    meta: { monthlyTry: edited.monthlyTry, tiers: tiers ?? null, maxSeats: edited.maxSeats ?? null, rounding: roundingRaw },
  });
  const warn = report.warnings.length > 0 ? ` Uyarı: ${report.warnings[0]}` : "";
  return { ok: true, notice: `Fiyatlama uygulandı. Mevcut abonelerin kayıtlı ve kilitli tutarı değişmez; yeni satışlar ve ek kullanıcılar yeni fiyatla alınır.${warn}` };
}

/**
 * ADMİNDEN YENİ PAKET (plan katalog motoru). Kimlik (küçük harf slug), ad, modül kademesi ve aylık fiyat alınır; limit,
 * özellik listesi, ek kullanıcı fiyatlaması ve analiz bakiyesi hakkı kademenin GÜNCEL taban tanımından kopyalanır
 * (sonra paket kartından düzenlenir). Sıra: kayıt defteri satırı (FK) -> kota satırı -> katalog belgesi. Yayındaysa
 * fiyat sayfasında, kayıtta ve paket değiştirme seçeneklerinde hemen görünür.
 */
export async function createCustomPlan(formData: FormData): Promise<PlanOpResult> {
  const g = await guard("create");
  if ("error" in g) return { error: g.error };
  const id = String(formData.get("plan_id") ?? "").trim().toLowerCase();
  if (!isCustomPlanIdFormat(id)) {
    return { error: "Paket kimliği 3-32 karakter olmalı: küçük harf ile başlar, yalnız a-z, 0-9 ve _ içerir; taban kimlikler kullanılamaz." };
  }
  const tier = parseTier(formData.get("tier"));
  if (!tier) return { error: "Modül kademesi seçin." };
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > PLAN_FIELD_LIMITS.nameMax) return { error: `Ad 2-${PLAN_FIELD_LIMITS.nameMax} karakter olmalı.` };
  const priceRaw = String(formData.get("monthly_try") ?? "").trim();
  if (!/^\d+$/.test(priceRaw) || Number(priceRaw) < 1 || Number(priceRaw) > PLAN_FIELD_LIMITS.priceMax) {
    return { error: "Aylık fiyat pozitif tam sayı olmalı (KDV hariç)." };
  }

  const support = await getPlanSupport();
  if (!support.catalogEngine) return { error: "Yeni paket için 20261014002000 migration'ı uygulanmalı (paket kayıt defteri yok)." };
  const settings = await loadSettings();
  const current = catalogPlanDefs(settings);
  if (current.some((p) => p.id === id)) return { error: "Bu paket kimliği zaten var." };
  if ((settings.customPlans ?? []).length >= CUSTOM_PLANS_MAX) return { error: `En fazla ${CUSTOM_PLANS_MAX} eklenen paket tanımlanabilir.` };
  if (current.some((p) => p.name.toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"))) return { error: "Aynı adda bir paket var." };

  const template = current.find((p) => p.id === tier)!;
  const def: PlanDef = {
    ...template,
    id,
    tier,
    custom: true,
    name,
    monthlyTry: Number(priceRaw),
    eyebrow: template.eyebrow,
    hidden: formData.get("hidden") === "on",
  };
  delete def.popular;
  delete def.order;
  delete def.archived;
  delete def.campaignMonthlyTry;
  if (!customRecordValid(def)) return { error: "Paket tanımı oluşturulamadı (kademe tanımı geçersiz)." };
  const nextCustom = [...(settings.customPlans ?? []), def];
  const report = validateSeatCatalog(catalogPlanDefs({ overrides: settings.overrides, customPlans: nextCustom }));
  if (report.errors.length > 0) return { error: `Ek kullanıcı fiyatlaması geçersiz: ${report.errors[0]}` };

  const regErr = await writePlanRegistry(id, { create: true, tier, staffId: g.staff.id });
  if (regErr) return { error: regErr };
  const entErr = await syncEntitlements(def);
  if (entErr) return { error: entErr };
  if (!(await persist({ ...settings, customPlans: nextCustom }, g.staff.id))) {
    return { error: actionErrorMessage(null, "Paket tanımı kaydedilemedi; aynı kimlikle tekrar deneyin.") };
  }
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "billing.plan.create",
    entityType: "plan",
    entityId: id,
    meta: { tier, monthlyTry: def.monthlyTry, hidden: Boolean(def.hidden), template: tier },
  });
  const warn = report.warnings.length > 0 ? ` Uyarı: ${report.warnings[0]}` : "";
  return {
    ok: true,
    notice: def.hidden
      ? `${name} paketi gizli olarak eklendi; ayrıntıları paket kartından düzenleyip yayına alabilirsiniz.${warn}`
      : `${name} paketi eklendi; fiyat sayfası, kayıt ve paket değiştirme seçeneklerinde görünür.${warn}`,
  };
}

/**
 * Eklenen paketi arşivler (satışa kapatır) ya da arşivden çıkarır. Arşivli paket fiyat sayfası, kayıt ve paket
 * değiştirme listelerinde görünmez; o paketteki ofisler aynı tutar ve fiyat kilidiyle yenilenmeye devam eder.
 * Taban paketler arşivlenmez (gizlenir).
 */
export async function setCustomPlanArchived(formData: FormData): Promise<PlanOpResult> {
  const g = await guard("archive");
  if ("error" in g) return { error: g.error };
  const id = String(formData.get("plan_id") ?? "");
  const archived = formData.get("archived") === "1";
  const settings = await loadSettings();
  const target = resolveTarget(settings, id);
  if (!target) return { error: "Geçersiz paket." };
  if (target.kind === "base") return { error: "Taban paketler arşivlenmez; gizleyebilirsiniz." };
  if (Boolean(target.def.archived) === archived) {
    // Belge zaten istenen durumda: defter satırı yine eşitlenir (önceki yarım kalan denemeyi onarır).
    const syncErr = await writePlanRegistry(id, { archived });
    return syncErr ? { error: syncErr } : { ok: true, notice: "Değişiklik yok." };
  }
  const next: PlanDef = { ...target.def };
  if (archived) next.archived = true;
  else delete next.archived;
  const nextCustom = replaceCustom(settings, next);
  if (!catalogPlanDefs({ overrides: settings.overrides, customPlans: nextCustom }).some((p) => !p.hidden && !p.archived)) {
    return { error: "En az bir paket yayında kalmalı." };
  }
  const regErr = await writePlanRegistry(id, { archived });
  if (regErr) return { error: regErr };
  if (!(await persist({ ...settings, customPlans: nextCustom }, g.staff.id))) return { error: actionErrorMessage(null, "Ayar kaydedilemedi.") };
  await logPlatformActivity({
    actorId: g.staff.id,
    action: archived ? "billing.plan.archive" : "billing.plan.unarchive",
    entityType: "plan",
    entityId: id,
  });
  return {
    ok: true,
    notice: archived
      ? `${next.name} arşivlendi: yeni satışa kapalı; bu paketteki ofisler aynı tutarla yenilenmeye devam eder.`
      : `${next.name} arşivden çıkarıldı.`,
  };
}

/** Koltuk doluluk uyarı eşiği (ofis tarafı satın alma yönlendirmesi bu eşiği kullanır). */
export async function saveSeatSettings(formData: FormData): Promise<PlanOpResult> {
  const g = await guard("seat-settings");
  if ("error" in g) return { error: g.error };
  const raw = String(formData.get("warn_percent") ?? "").trim();
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < SEAT_WARN_PERCENT_MIN || n > SEAT_WARN_PERCENT_MAX) {
    return { error: `Uyarı eşiği ${SEAT_WARN_PERCENT_MIN}-${SEAT_WARN_PERCENT_MAX} arasında tam sayı (yüzde) olmalı.` };
  }
  if (!(await setPlatformSetting(SEAT_SETTINGS_KEY, serializeSeatSettings({ warnPercent: n }), g.staff.id))) {
    return { error: actionErrorMessage(null, "Ayar kaydedilemedi.") };
  }
  updateTag(PLAN_DEFINITIONS_TAG);
  revalidatePath("/admin/billing/planlar");
  await logPlatformActivity({ actorId: g.staff.id, action: "billing.seat_settings.save", entityType: "plan", meta: { warnPercent: n } });
  return { ok: true, notice: `Uyarı eşiği %${n} olarak kaydedildi; %100'de "dolu" gösterilir.` };
}

/** Hoş geldin analiz bakiyesi (yeni ofis, tek sefer; 0 = kapalı). platform_settings `ef.welcome_units`; yalnız süper admin. */
export async function saveEfWelcomeUnits(formData: FormData): Promise<PlanOpResult> {
  const g = await guard("ef-welcome");
  if ("error" in g) return { error: g.error };
  const raw = String(formData.get("welcome_units") ?? "").trim();
  if (!/^\d+$/.test(raw) || Number(raw) > 1000) return { error: "Hoş geldin analiz bakiyesi 0-1000 arasında tam sayı olmalı (0 = kapalı)." };
  const units = Number(raw);
  const before = await getPlatformSetting(EF_WELCOME_SETTING_KEY);
  if (!(await setPlatformSetting(EF_WELCOME_SETTING_KEY, String(units), g.staff.id))) return { error: actionErrorMessage(null, "Ayar kaydedilemedi.") };
  updateTag(PLAN_DEFINITIONS_TAG);
  revalidatePath("/admin/billing/planlar");
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "billing.ef_welcome.save",
    entityType: "plan",
    meta: { before, units },
  });
  return { ok: true, notice: units === 0 ? "Hoş geldin analiz bakiyesi kapatıldı." : `Hoş geldin analiz bakiyesi ${units} olarak kaydedildi; yalnız deneme/yeni ofise tek sefer verilir, mevcut ofislere geriye dönük dağıtılmaz.` };
}
