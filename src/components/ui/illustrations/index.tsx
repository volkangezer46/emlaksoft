import { IllustrationFrame, LINE, SOFT, TINT, type IllustrationTone } from "./frame";

/**
 * Hareketli SVG illüstrasyon kiti (GIF yok): her biri tek küçük fonksiyon,
 * paketsiz, erişilebilirlikte dekoratif. Kullanım: `<Illustration kind="musteri" />`
 * veya EmptyState `illustration` özelliği. Hareket sınıfları: motion.css `.ill-*`.
 */
export type { IllustrationTone };

const ART = {
  musteri: (
    <>
      <circle cx="66" cy="32" r="13" fill={SOFT} className="ill-float" />
      <path d="M38 76c2-16 13-24 28-24s26 8 28 24" fill={SOFT} />
      <path d="M92 28v14M85 35h14" className="ill-pulse" />
    </>
  ),
  portfoy: (
    <>
      <path d="M32 74V38l34-20 34 20v36z" fill={SOFT} />
      <rect x="56" y="52" width="20" height="22" rx="3" fill={TINT} />
      <circle cx="91" cy="22" r="6" className="ill-pulse" />
    </>
  ),
  talep: (
    <>
      <circle cx="66" cy="44" r="26" fill={SOFT} />
      <circle cx="66" cy="44" r="15" />
      <circle cx="66" cy="44" r="4" fill="currentColor" className="ill-pulse" />
      <path d="M66 12v10M66 66v10M34 44h10M88 44h10" stroke={LINE} />
    </>
  ),
  randevu: (
    <>
      <rect x="30" y="20" width="72" height="56" rx="8" fill={SOFT} />
      <path d="M30 36h72M48 14v12M84 14v12" />
      <circle cx="82" cy="56" r="9" fill={TINT} className="ill-pulse" />
      <path d="M82 51v5l3 2" strokeWidth={2.5} />
      <path d="M42 50h20M42 62h14" stroke={LINE} />
    </>
  ),
  gorev: (
    <>
      <rect x="32" y="16" width="68" height="62" rx="8" fill={SOFT} />
      <path d="M44 34l5 5 9-10" className="ill-draw" />
      <path d="M44 56l5 5 9-10" className="ill-draw ill-d2" />
      <path d="M68 36h22M68 58h16" stroke={LINE} />
    </>
  ),
  teklif: (
    <>
      <path d="M34 22h44l20 20v34H34z" fill={SOFT} />
      <path d="M78 22v20h20" />
      <path d="M46 56h30M46 66h18" stroke={LINE} />
      <path d="M52 40l5 5 9-10" className="ill-draw" />
      <circle cx="96" cy="68" r="10" fill={TINT} className="ill-float" />
    </>
  ),
  komisyon: (
    <>
      <ellipse cx="60" cy="68" rx="22" ry="7" fill={SOFT} />
      <path d="M38 68V58c0 4 10 7 22 7s22-3 22-7v10" />
      <circle cx="78" cy="38" r="15" fill={TINT} className="ill-float" />
      <path d="M78 31v14M73 36h8a3 3 0 0 1 0 6h-8" strokeWidth={2.5} />
    </>
  ),
  rapor: (
    <>
      <path d="M24 78h84" stroke={LINE} />
      <rect x="30" y="52" width="14" height="22" rx="3" fill={TINT} />
      <rect x="52" y="40" width="14" height="34" rx="3" fill={TINT} />
      <rect x="74" y="28" width="14" height="46" rx="3" fill={TINT} />
      <path d="M32 40l24-10 20-12 20-4" className="ill-draw" />
    </>
  ),
  bildirim: (
    <>
      <g className="ill-swing">
        <path d="M44 62c4-4 5-10 5-20a17 17 0 0 1 34 0c0 10 1 16 5 20z" fill={SOFT} />
        <path d="M60 70a6 6 0 0 0 12 0" />
      </g>
      <circle cx="86" cy="26" r="5" fill="currentColor" stroke="none" className="ill-pulse" />
    </>
  ),
  gelenKutusu: (
    <>
      <path d="M28 52l10-26h56l10 26v22H28z" fill={SOFT} />
      <path d="M28 52h24c0 7 6 10 14 10s14-3 14-10h24" />
      <path d="M66 14v16M59 24l7 7 7-7" className="ill-float" />
    </>
  ),
  arama: (
    <>
      <circle cx="58" cy="42" r="22" fill={SOFT} />
      <path d="M74 58l22 20" strokeWidth={5} />
      <path d="M48 42h20M58 32v20" className="ill-pulse" stroke={LINE} />
    </>
  ),
  belge: (
    <>
      <path d="M36 14h42l18 18v46H36z" fill={SOFT} />
      <path d="M78 14v18h18" />
      <path d="M46 46h30M46 56h22" stroke={LINE} />
      <path d="M48 70c4-8 7-8 9 0s5 0 12-2" className="ill-draw" />
    </>
  ),
  otomasyon: (
    <>
      <circle cx="42" cy="50" r="10" fill={SOFT} />
      <circle cx="92" cy="30" r="10" fill={SOFT} />
      <circle cx="92" cy="70" r="10" fill={SOFT} />
      <path d="M52 48l30-16M52 52l30 16" className="ill-draw" />
      <circle cx="42" cy="50" r="3" fill="currentColor" stroke="none" className="ill-pulse" />
    </>
  ),
  ekip: (
    <>
      <circle cx="44" cy="38" r="9" fill={SOFT} />
      <circle cx="88" cy="38" r="9" fill={SOFT} />
      <circle cx="66" cy="32" r="11" fill={TINT} className="ill-float" />
      <path d="M26 70c1-11 8-17 18-17M106 70c-1-11-8-17-18-17M46 74c1-13 9-20 20-20s19 7 20 20" fill={SOFT} />
    </>
  ),
  aramaYok: (
    <>
      <circle cx="58" cy="42" r="22" fill={SOFT} />
      <path d="M74 58l22 20" strokeWidth={5} />
      <path d="M50 34l16 16M66 34L50 50" className="ill-pulse" stroke={LINE} />
    </>
  ),
  hata: (
    <>
      <path d="M66 14l40 62H26z" fill="var(--danger-soft)" className="ill-float" />
      <path d="M66 38v18" strokeWidth={4} />
      <circle cx="66" cy="64" r="2.6" fill="currentColor" />
    </>
  ),
  yetkiYok: (
    <>
      <rect x="40" y="42" width="52" height="36" rx="8" fill={SOFT} />
      <path d="M50 42V32a16 16 0 0 1 32 0v10" className="ill-float" />
      <circle cx="66" cy="58" r="4" fill="currentColor" stroke="none" />
      <path d="M66 62v6" strokeWidth={2.5} />
    </>
  ),
  cevrimdisi: (
    <>
      <path d="M30 40a50 50 0 0 1 72 0M42 52a32 32 0 0 1 48 0M54 64a14 14 0 0 1 24 0" stroke={LINE} />
      <circle cx="66" cy="72" r="3" fill="currentColor" stroke="none" />
      <path d="M32 24l68 56" className="ill-pulse" strokeWidth={4} />
    </>
  ),
  basari: (
    <>
      <circle cx="66" cy="44" r="28" fill={TINT} className="ill-pop" />
      <path d="M52 44l10 10 19-21" strokeWidth={5} className="ill-draw ill-check" />
    </>
  ),
  /** Eski (v2) "liste" ve "başlangıç" illüstrasyonları. */
  liste: (
    <>
      <rect x="22" y="14" width="88" height="64" rx="10" fill={SOFT} />
      <rect x="34" y="30" width="12" height="8" rx="3" fill={TINT} stroke="none" />
      <rect x="52" y="31" width="46" height="6" rx="3" fill={LINE} stroke="none" />
      <rect x="34" y="48" width="12" height="8" rx="3" fill={TINT} stroke="none" />
      <rect x="52" y="49" width="34" height="6" rx="3" fill={LINE} stroke="none" />
      <path d="M98 62v14M91 69h14" className="ill-pulse" />
    </>
  ),
  baslangic: (
    <>
      <path d="M66 14c12 10 18 22 18 34 0 8-3 14-8 19H56c-5-5-8-11-8-19 0-12 6-24 18-34z" fill={SOFT} className="ill-float" />
      <circle cx="66" cy="42" r="6" />
      <path d="M56 67l-8 9M76 67l8 9" stroke={LINE} />
    </>
  ),
} as const;

export type IllustrationKind = keyof typeof ART;
export const ILLUSTRATION_KINDS = Object.keys(ART) as IllustrationKind[];

/** Eski EmptyState `illustration` değerleri → yeni anahtarlar. */
export const LEGACY_ILLUSTRATION: Record<string, IllustrationKind> = {
  list: "liste",
  search: "aramaYok",
  error: "hata",
  start: "baslangic",
};

export function resolveIllustration(kind: string | undefined): IllustrationKind | null {
  if (!kind) return null;
  if (kind in LEGACY_ILLUSTRATION) return LEGACY_ILLUSTRATION[kind];
  return kind in ART ? (kind as IllustrationKind) : null;
}

export function Illustration({
  kind,
  tone,
  size,
  className,
}: {
  kind: IllustrationKind;
  tone?: IllustrationTone;
  size?: number;
  className?: string;
}) {
  const t = tone ?? (kind === "hata" ? "danger" : kind === "basari" ? "mint" : "brand");
  return (
    <IllustrationFrame tone={t} size={size} className={className}>
      {ART[kind]}
    </IllustrationFrame>
  );
}

/** Kutlama (konfeti / disk + tik) — tek kaynak `./celebration`. */
export { Celebration } from "./celebration";
