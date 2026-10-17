import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { canDecideApproval, isApprovalDeciderRole } from "@/lib/approvals";
import type { EffectivePermissions } from "@/lib/permissions-merge";
import type { AppModule } from "@/lib/permissions";
import { resolvePlanDef, type PlanDef } from "@/lib/billing/plans";
import { MANAGEMENT_ROLES, resolveScope, type ScopeValue } from "@/lib/ui/scope";

/**
 * Yan menü sayı rozetleri — YALNIZ gerçek veri (oturum açmış kullanıcının RLS'li
 * istemcisiyle head-count). Uydurma/sabit sayı yok; sorgu hata verirse rozet çıkmaz.
 *
 * `itemHref`: rozetin ait olduğu menü öğesinin (veya sekmesinin) yolu.
 * `href`: rozete tıklayınca gidilecek FİLTRELİ hedef (sıfır çıkmaz metrik kuralı).
 */
export type NavBadge = {
  itemHref: string;
  href: string;
  count: number;
  label: string;
  /** Sayaç kuralı: kırmızı = gecikmiş, turuncu = karar bekliyor, gri (info) = bilgi. */
  tone: "danger" | "warn" | "info";
};

type Input = {
  supabase: SupabaseClient;
  tenantId: string | null;
  userId: string | null;
  role: string | null | undefined;
  accessible: readonly AppModule[];
  /** Etkin izin (verilmezse istek içi önbellekli `getEffectivePermissions`; layout aynı değeri zaten okur). */
  perms?: EffectivePermissions;
};

/** Rozetin ait olduğu modül: spekülatif (izin beklemeden) hesaplanan rozetler bununla süzülür. */
const BADGE_MODULE: Record<string, AppModule> = {
  "/app/gorevler": "tasks",
  "/app/onaylar": "commissions",
};

/** Etkin izin netleştikten sonra yetkisiz modülün rozetini düşürür (yetki kapısı korunur). */
export function filterNavBadgesByAccess(badges: readonly NavBadge[], accessible: readonly AppModule[]): NavBadge[] {
  return badges.filter((b) => {
    const mod = BADGE_MODULE[b.itemHref];
    return mod ? accessible.includes(mod) : false;
  });
}

/**
 * Menü sekmeleri için GERÇEK sayılar (zaten çekilen kullanım head-count'ları).
 * Sayı yoksa anahtar hiç yazılmaz → sekmede sayaç gösterilmez.
 */
export function tabCountsFromUsage(usage: readonly PlanUsageRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of usage) out[row.href] = row.used;
  return out;
}

/**
 * GECİKMİŞ GÖREV — TEK TANIM (C10): açık (`status=open`), bana atanmış, vadesi ŞİMDİDEN önce. Menü/alt çubuk rozeti
 * (bu dosya + kabuk RPC'sinin `overdue_tasks` alanı aynı koşul), ana ekrandaki "gecikmiş" sayısı ve
 * `/app/gorevler?filter=overdue&mine=1` listesi bu kümeyi sayar. Yeni yerde sayaç gerekiyorsa bu sorguyu kullanın.
 */
export const OVERDUE_TASKS_HREF = "/app/gorevler?filter=overdue&mine=1";
export const OVERDUE_TASKS_LABEL = "geciken görev";
export function overdueTasksCountQuery(supabase: SupabaseClient, tenantId: string, userId: string, nowIso: string = new Date(now()).toISOString()) {
  return supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .eq("assigned_to", userId)
    .lt("due_at", nowIso);
}

/**
 * OFİS GENELİ GECİKMİŞ GÖREV — ana ekranın "Dikkat gerektirenler" listesi ofis görünümünde bu kümeyi sayar (`loadTaskSummary`
 * ve `get_tasks_snapshot` office.overdue): açık, vadesi BUGÜNÜN (TR) başından önce, atanandan bağımsız. Örnek veri kapsamı
 * çağıranda (`SampleKpiScope.apply`) uygulanır. Hedef: `/app/gorevler?filter=overdue` (Dikkat kalemiyle aynı süzgeç).
 */
export const OFFICE_OVERDUE_TASKS_HREF = "/app/gorevler?filter=overdue";
export function officeOverdueTasksCountQuery(supabase: SupabaseClient, tenantId: string, dayStartIso: string) {
  return supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .lt("due_at", dayStartIso);
}

/**
 * Ana Sayfa acil sayacının kapsamı — ana ekranın kapsam kararıyla AYNI (`(bugun)/page.tsx`: yönetim rolü seçebilir, çerez
 * yoksa sahip/GM/şube müdürü "Ofis geneli"; diğer roller her zaman "Benim işlerim").
 */
export function homeUrgentScope(role: string | null | undefined, scopeCookie: string | null | undefined): ScopeValue {
  const management = typeof role === "string" && MANAGEMENT_ROLES.includes(role);
  return resolveScope({ canSwitch: management, param: undefined, cookie: scopeCookie ?? (management ? "ofis" : undefined) }).scope;
}

/**
 * Ana Sayfa acil sayacı = ana ekran "Dikkat gerektirenler" listesindeki ACİL kalemlerin toplamı (geciken görev + geciken
 * kira). Yan menü acil toplamı tüm kırmızı rozetler + akışlı kırmızı sayaçlardır; bu yüzden kapsam veri kaynağında kurulur:
 *  - "Benim işlerim" (danışman; ya da kendi işlerini seçen yönetici): kişisel geciken görev rozeti (`overdueTasksCountQuery`)
 *    olduğu gibi kalır; Dikkat da kişisel tanımı sayar.
 *  - "Ofis geneli" (yönetim): kişisel rozet DÜŞER; ofis geneli geciken görev akışlı sayaçlara (`loadNavCounts`,
 *    `alerts["/app/gorevler"]`, `officeOverdueTasksCountQuery`) geçer. Toplam iki kez sayılmaz ve Dikkat ile aynı kümedir.
 */
export function navBadgesForHomeScope(badges: readonly NavBadge[], scope: ScopeValue): NavBadge[] {
  return scope === "ofis" ? badges.filter((b) => !(b.itemHref === "/app/gorevler" && b.href === OVERDUE_TASKS_HREF)) : [...badges];
}

export async function getNavBadges({ supabase, tenantId, userId, role, accessible, perms }: Input): Promise<NavBadge[]> {
  if (!tenantId || !userId) return [];
  const nowIso = new Date(now()).toISOString();
  const jobs: Promise<NavBadge | null>[] = [];

  if (accessible.includes("tasks")) {
    jobs.push(
      (async () => {
        const { count, error } = await overdueTasksCountQuery(supabase, tenantId, userId, nowIso);
        if (error || !count) return null;
        return { itemHref: "/app/gorevler", href: OVERDUE_TASKS_HREF, count, label: OVERDUE_TASKS_LABEL, tone: "danger" as const };
      })(),
    );
  }

  if (accessible.includes("commissions") && isApprovalDeciderRole(role)) {
    jobs.push(
      (async () => {
        // Karar yetkisi (canDecideApproval) ile sayım paralel: ek bekleme yok; yetkisizse rozet çıkmaz (SK10 / B164).
        const [effective, { count, error }] = await Promise.all([
          perms ?? import("@/lib/permissions-effective").then((m) => m.getEffectivePermissions(tenantId, role, userId)),
          supabase
            .from("approval_requests")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("status", "bekliyor")
            .neq("requested_by", userId),
        ]);
        if (!canDecideApproval(role, effective) || error || !count) return null;
        return { itemHref: "/app/onaylar", href: "/app/onaylar?kim=bana", count, label: "onay bekliyor", tone: "warn" as const };
      })(),
    );
  }

  const settled = await Promise.allSettled(jobs);
  return settled.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
}

/**
 * Yan menü "Kullanım" kartı: paket limitine karşı GERÇEK kullanım. Sayımlar abonelik
 * sayfası ve DB entitlement tetikleyicisiyle aynı kapsamdadır. Limitsiz (null) kalemler
 * hiç döndürülmez: yüzde/çubuk gösterilmez.
 */
export type PlanUsageRow = { key: "seats" | "properties" | "customers"; label: string; used: number; limit: number; href: string };

/**
 * B11: her gezintide exact count taraması yerine önce planlayıcı tahmini (ucuz) okunur;
 * tahmin limitin yarısına yaklaşmadıysa tahmin kullanılır, yaklaştıysa kesin sayım yapılır
 * (limite yakın ofiste doğruluk korunur, büyük ofiste tam tarama her sayfa yüklemesinde olmaz).
 * Aynı RLS'li istemci ve tenant süzgeci kullanılır; izolasyon değişmez.
 */
export const USAGE_EXACT_THRESHOLD = 0.5;
export async function hybridCount(
  limit: number,
  run: (mode: "exact" | "estimated") => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<{ count: number | null; error: unknown }> {
  const est = await run("estimated");
  if (est.error || est.count == null) return run("exact");
  if (est.count >= limit * USAGE_EXACT_THRESHOLD) return run("exact");
  return est;
}

/** `catalog`: adminden eklenen pakette limit kaynağı (getCatalogForPlan); taban kimlikte kod tanımı kullanılır. */
export async function getPlanUsage(
  supabase: SupabaseClient,
  tenantId: string | null,
  plan: string | undefined,
  catalog?: readonly PlanDef[],
): Promise<PlanUsageRow[]> {
  if (!tenantId) return [];
  const limits = resolvePlanDef(plan, catalog).limits;
  const jobs: Promise<PlanUsageRow | null>[] = [];
  if (limits.seats != null) {
    const limit = limits.seats;
    jobs.push(
      (async () => {
        const { count, error } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true);
        return error || count == null ? null : { key: "seats" as const, label: "Kullanıcı", used: count, limit, href: "/app/ekip" };
      })(),
    );
  }
  if (limits.activeProperties != null) {
    const limit = limits.activeProperties;
    jobs.push(
      (async () => {
        const { count, error } = await hybridCount(limit, (mode) =>
          supabase
            .from("properties")
            .select("id", { count: mode, head: true })
            .eq("tenant_id", tenantId)
            .is("deleted_at", null)
            .in("status", ["draft", "live", "reserved"]),
        );
        return error || count == null ? null : { key: "properties" as const, label: "Aktif ilan", used: count, limit, href: "/app/portfoyler" };
      })(),
    );
  }
  if (limits.customers != null) {
    const limit = limits.customers;
    jobs.push(
      (async () => {
        const { count, error } = await hybridCount(limit, (mode) =>
          supabase.from("customers").select("id", { count: mode, head: true }).eq("tenant_id", tenantId).is("deleted_at", null),
        );
        return error || count == null ? null : { key: "customers" as const, label: "Müşteri", used: count, limit, href: "/app/musteriler" };
      })(),
    );
  }
  const settled = await Promise.allSettled(jobs);
  return settled.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
}

