import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { isManagerRole } from "@/lib/approvals";
import type { AppModule } from "@/lib/permissions";
import { getPlan } from "@/lib/billing/plans";

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
  tone: "danger" | "warn";
};

type Input = {
  supabase: SupabaseClient;
  tenantId: string | null;
  userId: string | null;
  role: string | null | undefined;
  accessible: readonly AppModule[];
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

export async function getNavBadges({ supabase, tenantId, userId, role, accessible }: Input): Promise<NavBadge[]> {
  if (!tenantId || !userId) return [];
  const nowIso = new Date(now()).toISOString();
  const jobs: Promise<NavBadge | null>[] = [];

  if (accessible.includes("tasks")) {
    jobs.push(
      (async () => {
        const { count, error } = await supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "open")
          .eq("assigned_to", userId)
          .lt("due_at", nowIso);
        if (error || !count) return null;
        return { itemHref: "/app/gorevler", href: "/app/gorevler?filter=overdue&mine=1", count, label: "geciken görevin", tone: "danger" as const };
      })(),
    );
  }

  if (accessible.includes("commissions") && isManagerRole(role)) {
    jobs.push(
      (async () => {
        const { count, error } = await supabase
          .from("approval_requests")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "bekliyor")
          .neq("requested_by", userId);
        if (error || !count) return null;
        return { itemHref: "/app/onaylar", href: "/app/onaylar?kim=bana", count, label: "onayınızı bekleyen talebin", tone: "warn" as const };
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

export async function getPlanUsage(supabase: SupabaseClient, tenantId: string | null, plan: string | undefined): Promise<PlanUsageRow[]> {
  if (!tenantId) return [];
  const limits = getPlan(plan ?? "office").limits;
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

