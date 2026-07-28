import Link from "next/link";

/**
 * Premium, tutarlı boş-durum bileşeni — projedeki TEK boş durum standardı
 * (ui-primitives'teki eski EmptyState buna delege eder).
 *
 * v2: `illustration` yuvası eklendi. Dört sade inline SVG (paketsiz, tema
 * token'larıyla boyanır) boş durumun SEBEBİNİ anlatır:
 *   - `list`   → henüz kayıt yok
 *   - `search` → filtre/arama sonuç vermedi
 *   - `error`  → bir şey ters gitti
 *   - `start`  → yeni başlangıç / ilk kurulum
 * Verilmezse davranış eskisiyle birebir aynı (ikon tile + glow).
 *
 * `secondary` ikincil aksiyon: birincil "oluştur" eylemi yanında "filtreyi
 * temizle" / "yardım" gibi kaçış yolu. Boş durumda tek çıkış olması kullanıcıyı
 * sıkıştırıyordu.
 */

type Tone = "brand" | "mint" | "amber" | "danger";
export type EmptyIllustration = "list" | "search" | "error" | "start";

const TONE_CLS: Record<Tone, { glow: string; tile: string; stroke: string; soft: string }> = {
  brand: { glow: "bg-brand-600/20", tile: "bg-brand-600/10 text-brand-600", stroke: "var(--brand-600)", soft: "var(--brand-300)" },
  mint: { glow: "bg-mint-500/20", tile: "bg-mint-500/12 text-mint-700", stroke: "var(--mint-500)", soft: "var(--mint-300)" },
  amber: { glow: "bg-amber-400/20", tile: "bg-amber-400/16 text-amber-700", stroke: "var(--amber-500)", soft: "var(--amber-300)" },
  danger: { glow: "bg-danger-500/15", tile: "bg-danger-500/10 text-danger-700", stroke: "var(--danger-500)", soft: "var(--danger-300)" },
};

/**
 * Boş durum illüstrasyonları — sade çizgi işi, 120×88 viewBox.
 * `aria-hidden`: bilgi başlık ve açıklamada; illüstrasyon yalnızca dekoratif.
 */
function Illustration({ kind, tone }: { kind: EmptyIllustration; tone: Tone }) {
  const t = TONE_CLS[tone];
  const common = {
    width: 132,
    height: 92,
    viewBox: "0 0 132 92",
    fill: "none",
    "aria-hidden": true as const,
    focusable: "false" as const,
    className: "mx-auto",
  };

  if (kind === "search") {
    return (
      <svg {...common}>
        <rect x="16" y="20" width="60" height="9" rx="4.5" fill="var(--surface-sunken)" />
        <rect x="16" y="38" width="44" height="9" rx="4.5" fill="var(--surface-sunken)" />
        <rect x="16" y="56" width="52" height="9" rx="4.5" fill="var(--surface-sunken)" />
        <circle cx="88" cy="42" r="20" stroke={t.stroke} strokeWidth="3" opacity="0.85" />
        <path d="M102 57 L114 69" stroke={t.stroke} strokeWidth="4" strokeLinecap="round" />
        <path d="M80 42 h16" stroke={t.soft} strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "error") {
    return (
      <svg {...common}>
        <path
          d="M66 16 L108 74 H24 Z"
          stroke={t.stroke}
          strokeWidth="3"
          strokeLinejoin="round"
          fill="var(--danger-soft)"
        />
        <path d="M66 38 v18" stroke={t.stroke} strokeWidth="4" strokeLinecap="round" />
        <circle cx="66" cy="64" r="2.6" fill={t.stroke} />
      </svg>
    );
  }

  if (kind === "start") {
    return (
      <svg {...common}>
        <path d="M18 74 H114" stroke="var(--surface-sunken)" strokeWidth="4" strokeLinecap="round" />
        <path
          d="M66 14 c12 10 18 22 18 34 0 8-3 14-8 19 H56 c-5-5-8-11-8-19 0-12 6-24 18-34Z"
          stroke={t.stroke}
          strokeWidth="3"
          strokeLinejoin="round"
          fill="var(--surface-accent-soft)"
        />
        <circle cx="66" cy="42" r="6" stroke={t.stroke} strokeWidth="3" />
        <path d="M56 67 l-8 9 M76 67 l8 9" stroke={t.soft} strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  // kind === "list"
  return (
    <svg {...common}>
      <rect x="22" y="14" width="88" height="64" rx="10" stroke={t.stroke} strokeWidth="3" fill="var(--surface-sunken)" opacity="0.95" />
      <rect x="34" y="30" width="12" height="8" rx="3" fill={t.soft} />
      <rect x="52" y="31" width="46" height="6" rx="3" fill="var(--line-strong)" />
      <rect x="34" y="48" width="12" height="8" rx="3" fill={t.soft} />
      <rect x="52" y="49" width="34" height="6" rx="3" fill="var(--line-strong)" />
      <path d="M98 62 v14 M91 69 h14" stroke={t.stroke} strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondary,
  illustration,
  tone = "brand",
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  /** Birincil aksiyon — link ya da hazır düğüm. */
  action?: { href?: string; label?: string; node?: React.ReactNode };
  /** İkincil aksiyon (kaçış yolu): "filtreyi temizle", "nasıl çalışır?" vb. */
  secondary?: { href?: string; label?: string; node?: React.ReactNode };
  /** İllüstrasyon türü; verilmezse klasik ikon tile gösterilir. */
  illustration?: EmptyIllustration;
  tone?: Tone;
}) {
  const t = TONE_CLS[tone];

  return (
    <div className="anim-rise relative grid place-items-center overflow-hidden rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
      <div className={`pointer-events-none absolute -top-10 h-40 w-40 rounded-full blur-[70px] ${t.glow}`} />
      <div className="relative">
        {illustration ? (
          <Illustration kind={illustration} tone={tone} />
        ) : (
          <span className={`mx-auto grid h-16 w-16 place-items-center rounded-[18px] ${t.tile}`}>
            <Icon className="h-8 w-8" />
          </span>
        )}
        <h2 className="mt-4 font-display text-lg font-bold text-ink-950">{title}</h2>
        {description ? <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-muted">{description}</p> : null}
        {action || secondary ? (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            {action?.node ??
              (action?.href ? (
                <Link
                  href={action.href}
                  className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[11px] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  {action.label}
                </Link>
              ) : null)}
            {secondary?.node ??
              (secondary?.href ? (
                <Link
                  href={secondary.href}
                  className="focus-ring press inline-flex items-center gap-2 rounded-[11px] border border-hairline-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-canvas"
                >
                  {secondary.label}
                </Link>
              ) : null)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
