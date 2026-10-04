"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";
import {
  ALL_PLAN_IDS,
  BASE_CATALOG,
  PLAN_DEFINITIONS_SETTING_KEY,
  PLAN_FIELD_LIMITS,
  RECOMMENDED_CATALOG_OVERRIDES,
  applyPlanOverrides,
  diffAgainstDefault,
  parsePlanCatalogSettings,
  serializePlanCatalogSettings,
  type PlanCatalogSettings,
} from "@/lib/billing/plan-overrides";
import { parsePlanForm } from "@/lib/billing/plan-form";
import { PLAN_DEFINITIONS_TAG } from "@/lib/billing/plan-definitions";
import { PLAN_SUPPORT_TAG, getPlanSupport } from "@/lib/billing/plan-support";
import type { PlanDef, PlanId } from "@/lib/billing/plans";

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
  return parsePlanCatalogSettings(await getPlatformSetting(PLAN_DEFINITIONS_SETTING_KEY));
}

async function persist(settings: PlanCatalogSettings, staffId: string): Promise<boolean> {
  const ok = await setPlatformSetting(PLAN_DEFINITIONS_SETTING_KEY, serializePlanCatalogSettings(settings), staffId);
  if (ok) {
    updateTag(PLAN_DEFINITIONS_TAG);
    revalidatePath("/admin/billing/planlar");
    revalidatePath("/fiyatlar");
    revalidatePath("/kayit");
    revalidatePath("/");
  }
  return ok;
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

function isPlanId(v: string): v is PlanId {
  return (ALL_PLAN_IDS as readonly string[]).includes(v);
}

/** Tek paketin tanımını (fiyat, limit, kota, özellik, görünürlük) kaydeder. */
export async function savePlanDefinition(formData: FormData): Promise<PlanOpResult> {
  const g = await guard("save");
  if ("error" in g) return { error: g.error };
  const id = String(formData.get("plan_id") ?? "");
  if (!isPlanId(id)) return { error: "Geçersiz paket." };
  const base = BASE_CATALOG.find((p) => p.id === id)!;

  const fields: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") fields[k] = v;
  const parsed = parsePlanForm(base, fields);
  if ("error" in parsed) return { error: parsed.error };

  const settings = await loadSettings();
  const support = await getPlanSupport();
  if (id === "business" && parsed.plan.hidden === false && !support.businessPlan) {
    return { error: "Business paketi migration uygulanmadan yayına alınamaz (gizli kalır)." };
  }

  const nextOverrides = { ...settings.overrides };
  const diff = diffAgainstDefault(base, parsed.plan);
  if (Object.keys(diff).length > 0) nextOverrides[id] = diff;
  else delete nextOverrides[id];

  const effective = applyPlanOverrides(nextOverrides);
  if (!effective.some((p) => !p.hidden)) return { error: "En az bir paket yayında kalmalı." };

  const before = applyPlanOverrides(settings.overrides).find((p) => p.id === id)!;
  const limitsChanged = JSON.stringify(before.limits) !== JSON.stringify(parsed.plan.limits);
  let notice: string | undefined;
  if (limitsChanged) {
    const err = await syncEntitlements(parsed.plan);
    if (err) return { error: err };
    notice = "Limitler kota tablosuyla senkronlandı. Mevcut aboneliklerin tutarı değişmez.";
  }

  if (!(await persist({ ...settings, overrides: nextOverrides }, g.staff.id))) return { error: "Ayar kaydedilemedi." };
  await logPlatformActivity({
    actorId: g.staff.id,
    action: "billing.plan.save",
    entityType: "plan",
    entityId: id,
    meta: { diff },
  });
  return { ok: true, notice: notice ?? "Paket kaydedildi. Mevcut aboneliklerin tutarı değişmez; yeni ödemeler yeni fiyatla alınır." };
}

/** Paketin düzenlemelerini siler; plans.ts varsayılanına döner (limitler de senkronlanır). */
export async function resetPlanDefinition(formData: FormData): Promise<PlanOpResult> {
  const g = await guard("reset");
  if ("error" in g) return { error: g.error };
  const id = String(formData.get("plan_id") ?? "");
  if (!isPlanId(id)) return { error: "Geçersiz paket." };
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
  if (!(await persist({ ...settings, overrides: next }, g.staff.id))) return { error: "Ayar kaydedilemedi." };
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
  if (!(await persist({ ...settings, overrides: next }, g.staff.id))) return { error: "Ayar kaydedilemedi." };
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
    trialDays: Number(trialRaw),
  };
  if (!(await persist(next, g.staff.id))) return { error: "Ayar kaydedilemedi." };
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
      : "Kaydedildi. Deneme günü, 20260817000220 migration'ı uygulanana kadar 14 gün olarak verilir.",
  };
}
