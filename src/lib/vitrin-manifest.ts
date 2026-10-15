/**
 * Ofis vitrini PWA manifest'i (PUB-10) — SAF. Ziyaretçi ofis vitrinini ana ekrana eklediğinde EmlakSoft değil OFİSİN
 * adı, rengi ve logosu görünür. Logo yoksa nötr ev simgesi (EmlakSoft markası değil). Kapsam yalnız o vitrindir.
 */

const HEX = /^#[0-9a-f]{6}$/i;
const NEUTRAL_THEME = "#334155";

export type VitrinManifestInput = { name: string | null; slug: string; brandColor: string | null; logoUrl: string | null };

function shortName(name: string): string {
  if (name.length <= 12) return name;
  const first = name.split(/\s+/)[0] ?? name;
  return (first.length >= 3 ? first : name).slice(0, 12);
}

/** Yalnız https (ya da kök göreli) logo kabul edilir; başka şema manifest'e yazılmaz. */
function safeLogo(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function buildVitrinManifest(input: VitrinManifestInput) {
  const name = (input.name ?? "").trim().slice(0, 60) || "Emlak ofisi";
  const base = `/vitrin/${encodeURIComponent(input.slug)}`;
  const theme = input.brandColor && HEX.test(input.brandColor) ? input.brandColor : NEUTRAL_THEME;
  const logo = safeLogo(input.logoUrl);
  const icons = logo
    ? [{ src: logo, sizes: "any", purpose: "any" }]
    : [
        { src: "/brand/vitrin-neutral-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: "/brand/vitrin-neutral-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ];
  return {
    id: `${base}`,
    name,
    short_name: shortName(name),
    description: `${name} satılık ve kiralık ilanları`,
    start_url: base,
    scope: `${base}/`.replace(/\/\/$/, "/"),
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: theme,
    lang: "tr",
    dir: "ltr",
    categories: ["business", "lifestyle"],
    icons,
  };
}
