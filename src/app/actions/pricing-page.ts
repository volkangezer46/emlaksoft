"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { afterSafe } from "@/lib/after-safe";
import { now } from "@/lib/clock";
import { captureLiveDigests, runAfterPublish } from "@/lib/publishing/after-publish";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import type { Issue } from "@/lib/site-menu/schema";
import { hasErrors } from "@/lib/site-content/schema-core";
import { defaultPricingPage } from "@/lib/pricing-page/defaults";
import { validatePricingPage, type PricingPageContent } from "@/lib/pricing-page/schema";
import { PRICING_PAGE_CACHE_TAG, pricingPageStore } from "@/lib/pricing-page/store";

/**
 * /fiyatlar metinleri yazmaları (/admin/site/sayfalar/fiyatlar). Fiyat sayıları burada YOK (plan editörü).
 * Yetki: `sitecontent` + süper admin; her yazma logPlatformActivity'ye düşer; yayın /fiyatlar önbelleğini düşürür.
 */

export type PricingPageActionResult = { ok?: boolean; error?: string; issues?: Issue[]; config?: PricingPageContent };

const READONLY = "Fiyatlar sayfası metinlerini yalnız süper admin değiştirebilir; bu hesap salt okunur.";

async function requireWriter() {
  const staff = await requirePlatformModule("sitecontent");
  return staff.role === "super_admin" ? staff : null;
}

const entryNow = () => new Date(now()).toISOString();
const who = (s: { full_name?: string | null; email?: string | null }) => (s.full_name || s.email || "").slice(0, 120);

function refreshAdmin() {
  revalidatePath("/admin/site/sayfalar");
  revalidatePath("/admin/site/sayfalar/fiyatlar");
}

function refreshLive() {
  updateTag(PRICING_PAGE_CACHE_TAG);
  refreshAdmin();
  revalidatePath("/fiyatlar");
}

export async function savePricingPageDraft(input: unknown): Promise<PricingPageActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`pricing-page-draft:${staff.id}`, { limit: 90, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık kaydettiniz; birkaç dakika sonra tekrar deneyin." };
  const { config, issues } = validatePricingPage(input);
  if (!config || hasErrors(issues)) return { error: "Metinlerde düzeltilmesi gereken hatalar var.", issues };
  const saved = await pricingPageStore.saveDraft(config, staff.id);
  if (!saved.ok) return { error: saved.error, issues };
  await logPlatformActivity({ actorId: staff.id, action: "pricing_page.draft_save", entityType: "pricing_page", entityId: "draft", meta: { faq: config.faq.length } });
  refreshAdmin();
  return { ok: true, issues, config };
}

export async function publishPricingPage(label: string): Promise<PricingPageActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`pricing-page-publish:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık yayınladınız; birkaç dakika sonra tekrar deneyin." };
  const state = await pricingPageStore.readState();
  if (!state.draft) return { error: "Yayınlanacak taslak yok; önce taslağı kaydedin." };
  const { config, issues } = validatePricingPage(state.draft);
  if (!config || hasErrors(issues)) return { error: "Taslakta hatalar var; düzeltmeden yayınlanamaz.", issues };
  const note = String(label ?? "").trim().slice(0, 80) || "Yayın";
  const entry = { id: randomBytes(6).toString("hex"), at: entryNow(), by: who(staff), label: note };
  const beforeDigests = await captureLiveDigests(["/fiyatlar"]);
  const res = await pricingPageStore.publish(config, entry, staff.id);
  if (!res.ok) return { error: res.error };
  await logPlatformActivity({ actorId: staff.id, action: "pricing_page.publish", entityType: "pricing_page", entityId: entry.id, meta: { label: note } });
  refreshLive();
  afterSafe(() => runAfterPublish({ surface: "pricingpage", kind: "publish", publishRef: entry.id, livePaths: ["/fiyatlar"], actorId: staff.id, source: "staff", beforeDigests }), "yayın sonrası zinciri");
  return { ok: true, issues };
}

export async function rollbackPricingPage(versionId: string): Promise<PricingPageActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`pricing-page-publish:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };
  const state = await pricingPageStore.readState();
  const version = state.history.find((h) => h.id === String(versionId));
  if (!version) return { error: "Sürüm bulunamadı." };
  const { config, issues } = validatePricingPage(version.cfg);
  if (!config || hasErrors(issues)) return { error: "Bu sürüm artık kurallara uymuyor; geri dönülemiyor.", issues };
  const entry = { id: randomBytes(6).toString("hex"), at: entryNow(), by: who(staff), label: `Geri dönüş: ${version.label}`.slice(0, 80) };
  const beforeDigests = await captureLiveDigests(["/fiyatlar"]);
  const res = await pricingPageStore.publish(config, entry, staff.id);
  if (!res.ok) return { error: res.error };
  await logPlatformActivity({ actorId: staff.id, action: "pricing_page.rollback", entityType: "pricing_page", entityId: version.id, meta: { label: version.label } });
  refreshLive();
  afterSafe(() => runAfterPublish({ surface: "pricingpage", kind: "restore", publishRef: entry.id, livePaths: ["/fiyatlar"], actorId: staff.id, source: "staff", beforeDigests }), "yayın sonrası zinciri");
  return { ok: true, config };
}

/** Yayını siler: /fiyatlar bugünkü (kod içi) metinlere döner; taslak da varsayılana eşitlenir. */
export async function resetPricingPageToDefault(): Promise<PricingPageActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`pricing-page-publish:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };
  const beforeDigests = await captureLiveDigests(["/fiyatlar"]);
  const res = await pricingPageStore.resetToDefault({ id: randomBytes(6).toString("hex"), at: entryNow(), by: who(staff) }, staff.id);
  if (!res.ok) return { error: res.error };
  await logPlatformActivity({ actorId: staff.id, action: "pricing_page.reset", entityType: "pricing_page", entityId: "default" });
  refreshLive();
  afterSafe(() => runAfterPublish({ surface: "pricingpage", kind: "reset", publishRef: "default", livePaths: ["/fiyatlar"], actorId: staff.id, source: "staff", beforeDigests }), "yayın sonrası zinciri");
  return { ok: true, config: defaultPricingPage() };
}
