import Link from "@/components/ui/smart-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Users2 } from "lucide-react";
import { getPlanDefinition, getSeatSettings } from "@/lib/billing/plan-definitions";
import { parseSeatTiers } from "@/lib/billing/seat-purchase";
import { seatUtilization } from "@/lib/billing/seat-pricing";
import { warnRatioOf } from "@/lib/billing/seat-settings";
import { SeatChangeDialog } from "./subscription-panel";

/**
 * Ofis detayında SALT OKUNUR koltuk bilgisi (kullanılan / dahil / ek, kilitli fiyat).
 * Sütunlar (extra_seats, seat_price_lock_*) yoksa "etkin değil" gösterilir; sayfa asla bozulmaz.
 * Admin client çağıran sayfadan gelir (yeni service_role kullanımı yok); tenant süzgeci eq ile.
 * Etkin sınır DB `effective_seat_limit()` (plan + ofise özel limit istisnası + ek koltuk) ile okunur; istisna payı
 * ayrıca gösterilir. Ek koltuk değişikliği (gerekçeli, kıst faturalı/ücretsiz) bu karttan açılır (`canEdit`).
 */
export type AdminSeatInfo = {
  enabled: boolean;
  planName: string;
  used: number;
  included: number;
  extra: number;
  /** Ofise özel limit istisnasının koltuğa kattığı (etkin − dahil − ek; yoksa 0). */
  overrideSeats: number;
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
  const [def, settings, effectiveRes] = await Promise.all([
    getPlanDefinition(plan),
    getSeatSettings(),
    admin.rpc("effective_seat_limit", { p_tenant_id: tenantId }).then(
      (r) => r,
      () => ({ data: null, error: true }),
    ),
  ]);
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
  const effective = !effectiveRes.error && effectiveRes.data != null ? Number(effectiveRes.data) : NaN;
  // İstisna payı: sabit değer plan limitinin altındaysa NEGATİF olur (toplam = DB etkin limiti, tetikleyiciyle aynı).
  const overrideSeats = Number.isFinite(effective) ? Math.floor(effective) - def.limits.seats - extra : 0;
  const u = seatUtilization(used, def.limits.seats + overrideSeats, extra, warnRatioOf(settings));
  return {
    enabled,
    planName: def.name,
    used,
    included: def.limits.seats,
    extra,
    overrideSeats,
    lockedBaseMonthlyTry: lockedBase,
    lockedTierCount,
    level: u.level,
    ratio: u.ratio,
    warnPercent: settings.warnPercent,
  };
}

export function SeatInfoCard({
  info,
  teamHref,
  tenantId,
  canEdit = false,
}: {
  info: AdminSeatInfo;
  teamHref?: string;
  tenantId?: string;
  /** "billing" modülü: ek koltuk diyaloğu görünür. */
  canEdit?: boolean;
}) {
  const total = info.included + info.overrideSeats + info.extra;
  const tone =
    info.level === "full" ? "text-danger-600" : info.level === "warn80" ? "text-amber-600" : "text-text-muted";
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <Users2 className="h-4 w-4" /> Koltuk bilgisi
        </p>
        {canEdit && tenantId && info.enabled ? <SeatChangeDialog tenantId={tenantId} currentExtra={info.extra} /> : null}
      </div>
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
                <Link href={teamHref} className="hover:text-brand-600 hover:underline">{info.used} / {total}</Link>
              ) : (
                <>{info.used} / {total}</>
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
            <dd className="text-xs text-text-faint">
              {info.planName}
              {info.overrideSeats !== 0 ? ` · ${info.overrideSeats > 0 ? "+" : "−"}${Math.abs(info.overrideSeats)} istisna` : ""}
            </dd>
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
