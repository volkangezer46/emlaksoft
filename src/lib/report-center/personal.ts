/**
 * Rapor merkezi kişiselleştirme okuyucusu (SUNUCU, DG4): kayıtlı görünümler, zamanlanmış abonelikler ve alıcı listesi.
 * Kiracıda `ctx.supabase` RLS'li oturum istemcisidir (kendi + ofiste paylaşılan görünüm; abonelikte kendi + kendisine
 * gelen, ofis sahibi/gm için ofisteki tümü);
 * platformda bağlamın servis istemcisi (personel + `reports` kapısından sonra), personel kimliğiyle açık süzgeç.
 * Tablolar yoksa (migration bekliyor) `ready: false` döner; rapor merkezi bozulmaz.
 */
import { PLATFORM_ROLE_LABELS, type PlatformRole } from "@/lib/platform-access";
import { roleLabel } from "@/lib/role-labels";
import { savedViewHref, storedViewFilters } from "./saved-views";
import { FREQUENCY_LABELS, scheduleLabel, type SubscriptionFrequency } from "./schedule";
import type { Filters, ReportContext, ReportDef, ReportFormat } from "./types";

export type ReportViewItem = {
  id: string;
  reportId: string;
  reportTitle: string;
  name: string;
  filters: Filters;
  href: string;
  shared: boolean;
  mine: boolean;
};

export type ReportSubscriptionItem = {
  id: string;
  reportId: string;
  reportTitle: string;
  reportHref: string;
  name: string;
  format: ReportFormat;
  frequencyLabel: string;
  schedule: string;
  relativeRange: boolean;
  recipients: string[];
  active: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  /** Aboneliği oluşturan kişi (kendisiyse "Siz"). */
  ownerName: string;
  /** Kendi aboneliği (sil + durdur). */
  mine: boolean;
  /** Alıcısı olduğu başkasının aboneliği ("Beni çıkar"). */
  incoming: boolean;
  /** Durdur/sürdür yetkisi (sahibi ya da ofis sahibi/gm). */
  canToggle: boolean;
};

export type PersonOption = { id: string; name: string; hint: string };

export type Personalization = {
  ready: boolean;
  views: ReportViewItem[];
  subscriptions: ReportSubscriptionItem[];
  people: PersonOption[];
  selfId: string;
};

const MISSING = new Set(["42P01", "PGRST205", "42703"]);

type ViewRow = { id: string; report_id: string; name: string; filters: unknown; shared: boolean; user_id: string | null; staff_id: string | null };
type SubRow = {
  id: string;
  user_id: string | null;
  staff_id: string | null;
  report_id: string;
  name: string;
  format: ReportFormat;
  frequency: SubscriptionFrequency;
  weekday: number | null;
  month_day: number | null;
  relative_range: boolean;
  recipient_ids: string[];
  active: boolean;
  next_run_at: string;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
};

export async function loadPersonalization(ctx: ReportContext, reports: readonly ReportDef[], reportId: string | null): Promise<Personalization> {
  const empty: Personalization = { ready: false, views: [], subscriptions: [], people: [], selfId: ctx.userId };
  const platform = ctx.scope === "platform";
  const db = ctx.supabase;
  const byId = new Map(reports.map((r) => [r.id, r]));

  let views = db.from("report_saved_views").select("id, report_id, name, filters, shared, user_id, staff_id").eq("scope", ctx.scope);
  views = platform ? views.is("tenant_id", null).or(`staff_id.eq.${ctx.userId},shared.eq.true`) : views.eq("tenant_id", ctx.tenantId!);
  if (reportId) views = views.eq("report_id", reportId);

  // Ofis sahibi/gm ofisteki tüm abonelikleri görür (durdurabilir); diğerleri kendi + kendisine gelen.
  const manager = !platform && (ctx.role === "owner" || ctx.role === "gm");
  let subs = db
    .from("report_subscriptions")
    .select("id, user_id, staff_id, report_id, name, format, frequency, weekday, month_day, relative_range, recipient_ids, active, next_run_at, last_run_at, last_status, last_error")
    .eq("scope", ctx.scope);
  // ctx.userId oturumdan gelen UUID'dir; or() dizgesine güvenle gömülür.
  if (platform) subs = subs.or(`staff_id.eq.${ctx.userId},recipient_ids.cs.{${ctx.userId}}`);
  else {
    subs = subs.eq("tenant_id", ctx.tenantId!);
    if (!manager) subs = subs.or(`user_id.eq.${ctx.userId},recipient_ids.cs.{${ctx.userId}}`);
  }
  if (reportId) subs = subs.eq("report_id", reportId);

  const people = platform
    ? db.from("platform_staff").select("id, full_name, role").eq("is_active", true).order("full_name", { ascending: true }).limit(300)
    : db.from("profiles").select("id, full_name, role").eq("tenant_id", ctx.tenantId!).eq("is_active", true).order("full_name", { ascending: true }).limit(300);

  const [vRes, sRes, pRes] = await Promise.all([
    views.order("name", { ascending: true }).limit(200),
    subs.order("created_at", { ascending: true }).limit(manager ? 300 : 100),
    people,
  ]);
  if ((vRes.error && MISSING.has(String(vRes.error.code))) || (sRes.error && MISSING.has(String(sRes.error.code)))) return empty;
  if (vRes.error || sRes.error) {
    console.error("report.personalization", vRes.error?.message ?? sRes.error?.message);
    return empty;
  }

  const personRows = (pRes.data ?? []) as { id: string; full_name: string | null; role: string }[];
  const names = new Map(personRows.map((p) => [p.id, p.full_name?.trim() || "Adsız kullanıcı"]));
  const out: Personalization = {
    ready: true,
    selfId: ctx.userId,
    people: personRows.map((p) => ({
      id: p.id,
      name: p.full_name?.trim() || "Adsız kullanıcı",
      hint: platform ? (PLATFORM_ROLE_LABELS[p.role as PlatformRole] ?? p.role) : roleLabel(p.role),
    })),
    views: [],
    subscriptions: [],
  };

  for (const v of (vRes.data ?? []) as ViewRow[]) {
    const def = byId.get(v.report_id);
    if (!def) continue; // görünürlüğü olmayan rapor (yetki/paket) listelenmez
    const filters = storedViewFilters(def, v.filters);
    out.views.push({
      id: v.id,
      reportId: def.id,
      reportTitle: def.title,
      name: v.name,
      filters,
      href: savedViewHref(ctx.scope, def.id, filters),
      shared: v.shared,
      mine: (platform ? v.staff_id : v.user_id) === ctx.userId,
    });
  }

  for (const s of (sRes.data ?? []) as SubRow[]) {
    const def = byId.get(s.report_id);
    const ownerId = platform ? s.staff_id : s.user_id;
    const mine = ownerId === ctx.userId;
    const incoming = !mine && (s.recipient_ids ?? []).includes(ctx.userId);
    out.subscriptions.push({
      id: s.id,
      reportId: s.report_id,
      reportTitle: def?.title ?? "Kaldırılmış ya da erişiminiz olmayan rapor",
      reportHref: def ? savedViewHref(ctx.scope, def.id, {}) : "",
      name: s.name,
      format: s.format,
      frequencyLabel: FREQUENCY_LABELS[s.frequency] ?? s.frequency,
      schedule: scheduleLabel({ frequency: s.frequency, weekday: s.weekday, monthDay: s.month_day }),
      relativeRange: s.relative_range,
      recipients: (s.recipient_ids ?? []).map((id) => names.get(id) ?? "Erişimi kalkmış kişi"),
      active: s.active,
      nextRunAt: s.next_run_at,
      lastRunAt: s.last_run_at,
      lastStatus: s.last_status,
      lastError: s.last_error,
      ownerName: mine ? "Siz" : ((ownerId && names.get(ownerId)) ?? "Erişimi kalkmış kişi"),
      mine,
      incoming,
      canToggle: mine || manager,
    });
  }
  return out;
}
