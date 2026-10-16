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
} satisfies Record<string, LucideIcon>;

export type BrandIconConcept = keyof typeof BRAND_ICONS;
