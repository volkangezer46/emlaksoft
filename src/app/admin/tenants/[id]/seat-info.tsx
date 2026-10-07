import Link from "@/components/ui/smart-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Users2 } from "lucide-react";
import { getPlanDefinition, getSeatSettings } from "@/lib/billing/plan-definitions";
import { parseSeatTiers } from "@/lib/billing/seat-purchase";
import { seatUtilization } from "@/lib/billing/seat-pricing";
import { warnRatioOf } from "@/lib/billing/seat-settings";

/**
 * Ofis detayında SALT OKUNUR koltuk bilgisi (kullanılan / dahil / ek, kilitli fiyat).
 * Sütunlar (extra_seats, seat_price_lock_*) yoksa "etkin değil" gösterilir; sayfa asla bozulmaz.
 * Admin client çağıran sayfadan gelir (yeni service_role kullanımı yok); tenant süzgeci eq ile.
 */
export type AdminSeatInfo = {
  enabled: boolean;
  planName: string;
  used: number;
  included: number;
  extra: number;
  lockedBaseMonthlyTry: number | null;
  lockedTierCount: number;
  level: "ok" | "warn80" | "full";
  ratio: number;
  warnPercent: number;
};

export async function loadAdminSeatInfo(
  admin: SupabaseClient,
  tenantId: string,
  plan: string,
  used: number,
): Promise<AdminSeatInfo> {
  const [def, settings] = await Promise.all([getPlanDefinition(plan), getSeatSettings()]);
  let enabled = false;
  let extra = 0;
  let lockedBase: number | null = null;
  let lockedTierCount = 0;
  try {
    const full = await admin
      .from("subscriptions")
      .select("extra_seats, seat_price_lock_base_try, seat_price_lock_tiers")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const row = full.error
      ? await admin.from("subscriptions").select("extra_seats").eq("tenant_id", tenantId).maybeSingle()
      : full;
    if (!row.error) {
      enabled = true;
      const r = (row.data ?? {}) as Record<string, unknown>;
      extra = Math.max(0, Math.floor(Number(r.extra_seats ?? 0)) || 0);
      const lb = Number(r.seat_price_lock_base_try);
      lockedBase = Number.isFinite(lb) && lb > 0 ? lb : null;
      lockedTierCount = parseSeatTiers(r.seat_price_lock_tiers)?.length ?? 0;
    }
  } catch (e) {
    console.error("loadAdminSeatInfo", e);
  }
  const u = seatUtilization(used, def.limits.seats, extra, warnRatioOf(settings));
  return {
    enabled,
    planName: def.name,
    used,
    included: def.limits.seats,
    extra,
    lockedBaseMonthlyTry: lockedBase,
    lockedTierCount,
    level: u.level,
    ratio: u.ratio,
    warnPercent: settings.warnPercent,
  };
}

export function SeatInfoCard({ info, teamHref }: { info: AdminSeatInfo; teamHref?: string }) {
  const tone =
    info.level === "full" ? "text-danger-600" : info.level === "warn80" ? "text-amber-600" : "text-text-muted";
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
        <Users2 className="h-4 w-4" /> Koltuk bilgisi (salt okunur)
      </p>
      {!info.enabled ? (
        <p className="mt-2 text-sm text-text-muted">
          Ek kullanıcı (koltuk) özelliği henüz etkin değil: veritabanı hazırlığı tamamlanınca burada satın alınmış ek ve kilitli fiyat görünür.
          Şimdilik {info.planName} paketinin {info.included} kullanıcı limiti geçerlidir.
        </p>
      ) : (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold text-text-muted">Kullanılan</dt>
            <dd className="numeric font-display text-lg font-extrabold text-ink-950">
              {teamHref ? (
                <Link href={teamHref} className="hover:text-brand-600 hover:underline">{info.used} / {info.included + info.extra}</Link>
              ) : (
                <>{info.used} / {info.included + info.extra}</>
              )}
            </dd>
            <dd className={`text-xs font-semibold ${tone}`}>
              %{Math.round(info.ratio * 100)} dolu
              {info.level === "full" ? " (limit doldu)" : info.level === "warn80" ? ` (eşik %${info.warnPercent} aşıldı)` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-text-muted">Pakete dahil</dt>
            <dd className="numeric font-display text-lg font-extrabold text-ink-950">{info.included}</dd>
            <dd className="text-xs text-text-faint">{info.planName}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-text-muted">Satın alınmış ek</dt>
            <dd className="numeric font-display text-lg font-extrabold text-ink-950">{info.extra}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-text-muted">Kilitli fiyat</dt>
            <dd className="text-sm font-semibold text-ink-950">
              {info.lockedBaseMonthlyTry || info.lockedTierCount > 0
                ? [
                    info.lockedBaseMonthlyTry ? `Taban ${new Intl.NumberFormat("tr-TR").format(info.lockedBaseMonthlyTry)} ₺/ay` : null,
                    info.lockedTierCount > 0 ? `${info.lockedTierCount} kademe` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Yok (liste fiyatı)"}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
