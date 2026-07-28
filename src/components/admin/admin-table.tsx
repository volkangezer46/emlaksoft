import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, SearchX } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Platform panelinin liste iskeleti.
 *
 * NEDEN VAR: `/admin` altındaki her liste kendi `overflow-hidden rounded-[20px]
 * border border-line bg-surface` kabuğunu, kendi başlık şeridini ve kendi boş
 * durum metnini elde kuruyordu. Sonuç: kimi listede yatay kaydırma kabı vardı
 * kimisinde yoktu (mobilde tablo taşıyordu), boş durumlar kimi yerde tek
 * cümle kimi yerde hiç yoktu.
 *
 * `AdminScrollArea` bilinçli olarak ayrı: kart-satır düzenindeki listeler
 * (tenants, tickets) kaydırma kabı istemez, gerçek tablolar ister.
 */

/** Panel kabuğu — başlık şeridi + gövde. */
export function AdminPanel({
  title,
  icon: Icon,
  description,
  actions,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: React.ReactNode;
  icon?: LucideIcon;
  description?: React.ReactNode;
  /** Başlık şeridinin sağına giren içerik — filtre çipi, "Tümü" linki, sayaç. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`dashboard-panel overflow-hidden rounded-[20px] border border-line bg-surface ${className}`}>
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              {Icon ? <Icon className="h-4 w-4 text-brand-600" /> : null}
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-xs text-text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/**
 * Yatay kaydırma kabı — dar ekranda tablo sayfayı taşırmaz, kendi içinde kayar.
 * `minWidth` tablonun sıkışmadan okunabildiği en dar genişlik.
 */
export function AdminScrollArea({ minWidth = 720, children }: { minWidth?: number; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
}

/**
 * Sıralanabilir tablo başlığı (sunucu tarafı sıralama, URL üzerinden).
 *
 * Aynı kolona tekrar tıklamak yönü çevirir; başka kolona tıklamak varsayılan
 * yön (`defaultDir`) ile o kolona geçer. Aktif kolon `aria-sort` taşır.
 */
export function AdminSortHeader({
  label,
  columnKey,
  activeKey,
  activeDir,
  hrefFor,
  align = "left",
  defaultDir = "desc",
  className = "",
}: {
  label: string;
  columnKey: string;
  activeKey?: string;
  activeDir?: "asc" | "desc";
  hrefFor: (key: string, dir: "asc" | "desc") => string;
  align?: "left" | "right" | "center";
  defaultDir?: "asc" | "desc";
  className?: string;
}) {
  const active = activeKey === columnKey;
  const dir: "asc" | "desc" = active ? (activeDir ?? defaultDir) : defaultDir;
  const nextDir: "asc" | "desc" = active ? (dir === "asc" ? "desc" : "asc") : defaultDir;
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;

  return (
    <Link
      href={hrefFor(columnKey, nextDir)}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      title={active ? "Sıralama yönünü çevir" : `"${label}" sütununa göre sırala`}
      className={[
        "focus-ring inline-flex items-center gap-1 rounded-[6px] px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide transition",
        active ? "text-brand-600" : "text-text-faint hover:text-ink-950",
        align === "right" ? "justify-end" : align === "center" ? "justify-center" : "",
        className,
      ].join(" ")}
    >
      {label}
      <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-50"}`} />
    </Link>
  );
}

/**
 * `?sirala=&yon=` okuma yardımcısı. İzin verilen kolon listesi dışındaki değer
 * yok sayılır — kullanıcı girdisi doğrudan `.order()` içine gitmesin.
 */
export function parseSort<T extends string>(
  rawKey: string | undefined,
  rawDir: string | undefined,
  allowed: readonly T[],
  fallback: { key: T; dir: "asc" | "desc" },
): { key: T; dir: "asc" | "desc"; ascending: boolean } {
  const key = allowed.includes(rawKey as T) ? (rawKey as T) : fallback.key;
  const dir = rawDir === "asc" || rawDir === "desc" ? rawDir : fallback.dir;
  return { key, dir, ascending: dir === "asc" };
}

/** Anlamlı boş durum — filtre varken "aramayı değiştirin", yokken "henüz kayıt yok". */
export function AdminEmpty({
  icon: Icon = SearchX,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-canvas text-text-faint">
        <Icon className="h-6 w-6" />
      </span>
      <p className="mt-4 font-display text-base font-bold text-ink-950">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Aktif filtreyi tek tıkla kaldıran çip. */
export function AdminFilterChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="focus-ring press inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600 transition hover:bg-brand-600/15"
    >
      {children}
    </Link>
  );
}

/** Sunucu tarafı arama kutusu — GET formu, mevcut filtreleri gizli alanla taşır. */
export function AdminSearchForm({
  action,
  defaultValue,
  placeholder,
  hidden,
  className = "",
}: {
  action: string;
  defaultValue?: string;
  placeholder: string;
  /** Aramayla birlikte korunacak diğer parametreler. */
  hidden?: Record<string, string | undefined>;
  className?: string;
}) {
  return (
    <form action={action} role="search" className={`relative w-full max-w-xs ${className}`}>
      {Object.entries(hidden ?? {}).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={placeholder}
        className="focus-ring w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none transition focus:border-brand-400"
      />
    </form>
  );
}
