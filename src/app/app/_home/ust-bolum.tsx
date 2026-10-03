import Link from "next/link";
import { AlertTriangle, Sparkles } from "lucide-react";
import { clearSampleDataForm } from "@/app/actions/sample-data";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
 * Örnek veri onboarding'i — boş ofiste (müşteri+portföy 0, hiç yüklenmemiş) CTA;
 * yüklüyken ince amber şerit (bkz. actions/sample-data.ts). TV modunda hiç gösterilmez.
 */
export async function OrnekVeri({ ctx }: { ctx: HomeCtx }) {
  const tenant = await loadTenantRow(ctx);
  const sampleSeededAt = tenant?.sample_seeded_at ?? null;

  if (sampleSeededAt) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/[0.08] px-4 py-2.5">
        <p className="flex items-center gap-2 text-xs font-semibold text-amber-700">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          Örnek verilerle geziyorsunuz — hazır olduğunuzda temizleyip kendi kayıtlarınızı ekleyin.
        </p>
        <ConfirmDialog
          trigger={
            <button
              type="button"
              className="focus-ring press shrink-0 rounded-[var(--radius-control)] border border-amber-400/50 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-400/20"
            >
              Temizle
            </button>
          }
          title="Örnek veriler silinsin mi?"
          description="Tüm örnek müşteri, portföy, talep, görev, randevu ve anlaşma kayıtları kalıcı olarak silinir. Gerçek kayıtlarınıza dokunulmaz."
          confirmLabel="Kalıcı sil"
          formAction={clearSampleDataForm}
        />
      </div>
    );
  }
  // Boş ofis: örnek veri eylemi artık "Başlayalım" kartında (bkz. baslayalim.tsx).
  return null;
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
