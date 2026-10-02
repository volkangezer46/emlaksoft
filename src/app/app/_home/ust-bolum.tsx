import Link from "next/link";
import { AlertTriangle, Plus, Sparkles, Tv } from "lucide-react";
import { clearSampleDataForm } from "@/app/actions/sample-data";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getCachedOfficeScore, getOfficeScoreCached } from "@/lib/office-score";
import { DAY_MS, msUntil, now } from "@/lib/clock";
import { SampleDataCta } from "../sample-data-cta";
import { TvAutoRefresh, TvClock } from "../tv-mode";
import { WidgetEditToggle } from "../dashboard-widgets";
import { loadExpiringAuthority, loadKpiCounts, loadTenantRow, type HomeCtx } from "./data";
import { greetingFor } from "./helpers";

/**
 * Tek selamlama + tarih + birincil eylemler. Veri çekmez, anında render edilir.
 * Ofis skoru burada TEKRARLANMAZ — üst çubukta zaten var (yalnız TV modunda gösterilir).
 */
export function SayfaBasligi({ firstName, hasName }: { firstName: string; hasName: boolean }) {
  const at = new Date(now());
  const hour = Number(
    new Intl.DateTimeFormat("tr-TR", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Istanbul" }).format(at),
  );
  const greeting = greetingFor(Number.isFinite(hour) ? hour : 9);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold text-ink-950 md:text-3xl">
          {hasName ? `${greeting}, ${firstName}` : greeting}
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          {new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" }).format(at)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/app/musteriler"
          className="btn-shine focus-ring inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" /> Müşteri
        </Link>
        <WidgetEditToggle className="border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600" />
        <Link
          href="/app?tv=1"
          title="TV modu — büyük ekran görünümü"
          aria-label="TV modunu aç"
          className="focus-ring press grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600"
        >
          <Tv className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

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
  const [tenant, counts] = await Promise.all([loadTenantRow(ctx), loadKpiCounts(ctx)]);
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
  if (counts.customerCount === 0 && counts.propertyCount === 0) return <SampleDataCta />;
  return null;
}

/** Yetki belgesi uyarı kartı — sadece yaklaşan kayıt varsa görünür. */
export async function YetkiUyari() {
  const { data: expiringList } = await loadExpiringAuthority();
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
