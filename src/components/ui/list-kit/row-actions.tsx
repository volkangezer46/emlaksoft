import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * RowActions — satır sonu ikon eylemleri (göz / kalem / ara / WhatsApp / …).
 * `relative z-10`: satırı kaplayan overlay bağlantısının ÜSTÜNDE kalır.
 * Her eylemin erişilebilir adı (`label`) zorunludur; ikon tek başına anlam taşımaz.
 * Ek (ör. diyalog tetikleyen istemci) düğmeler `children` ile eklenir.
 */
const ACTION =
  "focus-ring press grid h-8 w-8 touch:h-11 touch:w-11 place-items-center rounded-[var(--radius-control)] border border-transparent text-text-muted transition hover:border-line hover:bg-canvas hover:text-brand-700";

export function RowActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("relative z-10 flex items-center justify-end gap-0.5", className)}>{children}</div>;
}

export function RowActionLink({
  href,
  label,
  icon: Icon,
  external,
  tone = "default",
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Dış bağlantı (tel:, wa.me …) yeni sekmede açılır. */
  external?: boolean;
  tone?: "default" | "success";
}) {
  const cls = cn(ACTION, tone === "success" && "text-[var(--success-strong)] hover:bg-[var(--success-soft)]");
  const icon = <Icon aria-hidden="true" className="h-4 w-4" />;
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className={cls}>
        {icon}
      </a>
    );
  }
  return (
    <Link href={href} aria-label={label} title={label} prefetch={false} className={cls}>
      {icon}
    </Link>
  );
}

/** tel:/mailto: gibi şema bağlantıları (yeni sekme açmaz). */
export function RowActionAnchor({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <a href={href} aria-label={label} title={label} className={ACTION}>
      <Icon aria-hidden="true" className="h-4 w-4" />
    </a>
  );
}
