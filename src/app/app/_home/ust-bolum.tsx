import { formatTry } from "@/lib/format";
import Link from "next/link";
import { cookies } from "next/headers";
import { AlertTriangle, Gift } from "lucide-react";
import { DEMO_SEED_FAILED_COOKIE } from "@/lib/sample-registration-seed";
import { readTryOverview } from "@/lib/try-credits/reader";
import { readMyDashboard } from "@/lib/growth/engine";
import { OrnekVeriYenile } from "./ornek-veri-yenile";
import { createClient } from "@/lib/supabase/server";
import { DAY_MS, msUntil } from "@/lib/clock";
import { getCachedOfficeScore, getOfficeScoreCached } from "@/lib/office-score";
import { TvAutoRefresh, TvClock } from "../tv-mode";
import { loadExpiringAuthority, loadTenantRow, type HomeCtx } from "./data";

/** TV modu: üst bilgi satırı (ofis adı + ofis skoru + canlı saat) + 60sn otomatik yenileme. */
export async function TvUst({ ctx }: { ctx: HomeCtx }) {
  const [tenant, score] = await Promise.all([
    loadTenantRow(ctx),
    ctx.tenantId ? getOfficeScoreCached(ctx.tenantId) : getCachedOfficeScore(),
  ]);
  return (
    <>
      <TvAutoRefresh intervalMs={60_000} />
      <div className="theme-dark flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] bg-[image:var(--grad-ink)] px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="status-pulse h-2.5 w-2.5 rounded-full bg-mint-400" />
          <p className="font-display text-lg font-bold text-white">{tenant?.name ?? "EmlakSoft Ofis"}</p>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/70">
            Canlı panel · 60 sn’de bir yenilenir
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/app/raporlar"
            className="focus-ring rounded-[var(--radius-control)] text-right text-xs font-semibold text-white/80 hover:text-white"
          >
            Ofis skoru <span className="font-display text-lg font-extrabold text-mint-400">{score.score}</span> · {score.label}
          </Link>
          <TvClock />
          <Link
            href="/app"
            className="focus-ring press rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            Çık
          </Link>
        </div>
      </div>
    </>
  );
}

/** Yetki belgesi uyarı kartı (kaynak: properties.authorization_end) — sadece yaklaşan kayıt varsa görünür. */
export async function YetkiUyari({ ctx }: { ctx: HomeCtx }) {
  const { data: expiringList } = await loadExpiringAuthority(ctx);
  if (expiringList.length === 0) return null;
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/[0.06] p-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-amber-400/20 text-amber-600">
        <AlertTriangle className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-amber-700">
          {expiringList.length} portföyün yetki belgesi 15 gün içinde bitiyor
        </p>
        <ul className="mt-2 space-y-1">
          {expiringList.map((p) => {
            const expires = new Date(p.authority_expires_at as string);
            const daysLeft = Math.ceil(msUntil(expires) / DAY_MS);
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-700/80">
                <Link href={`/app/portfoyler/${p.id}`} className="font-semibold hover:underline">
                  {p.title ?? p.property_code}
                </Link>
                <span className="text-amber-600/60">·</span>
                <span className={daysLeft <= 5 ? "font-bold text-red-600" : ""}>{daysLeft} gün kaldı</span>
                <span className="text-amber-600/60">({expires.toLocaleDateString("tr-TR")})</span>
              </li>
            );
          })}
        </ul>
      </div>
      <Link
        href="/app/portfoyler"
        className="focus-ring shrink-0 rounded-[var(--radius-control)] border border-amber-400/50 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-400/20"
      >
        Portföylere git
      </Link>
    </div>
  );
}

/**
 * Kayıtta seçilen örnek veri yüklenemediyse (signUp çerez bırakır) ve ofis hâlâ örneksiz ise
 * "yeniden dene" bandı. Çerez yoksa ya da veri zaten yüklüyse hiçbir şey çizmez.
 */
export async function OrnekVeriYenileBandi({ ctx }: { ctx: HomeCtx }) {
  if (!ctx.tenantId || !ctx.isManagement) return null;
  const jar = await cookies();
  if (jar.get(DEMO_SEED_FAILED_COOKIE)?.value !== "1") return null;
  const tenant = await loadTenantRow(ctx);
  if (tenant?.sample_seeded_at) return null;
  return <OrnekVeriYenile />;
}

/**
 * Hoş geldin kredisi duyurusu: YALNIZ ofisin kullanılabilir hesap kredisi varsa gösterilir; tutar
 * `growth_referral_settings.welcome_credit_try` değerinden (my_dashboard RPC) okunur, kodda sabit değildir.
 * Gösterilen tutar mevcut kullanılabilir bakiyeyi aşmaz. Tıklayınca cüzdan sekmesine gider.
 */
export async function HosgeldinKredisi({ ctx }: { ctx: HomeCtx }) {
  if (!ctx.tenantId) return null;
  const supabase = await createClient();
  const [overview, dash] = await Promise.all([
    readTryOverview(supabase),
    readMyDashboard(supabase).catch(() => null),
  ]);
  const welcome = dash?.welcome_credit_try ?? 0;
  if (!overview || overview.available <= 0 || welcome <= 0) return null;
  const amount = Math.min(welcome, overview.available);
  return (
    <Link
      href="/app/abonelik?sekme=cuzdan"
      className="focus-ring press flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-mint-400/40 bg-mint-400/[0.08] px-4 py-2.5 text-sm text-ink-950 transition hover:border-mint-500/60"
    >
      <Gift className="h-4 w-4 shrink-0 text-mint-600" aria-hidden />
      <span>
        <span className="font-bold">{formatTry(amount)} hoş geldin krediniz</span>{" "}
        ödemede kullanılabilir.
      </span>
      <span className="ml-auto text-xs font-semibold underline underline-offset-2">Cüzdanı gör</span>
    </Link>
  );
}
