import type { ComponentType } from "react";
import { MorphNav } from "@/components/ui/morph-tab-parts";
import { ArrowUpRight, CalendarDays, MessageCircle, PhoneCall, Sparkles, StickyNote } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { MoreActions } from "@/components/app/more-actions";
import { toTelHref, toWhatsAppLink } from "@/lib/phone";
import { cn } from "@/lib/utils";

/**
 * Detay sayfaları için URL'e bağlı iç sekmeler (`?sekme=`).
 *
 * Sunucu bileşenidir: seçili sekme sunucuda çizilir, yalnız aktif sekmenin verisi
 * çekilir (sayfa `activeTab`'a göre sorgu/Suspense seçer). Popup/client state yok;
 * geri tuşu, paylaşılan link ve yenileme aynı sekmeyi açar. Mobilde yatay kaydırılır.
 */
export type DetailTabDef = {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** Sayaç rozeti; null/undefined ise gösterilmez. 0 da gösterilir. */
  count?: number | null;
  /** Eski (`?tab=`) kimlikler gibi takma adlar için gerekmez; yalnız görünür sekmeler. */
  hidden?: boolean;
};

/** URL'deki `sekme` (veya eski `tab`) değerini geçerli bir sekmeye çevirir. */
export function resolveTab(
  sp: Record<string, string | string[] | undefined>,
  ids: readonly string[],
  fallback: string,
  aliases: Record<string, string> = {},
): string {
  const raw = sp.sekme ?? sp.tab;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return fallback;
  const mapped = aliases[v] ?? v;
  return ids.includes(mapped) ? mapped : fallback;
}

export function DetailTabs({
  basePath,
  tabs,
  active,
  label = "Detay sekmeleri",
}: {
  basePath: string;
  tabs: DetailTabDef[];
  active: string;
  label?: string;
}) {
  return (
    <MorphNav
      variant="underline"
      label={label}
      activeId={active}
      scroll={false}
      items={tabs
        .filter((t) => !t.hidden)
        .map((t) => ({ id: t.id, href: `${basePath}?sekme=${t.id}`, label: t.label, icon: t.icon, count: t.count }))}
    />
  );
}

/** Sağ sütun: sabit "sonraki en iyi eylem" kartı (tek öneri, tek buton). */
export function NextActionCard({
  title,
  reason,
  href,
  label,
}: {
  title: string;
  reason?: string;
  href?: string | null;
  label?: string;
}) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-mint-500/30 bg-surface p-4 shadow-[var(--shadow-xs)]">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-mint-600">
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> Sonraki en iyi eylem
      </p>
      <p className="mt-2 text-sm font-semibold text-ink-950">{title}</p>
      {reason ? <p className="mt-1 text-xs text-text-muted">{reason}</p> : null}
      {href && label ? (
        <ButtonLink href={href} scroll={false} size="sm" iconRight={ArrowUpRight} className="mt-3">
          {label}
        </ButtonLink>
      ) : null}
    </section>
  );
}

/** Kimlik başlığındaki ortak eylemler: ara, WhatsApp, randevu, not. */
export function ContactActions({
  phone,
  name,
  appointmentHref,
  noteHref,
}: {
  phone?: string | null;
  name?: string | null;
  appointmentHref?: string | null;
  noteHref?: string | null;
}) {
  const tel = toTelHref(phone);
  const wa = toWhatsAppLink(phone, name ? `Merhaba ${name.split(" ")[0]}, ` : undefined);
  return (
    <div className="flex flex-wrap gap-2">
      {tel ? (
        <ButtonLink href={tel} variant="secondary" size="sm" icon={PhoneCall}>
          Ara
        </ButtonLink>
      ) : null}
      {wa ? (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring press inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-hairline-strong bg-surface px-3 text-xs font-semibold text-ink-950 transition hover:bg-canvas"
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
        </a>
      ) : null}
      {appointmentHref || noteHref ? (
        <MoreActions tone="light">
          {appointmentHref ? (
            <ButtonLink href={appointmentHref} variant="secondary" size="sm" icon={CalendarDays}>
              Randevu
            </ButtonLink>
          ) : null}
          {noteHref ? (
            <ButtonLink href={noteHref} scroll={false} variant="secondary" size="sm" icon={StickyNote}>
              Not
            </ButtonLink>
          ) : null}
        </MoreActions>
      ) : null}
    </div>
  );
}

/** Sekme içeriği için ortak kart kabuğu. */
export function TabPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="region" className={cn("space-y-4", className)}>
      {children}
    </div>
  );
}
