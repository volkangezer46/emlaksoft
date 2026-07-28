import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Timeline — genel amaçlı dikey zaman çizelgesi.
 *
 * Projede zaten `components/app/communication-timeline.tsx` var; o bileşen
 * iletişim kaydına özel (form, silme aksiyonu, kanal ikonları) ve client
 * component. Burası onun SUNUM iskeletinin ortaklaştırılmış hali: durum
 * geçmişi, denetim kaydı, sözleşme adımları gibi "sadece okunur" akışlar
 * artık kendi çizgisini elle çizmez.
 *
 * ERİŞİLEBİLİRLİK: anlamsal olarak sıralı bir liste (`<ol>`); dikey çizgi ve
 * nokta `aria-hidden` — ekran okuyucuya yalnızca metin gider. Öğe bir yere
 * gidiyorsa (`href`) tüm satır tek bir bağlantı olur, focus-ring alır.
 */

const TONES = {
  brand: "tone-info",
  mint: "tone-success",
  amber: "tone-warning",
  danger: "tone-danger",
  neutral: "tone-neutral",
} as const;

export type TimelineItem = {
  id: string;
  /** Başlık — olayın ne olduğu. */
  title: string;
  /** Alt açıklama (opsiyonel). */
  description?: string;
  /** Zaman etiketi — biçimlendirilmiş metin ("3 gün önce", "12 Mart 14:30"). */
  time?: string;
  icon?: LucideIcon;
  tone?: keyof typeof TONES;
  /** Satırın drill-down hedefi. */
  href?: string;
  /** Sağda görünecek ek içerik (rozet vb.). */
  meta?: React.ReactNode;
};

export function Timeline({
  items,
  className,
  /** Giriş animasyonu — reduced-motion altında otomatik kapanır. */
  animate = true,
}: {
  items: TimelineItem[];
  className?: string;
  animate?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <ol className={cn("relative space-y-1", className)}>
      {items.map((item, index) => {
        const Icon = item.icon;
        const tone = TONES[item.tone ?? "neutral"];
        const isLast = index === items.length - 1;

        const body = (
          <>
            {/* Dikey bağlantı çizgisi — son öğede çizilmez */}
            {!isLast ? (
              <span
                aria-hidden="true"
                className="absolute left-[15px] top-9 bottom-0 w-px bg-hairline-strong"
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn("relative z-[1] grid h-8 w-8 shrink-0 place-items-center rounded-full", tone)}
            >
              {Icon ? <Icon className="h-4 w-4" /> : <span className="h-2 w-2 rounded-full bg-current" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold text-ink-950">{item.title}</span>
                {item.time ? <span className="text-xs text-text-faint">{item.time}</span> : null}
              </span>
              {item.description ? (
                <span className="mt-0.5 block text-xs text-text-muted">{item.description}</span>
              ) : null}
            </span>
            {item.meta ? <span className="shrink-0">{item.meta}</span> : null}
          </>
        );

        const rowCls = cn(
          "relative flex gap-3 rounded-[12px] px-2 py-2",
          animate && "anim-rise",
          item.href && "focus-ring transition hover:bg-canvas",
        );

        return (
          <li key={item.id}>
            {item.href ? (
              <Link
                href={item.href}
                className={rowCls}
                style={animate ? { animationDelay: `${Math.min(index, 8) * 30}ms` } : undefined}
              >
                {body}
              </Link>
            ) : (
              <div
                className={rowCls}
                style={animate ? { animationDelay: `${Math.min(index, 8) * 30}ms` } : undefined}
              >
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
