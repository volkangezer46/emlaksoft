import Link from "@/components/ui/smart-link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SmartIcon } from "@/components/ui/icon-sprite";
import { cn } from "@/lib/utils";

/**
 * RowActions — satır sonu ikon eylemleri (göz / kalem / ara / WhatsApp / …).
 * `relative z-10`: satırı kaplayan overlay bağlantısının ÜSTÜNDE kalır.
 * Her eylemin erişilebilir adı (`label`) zorunludur; ikon tek başına anlam taşımaz.
 * Ek (ör. diyalog tetikleyen istemci) düğmeler `children` ile eklenir.
 */
// Görsel kurallar `.lk-row-act` (console-kit.css) içinde: satır başına RSC yükünde uzun dizgi taşınmaz.
const ACTION = "focus-ring press lk-row-act";

/**
 * Etiketli satır eylemi (ör. "Ara", "Kuyruğa al", "Geçiş"): TEK yükseklik kuralı (WP3) — masaüstünde 32 px (`h-8`, ikon
 * eylemlerle `.lk-row-act` aynı), dokunmatikte 44 px, ÇERÇEVELİ. `phonePrimary`: dolgulu birincil görünüm YALNIZ telefon
 * kartında (<640 px; 44 px); masaüstünde satır başına dolgulu düğme yok (tema P1-6).
 */
export function rowActionClass({ phonePrimary = false, tone = "default", className }: { phonePrimary?: boolean; tone?: "default" | "danger"; className?: string } = {}) {
  return cn(
    "focus-ring press inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] border px-3 text-xs font-semibold transition touch:h-11 disabled:opacity-50",
    tone === "danger"
      ? "border-line bg-surface text-danger-600 hover:border-danger-500/40 hover:bg-danger-500/10"
      : "border-line bg-surface text-text hover:border-border-interactive hover:bg-surface-hover hover:text-brand-700",
    phonePrimary && "max-sm:h-11 max-sm:border-transparent max-sm:bg-brand-600 max-sm:px-3.5 max-sm:text-sm max-sm:text-white max-sm:hover:bg-accent-hover max-sm:hover:text-white",
    className,
  );
}

/** İkon satır eylemi düğmesi (`<button>`; `.lk-row-act` ile aynı 32/44 px kare). */
export const ROW_ACTION_ICON = ACTION;

export function RowActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("relative z-10 flex items-center justify-end gap-0.5", className)}>{children}</div>;
}

export function RowActionLink({
  href,
  label,
  icon: Icon,
  external,
  tone = "default",
  hideWhenStacked = false,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Dış bağlantı (tel:, wa.me …) yeni sekmede açılır. */
  external?: boolean;
  tone?: "default" | "success";
  /**
   * Mobil kart listesinde (TableFrame `stack`, <768 px) gizlenir: satırın tamamı zaten aynı hedefe giden bindirme
   * bağlantısıysa ("detayı aç") kartta yinelenen 44 px düğme yer kaplamaz. Masaüstü tabloda görünür kalır.
   */
  hideWhenStacked?: boolean;
}) {
  // `hover:text-brand-700` tekrarı: .lk-row-act bileşen katmanında; yardımcı katmandaki yeşil metin hover'da onu
  // ezerdi. Eski dizgide hover rengi marka tonuydu — görünüm birebir korunur.
  const cls = cn(
    ACTION,
    tone === "success" && "text-[var(--success-strong)] hover:bg-[var(--success-soft)] hover:text-brand-700",
  );
  const icon = <SmartIcon icon={Icon} className="h-4 w-4" />;
  const stackHide = hideWhenStacked ? { "data-stack-hide": "" } : null;
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className={cls} {...stackHide}>
        {icon}
      </a>
    );
  }
  return (
    <Link href={href} aria-label={label} title={label} prefetch={false} className={cls} {...stackHide}>
      {icon}
    </Link>
  );
}

/** tel:/mailto: gibi şema bağlantıları (yeni sekme açmaz). */
export function RowActionAnchor({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <a href={href} aria-label={label} title={label} className={ACTION}>
      <SmartIcon icon={Icon} className="h-4 w-4" />
    </a>
  );
}
