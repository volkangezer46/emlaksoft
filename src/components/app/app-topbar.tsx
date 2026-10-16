import type { ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { CalendarDays, MonitorPlay } from "lucide-react";

/**
 * /app ÜST ÇUBUĞU (v4 referansı) — SUNUCU bileşeni, yalnız yerleşim: solda sayfa başlığı + tazelik ("Ana sayfa" /
 * "Son güncelleme 00:22 · Taze"), ortada geniş arama (Ctrl K), sağda "+ Yeni ▾" · bildirim zili · takvim · TV modu ·
 * avatar (ad + ofis). Dilimler (`trail`, `search`, `bell`, `user`…) çağıran tarafından verilir; layout gerçek veriyle,
 * görsel harness örnek veriyle aynı bileşeni çizer. Telefonda yalnız arama, zil ve avatar (plan 2.3): "+ Yeni" ve "Menü"
 * alt çubukta, takvim ve TV yalnız `lg` ve üstünde. Çentik bandının ALTINA yapışır; yatayda safe-area.
 */
export const TOPBAR_ICON_CLASS =
  "topbar-icon focus-ring press hidden h-10 w-10 touch:h-11 touch:w-11 place-items-center rounded-[var(--radius-control)] border border-hairline bg-surface text-text-muted shadow-[var(--elev-1)] transition hover:bg-surface-hover hover:text-text lg:grid";

export function AppTopbar({
  trail,
  search,
  quickCreate,
  extras,
  bell,
  calendarHref,
  tvHref,
  user,
}: {
  trail?: ReactNode;
  search: ReactNode;
  quickCreate?: ReactNode;
  /** Analiz bakiyesi, Ops bağlantısı gibi koşullu küçük öğeler. */
  extras?: ReactNode;
  bell: ReactNode;
  /** Randevu yetkisi varsa takvim (ay görünümü). */
  calendarHref?: string | null;
  /** TV modu yetkisi varsa (`canViewTv` + raporlar): ofis panosu büyük ekranda. */
  tvHref?: string | null;
  user: ReactNode;
}) {
  return (
    <header className="glass-bar app-topbar sticky top-[env(safe-area-inset-top)] z-30 flex h-14 items-center justify-between gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] lg:h-[4.25rem] lg:pl-[max(1.5rem,env(safe-area-inset-left))] lg:pr-[max(1.5rem,env(safe-area-inset-right))]">
      <div className="flex min-w-0 flex-1 items-center gap-5">
        {trail}
        <div className="min-w-0 flex-1 lg:max-w-[30rem] 2xl:max-w-[36rem]">{search}</div>
      </div>
      {/* Sağ grup arama kutusunun ÜSTÜNDE (z-10): dar ekranda çakışsa bile tıklama kendi düğmesine düşer. */}
      <div className="relative z-10 ml-3 flex shrink-0 items-center gap-1.5 sm:ml-4 sm:gap-2">
        {quickCreate ? <div className="mr-1.5 hidden lg:flex">{quickCreate}</div> : null}
        {extras}
        {bell}
        {calendarHref ? (
          <Link href={calendarHref} aria-label="Takvim: randevular" title="Takvim" className={TOPBAR_ICON_CLASS}>
            <CalendarDays className="h-[18px] w-[18px]" aria-hidden />
          </Link>
        ) : null}
        {tvHref ? (
          <Link href={tvHref} aria-label="TV modu: ofis panosunu büyük ekranda aç" title="TV modu" className={TOPBAR_ICON_CLASS}>
            <MonitorPlay className="h-[18px] w-[18px]" aria-hidden />
          </Link>
        ) : null}
        <span className="mx-1 hidden h-8 w-px bg-hairline lg:block" aria-hidden />
        {user}
      </div>
    </header>
  );
}
