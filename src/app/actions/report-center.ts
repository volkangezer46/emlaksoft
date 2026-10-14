"use server";

import { revalidatePath } from "next/cache";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { buildPlatformContext, buildTenantContext } from "@/lib/report-center/context";
import { REPORT_CENTER_PATH } from "@/lib/report-center/links";
import { getReport, platformReportAllowed, tenantReportAllowed } from "@/lib/report-center/registry";
import { cleanViewFilters, VIEW_NAME_MAX, VIEWS_PER_REPORT_MAX } from "@/lib/report-center/saved-views";
import {
  isSchedulable,
  nextRunDay,
  runDayStartIso,
  SUBSCRIPTION_PER_OWNER_MAX,
  subscriptionInputSchema,
  trKeyOf,
} from "@/lib/report-center/schedule";
import type { ReportContext, ReportDef, ReportScope } from "@/lib/report-center/types";
import { requirePermission } from "@/lib/require-permission";

/**
 * Rapor merkezi kayıtlı görünüm + zamanlanmış abonelik eylemleri (DG4).
 * Kapı: kiracı → `requirePermission("reports", "view")` + raporun kendi görünürlük kuralı (`tenantReportAllowed`),
 * destek oturumu (impersonation, salt okunur) YAZAMAZ; platform → `requirePlatformModule("reports")` +
 * `platformReportAllowed`. Kiracı yazımları RLS'li oturum istemcisiyle (tenant_id + user_id = oturum), platform yazımları
 * rapor bağlamının servis istemcisiyle ve personel kimliğiyle. Alıcılar yalnız kendi ofisinin aktif kullanıcıları
 * (platformda aktif personel) olabilir; teslimde her alıcı raporu kendi yetkisiyle alır.
 */

type Result = { ok: true } | { ok: false; error: string };

const MISSING = new Set(["42P01", "PGRST205", "42703"]);
const SETUP_PENDING = "Bu özellik için veritabanı güncellemesi bekleniyor.";

type Actor = { scope: ReportScope; ctx: ReportContext; reportVisible: (def: ReportDef) => boolean };

async function actor(scope: ReportScope): Promise<{ ok: true; actor: Actor } | { ok: false; error: string }> {
  if (scope === "platform") {
    const staff = await requirePlatformModule("reports");
    return { ok: true, actor: { scope, ctx: buildPlatformContext({ id: staff.id, role: staff.role }), reportVisible: (def) => platformReportAllowed(def, staff.role) } };
  }
  const gate = await requirePermission("reports", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (gate.impersonating) return { ok: false, error: "Destek oturumunda kayıt yapılamaz." };
  const ctx = await buildTenantContext(gate);
  return {
    ok: true,
    actor: {
      scope,
      ctx,
      reportVisible: (def) => tenantReportAllowed(def, { perms: ctx.perms, role: gate.role, officeWide: ctx.officeWide, seeAllEarnings: ctx.seeAllEarnings }),
    },
  };
}

function owner(a: Actor): Record<string, string | null> {
  return a.scope === "platform"
    ? { scope: "platform", tenant_id: null, user_id: null, staff_id: a.ctx.userId }
    : { scope: "tenant", tenant_id: a.ctx.tenantId, user_id: a.ctx.userId, staff_id: null };
}

/** Sahibin satırları: platformda staff_id, kiracıda tenant_id + user_id (RLS ayrıca aynı koşulu uygular). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ownRows(a: Actor, query: any): any {
  return a.scope === "platform" ? query.eq("scope", "platform").eq("staff_id", a.ctx.userId) : query.eq("scope", "tenant").eq("tenant_id", a.ctx.tenantId).eq("user_id", a.ctx.userId);
}

function scopeOf(raw: unknown): ReportScope {
  return raw === "platform" ? "platform" : "tenant";
}

function revalidate(scope: ReportScope) {
  revalidatePath(REPORT_CENTER_PATH[scope]);
}

export async function saveReportView(input: { scope: ReportScope; reportId: string; name: string; filters: Record<string, string>; shared?: boolean }): Promise<Result> {
  const scope = scopeOf(input?.scope);
  const a = await actor(scope);
  if (!a.ok) return a;
  const def = getReport(scope, String(input.reportId ?? ""));
  if (!def || !a.actor.reportVisible(def)) return { ok: false, error: "Rapor bulunamadı ya da yetkiniz yok." };
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, error: "Görünüm adı zorunlu." };
  if (name.length > VIEW_NAME_MAX) return { ok: false, error: `Görünüm adı en fazla ${VIEW_NAME_MAX} karakter olabilir.` };
  const parsed = cleanViewFilters(def, input.filters);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (Object.keys(parsed.filters).length === 0) return { ok: false, error: "Kaydedilecek filtre yok: önce filtre uygulayın." };

  const db = a.actor.ctx.supabase;
  const { count, error: countError } = await ownRows(a.actor, db.from("report_saved_views").select("id", { count: "exact", head: true })).eq("report_id", def.id);
  if (countError) return { ok: false, error: MISSING.has(String(countError.code)) ? SETUP_PENDING : actionErrorMessage(countError, "Görünüm kaydedilemedi.") };
  if ((count ?? 0) >= VIEWS_PER_REPORT_MAX) return { ok: false, error: `Bu rapor için en çok ${VIEWS_PER_REPORT_MAX} görünüm kaydedebilirsiniz.` };

  const { error } = await db.from("report_saved_views").insert({ ...owner(a.actor), report_id: def.id, name, filters: parsed.filters, shared: input.shared === true });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Bu adla kayıtlı bir görünüm zaten var." };
    return { ok: false, error: MISSING.has(String(error.code)) ? SETUP_PENDING : actionErrorMessage(error, "Görünüm kaydedilemedi.") };
  }
  revalidate(scope);
  return { ok: true };
}

export async function deleteReportView(input: { scope: ReportScope; id: string }): Promise<Result> {
  const scope = scopeOf(input?.scope);
  const a = await actor(scope);
  if (!a.ok) return a;
  const id = String(input.id ?? "").trim();
  if (!id) return { ok: false, error: "Görünüm bulunamadı." };
  const { data, error } = await ownRows(a.actor, a.actor.ctx.supabase.from("report_saved_views").delete().eq("id", id)).select("id");
  if (error) return { ok: false, error: actionErrorMessage(error, "Görünüm silinemedi.") };
  if (!data || data.length === 0) return { ok: false, error: "Görünüm bulunamadı (yalnız kendi görünümünüzü silebilirsiniz)." };
  revalidate(scope);
  return { ok: true };
}

export async function createReportSubscription(input: {
  scope: ReportScope;
  reportId: string;
  name: string;
  format: string;
  frequency: string;
  weekday?: number | null;
  monthDay?: number | null;
  recipientIds: string[];
  relativeRange?: boolean;
  filters: Record<string, string>;
}): Promise<Result> {
  const scope = scopeOf(input?.scope);
  const a = await actor(scope);
  if (!a.ok) return a;
  const parsed = subscriptionInputSchema.safeParse({
    reportId: input.reportId,
    name: input.name,
    format: input.format,
    frequency: input.frequency,
    weekday: input.weekday ?? null,
    monthDay: input.monthDay ?? null,
    recipientIds: Array.isArray(input.recipientIds) ? input.recipientIds : [],
    relativeRange: input.relativeRange !== false,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz abonelik." };
  const v = parsed.data;
  const def = getReport(scope, v.reportId);
  // Kiracı yalıtımı: rapor kimliği yalnız bu kapsamın kataloğundan ve kullanıcının görebildiği raporlardan çözülür.
  if (!def || !a.actor.reportVisible(def)) return { ok: false, error: "Rapor bulunamadı ya da yetkiniz yok." };
  if (!isSchedulable(def)) return { ok: false, error: "Bu rapor zamanlanamaz (hesaplanan özet). Rapor merkezinden indirebilirsiniz." };
  const filters = cleanViewFilters(def, input.filters);
  if (!filters.ok) return { ok: false, error: filters.error };

  const ctx = a.actor.ctx;
  const db = ctx.supabase;
  // Alıcılar: kiracıda YALNIZ kendi ofisinin aktif kullanıcıları; platformda aktif personel.
  const people =
    scope === "platform"
      ? await db.from("platform_staff").select("id").eq("is_active", true).in("id", v.recipientIds)
      : await db.from("profiles").select("id").eq("tenant_id", ctx.tenantId).eq("is_active", true).in("id", v.recipientIds);
  if (people.error) return { ok: false, error: actionErrorMessage(people.error, "Abonelik kaydedilemedi.") };
  if ((people.data ?? []).length !== v.recipientIds.length) {
    return { ok: false, error: scope === "platform" ? "Alıcılar yalnız aktif platform personeli olabilir." : "Alıcılar yalnız kendi ofisinizin aktif kullanıcıları olabilir." };
  }

  const { count, error: countError } = await ownRows(a.actor, db.from("report_subscriptions").select("id", { count: "exact", head: true }));
  if (countError) return { ok: false, error: MISSING.has(String(countError.code)) ? SETUP_PENDING : actionErrorMessage(countError, "Abonelik kaydedilemedi.") };
  if ((count ?? 0) >= SUBSCRIPTION_PER_OWNER_MAX) return { ok: false, error: `En çok ${SUBSCRIPTION_PER_OWNER_MAX} rapor aboneliğiniz olabilir.` };

  const first = nextRunDay({ frequency: v.frequency, weekday: v.weekday, monthDay: v.monthDay }, trKeyOf(now()));
  const { error } = await db.from("report_subscriptions").insert({
    ...owner(a.actor),
    report_id: def.id,
    name: v.name,
    filters: filters.filters,
    relative_range: v.relativeRange,
    format: v.format,
    frequency: v.frequency,
    weekday: v.weekday,
    month_day: v.monthDay,
    recipient_ids: v.recipientIds,
    active: true,
    next_run_at: runDayStartIso(first),
  });
  if (error) return { ok: false, error: MISSING.has(String(error.code)) ? SETUP_PENDING : actionErrorMessage(error, "Abonelik kaydedilemedi.") };
  revalidate(scope);
  return { ok: true };
}

export async function setReportSubscriptionActive(input: { scope: ReportScope; id: string; active: boolean }): Promise<Result> {
  const scope = scopeOf(input?.scope);
  const a = await actor(scope);
  if (!a.ok) return a;
  const id = String(input.id ?? "").trim();
  if (!id) return { ok: false, error: "Abonelik bulunamadı." };
  const { data, error } = await ownRows(
    a.actor,
    a.actor.ctx.supabase.from("report_subscriptions").update({ active: input.active === true, updated_at: new Date(now()).toISOString() }).eq("id", id),
  ).select("id");
  if (error) return { ok: false, error: actionErrorMessage(error, "Abonelik güncellenemedi.") };
  if (!data || data.length === 0) return { ok: false, error: "Abonelik bulunamadı." };
  revalidate(scope);
  return { ok: true };
}

export async function deleteReportSubscription(input: { scope: ReportScope; id: string }): Promise<Result> {
  const scope = scopeOf(input?.scope);
  const a = await actor(scope);
  if (!a.ok) return a;
  const id = String(input.id ?? "").trim();
  if (!id) return { ok: false, error: "Abonelik bulunamadı." };
  const { data, error } = await ownRows(a.actor, a.actor.ctx.supabase.from("report_subscriptions").delete().eq("id", id)).select("id");
  if (error) return { ok: false, error: actionErrorMessage(error, "Abonelik silinemedi.") };
  if (!data || data.length === 0) return { ok: false, error: "Abonelik bulunamadı." };
  revalidate(scope);
  return { ok: true };
}
