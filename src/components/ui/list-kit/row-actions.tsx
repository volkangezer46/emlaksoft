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
