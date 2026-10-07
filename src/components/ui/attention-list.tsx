import type { ComponentType, ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { AlertOctagon, AlertTriangle, ChevronRight, Clock, Info } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * AttentionList — "Dikkat gerektirenler" kartı (tasarım sistemi v4). Her satır: renkli daire
 * ikon + başlık/alt metin + (varsa) sayı + önem hapı + chevron; satırın tamamı filtrelenmiş
 * hedefe gider (sıfır çıkmaz metrik). Önem dört düzey: Acil / Yüksek / Orta / Düşük — renk tek
 * başına anlam taşımaz (hap metni + ikon). Liste boşsa anlamlı boş durum; `children` yuvası
 * (ör. öneriler/içgörüler) listenin altına çizilir. Sunucu bileşeni, istemci JS yok.
 */
export type AttentionLevel = "acil" | "yuksek" | "orta" | "dusuk";

export type AttentionItem = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  level: AttentionLevel;
  /** Gerçek sayı (verilirse satırda gösterilir). */
  count?: number;
};

const LEVEL: Record<AttentionLevel, { label: string; tone: string; icon: ComponentType<{ className?: string }> }> = {
  acil: { label: "Acil", tone: "danger", icon: AlertOctagon },
  yuksek: { label: "Yüksek", tone: "warn", icon: Clock },
  orta: { label: "Orta", tone: "gold", icon: Clock },
  dusuk: { label: "Düşük", tone: "brand", icon: Info },
};

export const ATTENTION_LEVEL_LABEL: Record<AttentionLevel, string> = {
  acil: LEVEL.acil.label,
  yuksek: LEVEL.yuksek.label,
  orta: LEVEL.orta.label,
  dusuk: LEVEL.dusuk.label,
};

export function AttentionList({
  title = "Dikkat gerektirenler",
  subtitle = "Önem sırasıyla",
  items,
  emptyTitle = "Şu an bekleyen iş yok",
  emptyDescription = "Yeni bir durum oluşunca burada önem sırasıyla listelenir.",
  className,
  children,
}: {
  title?: string;
  subtitle?: string;
  items: readonly AttentionItem[];
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section aria-label={title} className={`ds-card ds-pad h-full ${className ?? ""}`}>
      <header className="ds-head mb-3">
        <span className="pm-ico pm-t-warn" aria-hidden="true">
          <AlertTriangle />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="ds-title" title={title}>{title}</h2>
          {subtitle ? <p className="ds-sub mt-0.5" title={subtitle}>{subtitle}</p> : null}
        </div>
      </header>
      {items.length > 0 ? (
        <ul className="ds-sep -mx-1.5">
          {items.map((it) => {
            const lv = LEVEL[it.level];
            return (
              <li key={it.id}>
                <Link href={it.href} className="ds-row focus-ring group">
                  <span className={`ds-row-ico pm-t-${lv.tone}`} aria-hidden="true">
                    <lv.icon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text" title={it.label}>{it.label}</span>
                    {it.hint ? <span className="block truncate text-xs text-text-muted" title={it.hint}>{it.hint}</span> : null}
                  </span>
                  {typeof it.count === "number" ? (
                    <span className="ds-num shrink-0 text-sm text-text" aria-label={`${it.count} adet`}>
                      {it.count.toLocaleString("tr-TR")}
                    </span>
                  ) : null}
                  <span className={`ds-pill pm-t-${lv.tone}`}>{lv.label}</span>
                  <ChevronRight className="ds-row-chev h-4 w-4" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState variant="compact" illustration="basari" title={emptyTitle} description={emptyDescription} />
      )}
      {children}
    </section>
  );
}
