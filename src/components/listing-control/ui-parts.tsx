import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, Clock3, Building2, Siren, RadioTower } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { VISUAL_LABEL, type KpiVisual } from "./helpers";

/**
 * Ortak küçük parçalar (sunucu bileşenleri). Renk TEK BAŞINA anlam taşımaz: her durumun ikonu ve etiketi vardır.
 * Renkler `tone-*` sınıflarından (iki temada çözülür); ham hex yok.
 */

const VISUAL_ICON = {
  healthy: CheckCircle2,
  pending: Clock3,
  mismatch: AlertTriangle,
  critical: Siren,
  unverifiable: CircleHelp,
  neutral: Building2,
} as const;

const VISUAL_TONE: Record<KpiVisual, string> = {
  healthy: "tone-success",
  pending: "tone-warning",
  mismatch: "tone-warning",
  critical: "tone-danger",
  unverifiable: "tone-neutral",
  neutral: "tone-neutral",
};

export function VisualChip({ visual, label, className }: { visual: KpiVisual; label?: string; className?: string }) {
  const Icon = VISUAL_ICON[visual];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", VISUAL_TONE[visual], className)}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {label ?? VISUAL_LABEL[visual]}
    </span>
  );
}

/** Bölüm kartı: başlık + açıklama + sağ eylem + gövde. */
export function Panel({
  title,
  description,
  action,
  children,
  id,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-baslik` : undefined} className={cn("rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5", className)}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id ? `${id}-baslik` : undefined} className="text-base font-semibold text-text">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-text-muted">{description}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Şema uygulanmamış / veri yok: dürüst "etkin değil" durumu (sahte sayı YOK). */
export function ControlUnavailable({ compact = false }: { compact?: boolean }) {
  return (
    <EmptyState
      icon={RadioTower}
      variant={compact ? "compact" : "panel"}
      title="İlan kontrol sistemi bu ofiste henüz etkin değil"
      description="Portal ilanları kontrol edilmeye başlandığında burada sayılar, uyarılar ve günlük özet görünür. Şu an gösterilecek gerçek veri yok; bu nedenle hiçbir sayı üretilmedi."
      secondary={{ label: "Portal Kontrol sayfasına git", href: "/app/portallar" }}
    />
  );
}

export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("focus-ring inline-flex items-center gap-1 rounded text-sm font-semibold text-accent-text hover:underline", className)}>
      {children}
    </Link>
  );
}
