import { createLucideIcon, type IconNode, type LucideIcon } from "lucide-react";

/**
 * MARKA İKON SETİ — emlak işine özgü kavramlar (portföy, tapu, anahtar, yer gösterme, komisyon, kira, aidat, EİDS,
 * portal ilanı, eşleşme, değerleme, mülk sahibi, sözleşme imzası).
 *
 * NEDEN: lucide genel amaçlıdır; "tapu", "EİDS", "yer gösterme" gibi kavramlar için yakın ama yanlış metafor
 * (FileText, ShieldCheck, Eye) kullanılıyordu. Bu set lucide ile AYNI ızgara ve çizgi dilindedir (24 px, 2 px yuvarlak
 * çizgi, `currentColor`) → menüde ve kartlarda lucide ikonlarının yanında yabancı durmaz.
 *
 * DUOTONE: her ikonda tek bir dolgu katmanı (`currentColor`, %16 opaklık, çizgisiz) vardır; ikon rengini izler,
 * koyu/açık temada ve lacivert menüde kendiliğinden uyar. Ham renk yok.
 *
 * Teknik: `createLucideIcon` ile üretilir → gerçek bir `LucideIcon`dır (aynı props, aynı `lucide lucide-<ad>` sınıfı).
 * Bu sayede `src/lib/icons.ts` sözlüğüne, sunucudaki menü ikon serileştirmesine (`nav-shell-server` `shellIcon`) ve
 * `nav-glyph` istemci çizimine hiçbir değişiklik olmadan girer. Her ikon < 400 bayt (sözleşme testi).
 */

const DUO = { fill: "currentColor", stroke: "none", opacity: "0.16" } as const;

const node = (n: IconNode): IconNode => n;

export const PortfoyIcon: LucideIcon = createLucideIcon("es-portfoy", node([
  ["path", { d: "M4 10.5 12 4l8 6.5V20H4z", ...DUO, key: "d" }],
  ["path", { d: "M3 11.2 12 4l9 7.2", key: "r" }],
  ["path", { d: "M5 9.8V20h14V9.8", key: "w" }],
  ["path", { d: "M10 20v-5.5h4V20", key: "o" }],
  ["circle", { cx: "17.5", cy: "4.5", r: "1.5", key: "t" }],
]));

export const TapuIcon: LucideIcon = createLucideIcon("es-tapu", node([
  ["path", { d: "M6 3h8l5 5v4.5a4.5 4.5 0 0 0-7 3.7V21H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", ...DUO, key: "d" }],
  ["path", { d: "M12 21H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8l5 5v3", key: "p" }],
  ["path", { d: "M14 3v5h5", key: "f" }],
  ["path", { d: "M8 9h3M8 13h4", key: "l" }],
  ["circle", { cx: "17", cy: "15.5", r: "3", key: "s" }],
  ["path", { d: "m15.6 18.2-.6 3.8 2-1 2 1-.6-3.8", key: "b" }],
]));

export const AnahtarIcon: LucideIcon = createLucideIcon("es-anahtar", node([
  ["circle", { cx: "8", cy: "15", r: "4.5", ...DUO, key: "d" }],
  ["circle", { cx: "8", cy: "15", r: "4.5", key: "c" }],
  ["circle", { cx: "8", cy: "15", r: "1", key: "h" }],
  ["path", { d: "M11.2 11.8 20 3", key: "s" }],
  ["path", { d: "m16.5 6.5 2.5 2.5M14.5 8.5l1.8 1.8", key: "t" }],
]));

export const YerGostermeIcon: LucideIcon = createLucideIcon("es-yer-gosterme", node([
  ["path", { d: "M12 21s-6.5-5.6-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z", ...DUO, key: "d" }],
  ["path", { d: "M12 21s-6.5-5.6-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z", key: "p" }],
  ["path", { d: "M8.6 9.8S10 7.6 12 7.6s3.4 2.2 3.4 2.2-1.4 2.2-3.4 2.2-3.4-2.2-3.4-2.2z", key: "e" }],
  ["circle", { cx: "12", cy: "9.8", r: "0.8", key: "i" }],
]));

export const KomisyonIcon: LucideIcon = createLucideIcon("es-komisyon", node([
  ["circle", { cx: "9", cy: "9", r: "6", ...DUO, key: "d" }],
  ["circle", { cx: "9", cy: "9", r: "6", key: "c" }],
  ["path", { d: "M18.1 10.4a6 6 0 1 1-7.7 7.7", key: "b" }],
  ["path", { d: "m7 11 4-4", key: "s" }],
  ["circle", { cx: "7.3", cy: "7.3", r: "0.6", key: "a" }],
  ["circle", { cx: "10.7", cy: "10.7", r: "0.6", key: "z" }],
]));

export const KiraIcon: LucideIcon = createLucideIcon("es-kira", node([
  ["path", { d: "M5 10 11 5l6 5v2.5a5 5 0 0 0-5 5V19H5z", ...DUO, key: "d" }],
  ["path", { d: "M3 11 11 4.5l8 6.5", key: "r" }],
  ["path", { d: "M5 9.5V19h6", key: "w" }],
  ["path", { d: "M21.5 16.5a4 4 0 1 1-1.2-2.9", key: "a" }],
  ["path", { d: "M21.5 12v2.6h-2.6", key: "h" }],
]));

export const AidatIcon: LucideIcon = createLucideIcon("es-aidat", node([
  ["path", { d: "M5 4h8a1 1 0 0 1 1 1v6.5a5 5 0 0 0-3.9 9.5H4V5a1 1 0 0 1 1-1z", ...DUO, key: "d" }],
  ["path", { d: "M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v6", key: "b" }],
  ["path", { d: "M3 21h7M7.5 8h3M7.5 12h3M7.5 16h1.5", key: "w" }],
  ["circle", { cx: "16.5", cy: "16.5", r: "4.5", key: "c" }],
  ["path", { d: "M16.5 14.5v4M15 16h3", key: "s" }],
]));

export const EidsIcon: LucideIcon = createLucideIcon("es-eids", node([
  ["path", { d: "M12 3 5 6v5c0 4.6 3 8.6 7 10 4-1.4 7-5.4 7-10V6z", ...DUO, key: "d" }],
  ["path", { d: "M12 3 5 6v5c0 4.6 3 8.6 7 10 4-1.4 7-5.4 7-10V6z", key: "s" }],
  ["path", { d: "M8.5 12.6 12 9.6l3.5 3", key: "r" }],
  ["path", { d: "M9.6 11.8v3.7h4.8v-3.7", key: "h" }],
]));

export const IlanPortalIcon: LucideIcon = createLucideIcon("es-ilan-portal", node([
  ["path", { d: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H3z", ...DUO, key: "d" }],
  ["rect", { x: "3", y: "4", width: "18", height: "16", rx: "2", key: "w" }],
  ["path", { d: "M3 9h18", key: "l" }],
  ["path", { d: "M6.5 6.5h.01M9 6.5h.01", key: "o" }],
  ["path", { d: "M9 17v-2.8l3-2.4 3 2.4V17z", key: "h" }],
]));

export const EslesmeIcon: LucideIcon = createLucideIcon("es-eslesme", node([
  ["path", { d: "M12 7.5a5 5 0 0 1 0 9 5 5 0 0 1 0-9z", ...DUO, key: "d" }],
  ["circle", { cx: "8.5", cy: "12", r: "5", key: "a" }],
  ["circle", { cx: "15.5", cy: "12", r: "5", key: "b" }],
  ["path", { d: "m10.8 12 1 1 1.9-2", key: "c" }],
]));

export const DegerlemeIcon: LucideIcon = createLucideIcon("es-degerleme", node([
  ["path", { d: "M5 10 10 6l5 4v9H5z", ...DUO, key: "d" }],
  ["path", { d: "M3 11.5 10 5.5l5.5 4.7", key: "r" }],
  ["path", { d: "M5 10v9h5", key: "w" }],
  ["path", { d: "m13 19 3-3 2 2 4-4", key: "t" }],
  ["path", { d: "M19 14h3v3", key: "a" }],
]));

export const MulkSahibiIcon: LucideIcon = createLucideIcon("es-mulk-sahibi", node([
  ["circle", { cx: "9", cy: "7.5", r: "3.5", ...DUO, key: "d" }],
  ["circle", { cx: "9", cy: "7.5", r: "3.5", key: "h" }],
  ["path", { d: "M3 20a6 6 0 0 1 9.4-4.9", key: "b" }],
  ["circle", { cx: "17", cy: "15", r: "2.5", key: "k" }],
  ["path", { d: "m18.8 16.8 2.7 2.7M20.2 18.2l-1.1 1.1", key: "t" }],
]));

export const ImzaIcon: LucideIcon = createLucideIcon("es-imza", node([
  ["path", { d: "M6 3h8l4 4v6.5L12 20H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", ...DUO, key: "d" }],
  ["path", { d: "M11 21H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8l4 4v3", key: "p" }],
  ["path", { d: "M14 3v4h4", key: "f" }],
  ["path", { d: "M8 9h3M8 12.5h4", key: "l" }],
  ["path", { d: "M13.5 20.5c1.2-2.4 2.2-4 3.2-4s.4 2.5 1.4 2.5 1.4-1.5 2.4-1.5", key: "s" }],
]));

// --- v4 kabuk ve ana sayfa kavramları (docs/design/GORSEL_KUTUPHANE.md "İkonlar") -----------------------------------

export const AjandaIcon: LucideIcon = createLucideIcon("es-ajanda", node([
  ["path", { d: "M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3H4z", ...DUO, key: "d" }],
  ["rect", { x: "4", y: "5", width: "16", height: "15", rx: "2", key: "w" }],
  ["path", { d: "M8 3v4M16 3v4M4 10h16", key: "h" }],
  ["path", { d: "M7.5 14h3.5M7.5 17h2.5", key: "l" }],
  ["path", { d: "M14.5 13.5v4.5l1.5-1.1 1.5 1.1v-4.5", key: "b" }],
]));

export const OnayIcon: LucideIcon = createLucideIcon("es-onay", node([
  ["circle", { cx: "12", cy: "9.5", r: "6", ...DUO, key: "d" }],
  ["circle", { cx: "12", cy: "9.5", r: "6", key: "c" }],
  ["path", { d: "m9.4 9.6 1.8 1.8 3.4-3.6", key: "k" }],
  ["path", { d: "M8.6 14.5 7.2 21l4.8-2.2 4.8 2.2-1.4-6.5", key: "r" }],
]));

export const GelenKutusuIcon: LucideIcon = createLucideIcon("es-gelen-kutusu", node([
  ["path", { d: "M3 13h5l1.5 2.5h5L16 13h5v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", ...DUO, key: "d" }],
  ["path", { d: "M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5l-2.6-5.7A2 2 0 0 0 16.6 6H16M8 6h-.6a2 2 0 0 0-1.8 1.3L3 13", key: "t" }],
  ["path", { d: "M3 13h5l1.5 2.5h5L16 13h5", key: "l" }],
  ["path", { d: "M12 3v7.5M9 7.5l3 3 3-3", key: "a" }],
]));

export const MulkYonetimiIcon: LucideIcon = createLucideIcon("es-mulk-yonetimi", node([
  ["path", { d: "M4.5 9.6 10 5l5.5 4.6v2.7a4.5 4.5 0 0 0-3.3 7.7H4.5z", ...DUO, key: "d" }],
  ["path", { d: "M2.5 11.2 10 4.8l7.5 6.4", key: "r" }],
  ["path", { d: "M4.5 9.6V20h7", key: "w" }],
  ["circle", { cx: "17", cy: "17", r: "2", key: "g" }],
  ["path", { d: "M17 13.3v1.2M17 19.5v1.2M13.3 17h1.2M19.5 17h1.2M14.4 14.4l.8.8M18.8 18.8l.8.8M14.4 19.6l.8-.8M18.8 15.2l.8-.8", key: "s" }],
]));

export const GelenAramaIcon: LucideIcon = createLucideIcon("es-gelen-arama", node([
  ["path", { d: "M5 3h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z", ...DUO, key: "d" }],
  ["path", { d: "M5 3h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z", key: "p" }],
  ["path", { d: "M20.5 3.5 15 9M15 4.5V9h4.5", key: "a" }],
]));

export const PortalTeyitIcon: LucideIcon = createLucideIcon("es-portal-teyit", node([
  ["path", { d: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2H3z", ...DUO, key: "d" }],
  ["path", { d: "M12 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6", key: "w" }],
  ["path", { d: "M3 8h18M7 12h5M7 15.5h3", key: "l" }],
  ["circle", { cx: "17.5", cy: "17.5", r: "3.5", key: "c" }],
  ["path", { d: "m16 17.6 1 1 2-2.1", key: "k" }],
]));

export const SistemSagligiIcon: LucideIcon = createLucideIcon("es-sistem-sagligi", node([
  ["path", { d: "M12 20.5s-8.5-5-8.5-11.3A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7c0 6.3-8.5 11.3-8.5 11.3z", ...DUO, key: "d" }],
  ["path", { d: "M5 15.2C4 13.6 3.5 11.4 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7c0 2.2-.5 4.4-1.5 6M7.5 17.6c2.1 1.8 4.5 2.9 4.5 2.9s2.4-1.1 4.5-2.9", key: "h" }],
  ["path", { d: "M2 12.5h5l1.5-3 3 6 2-4.5 1.3 1.5H22", key: "p" }],
]));

export const KurulumIcon: LucideIcon = createLucideIcon("es-kurulum", node([
  ["circle", { cx: "12", cy: "12.5", r: "8.5", ...DUO, key: "d" }],
  ["path", { d: "M12 4a8.5 8.5 0 1 1-8.1 5.9", key: "a" }],
  ["path", { d: "m8.6 12.6 2.4 2.4 4.4-4.8", key: "k" }],
  ["path", { d: "M5 2.5v4M3 4.5h4", key: "s" }],
]));

export const OfisteIcon: LucideIcon = createLucideIcon("es-ofiste", node([
  ["path", { d: "M5 5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16H5z", ...DUO, key: "d" }],
  ["path", { d: "M5 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16M3 21h10", key: "b" }],
  ["path", { d: "M8 8h.01M11 8h.01M8 11.5h.01M11 11.5h.01M8.5 21v-4h2v4", key: "o" }],
  ["circle", { cx: "18.5", cy: "11", r: "2", key: "h" }],
  ["path", { d: "M16 21v-2.5a2.5 2.5 0 0 1 5 0V21", key: "p" }],
]));

/** Kavram → marka ikonu (sözleşme testi ve vitrin/önizleme için tek liste). */
export const BRAND_ICONS = {
  portfoy: PortfoyIcon,
  tapu: TapuIcon,
  anahtar: AnahtarIcon,
  yerGosterme: YerGostermeIcon,
  komisyon: KomisyonIcon,
  kira: KiraIcon,
  aidat: AidatIcon,
  eids: EidsIcon,
  ilanPortal: IlanPortalIcon,
  eslesme: EslesmeIcon,
  degerleme: DegerlemeIcon,
  mulkSahibi: MulkSahibiIcon,
  imza: ImzaIcon,
  ajanda: AjandaIcon,
  onay: OnayIcon,
  gelenKutusu: GelenKutusuIcon,
  mulkYonetimi: MulkYonetimiIcon,
  gelenArama: GelenAramaIcon,
  portalTeyit: PortalTeyitIcon,
  sistemSagligi: SistemSagligiIcon,
  kurulum: KurulumIcon,
  ofiste: OfisteIcon,
} satisfies Record<string, LucideIcon>;

export type BrandIconConcept = keyof typeof BRAND_ICONS;

/** IconChip tonu (icon-chip.tsx ile aynı küme; tip döngüsü olmasın diye burada yinelenir). */
type V4Tone = "brand" | "success" | "warn" | "danger" | "gold" | "neutral";

/**
 * v4 REFERANS İKONLARI — kabuk menüsü ve ana sayfa kartlarında görünen her kavramın ikon + ton karosu.
 * Kullanım: `<IconChip icon={V4_ICON_TILES.ajanda.icon} tone={V4_ICON_TILES.ajanda.tone} />`. Çizgi kalınlığı
 * globals.css'teki tek kuralla 1,75'tir (`svg.lucide[stroke-width="2"]`); ham renk yok, ton `.pm-t-*` ailesinden.
 */
export const V4_ICON_TILES = {
  ajanda: { label: "Ajanda", icon: AjandaIcon, tone: "brand" },
  onaylar: { label: "Onaylar", icon: OnayIcon, tone: "warn" },
  gelenKutusu: { label: "Gelen kutusu", icon: GelenKutusuIcon, tone: "brand" },
  ilanPortal: { label: "İlanlar & Portal", icon: IlanPortalIcon, tone: "gold" },
  mulkYonetimi: { label: "Mülk yönetimi", icon: MulkYonetimiIcon, tone: "neutral" },
  gelenArama: { label: "Gelen arama", icon: GelenAramaIcon, tone: "brand" },
  portalTeyit: { label: "Portal teyit", icon: PortalTeyitIcon, tone: "gold" },
  sistemSagligi: { label: "Sistem sağlığı", icon: SistemSagligiIcon, tone: "success" },
  kurulum: { label: "Kurulum", icon: KurulumIcon, tone: "brand" },
  bugunOfiste: { label: "Bugün ofiste", icon: OfisteIcon, tone: "success" },
} as const satisfies Record<string, { label: string; icon: LucideIcon; tone: V4Tone }>;

export type V4IconConcept = keyof typeof V4_ICON_TILES;
