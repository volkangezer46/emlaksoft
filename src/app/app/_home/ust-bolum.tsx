import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { DemoModeBanner } from "@/components/app/demo-mode-banner";
import { createClient } from "@/lib/supabase/server";
import { loadSampleStatus } from "@/lib/sample-status";
import { getCachedOfficeScore, getOfficeScoreCached } from "@/lib/office-score";
import { DAY_MS, msUntil } from "@/lib/clock";
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

/**
 * Demo modu bandı: örnek veri yüklüyken ana ekranın üstünde "Demo modundasınız — gerçek kullanıma başla"
 * şeridi (kapatılabilir; gerçek veri girildikçe öneri değişir). Onay satır içi panelde, sayılarla; bkz.
 * actions/sample-data.ts. TV modunda hiç gösterilmez. Sorgular hata verirse bant gösterilmez (sahte durum yok).
 */
export async function OrnekVeri({ ctx }: { ctx: HomeCtx }) {
  const tenant = await loadTenantRow(ctx);
  const sampleSeededAt = tenant?.sample_seeded_at ?? null;
  if (!ctx.tenantId) return null;
  const status = await loadSampleStatus(await createClient(), ctx.tenantId, sampleSeededAt).catch(() => null);
  if (!status || !status.active || status.total === 0) return null;
  return (
    <DemoModeBanner
      variant={status.variant}
      rows={status.rows.map((r) => ({ label: r.label, count: r.count }))}
      total={status.total}
      canClear={ctx.isManagement}
    />
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
