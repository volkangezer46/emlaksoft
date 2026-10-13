import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getBrandAsset, getBrandMeta } from "@/lib/brand/store";
import { OG_THEME } from "@/lib/brand/og-theme";
import { readPngSize } from "@/lib/brand/upload-validation";
import { defaultSiteMenu } from "@/lib/site-menu/defaults";
import type { OgCard } from "@/lib/site-menu/schema";
import { getLiveSiteMenu } from "@/lib/site-menu/store";

export const OG_ALT = "EmlakSoft — Türkiye'nin emlak işletim sistemi";
export const OG_SIZE = { width: 1200, height: 630 };

const LOGO_H = 72;
const DEFAULT_ASPECT = 340 / 64;

function svgAspect(svg: string): number {
  const m = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
  return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : DEFAULT_ASPECT;
}

/** Koyu zemin logosu: süper admin yüklemesi varsa o, yoksa varsayılan (public/brand). */
async function loadOgLogo(): Promise<{ src: string; width: number; height: number }> {
  try {
    const meta = await getBrandMeta();
    const asset = meta.slots["logo-dark"] ? await getBrandAsset("logo-dark") : null;
    if (asset?.type === "svg") {
      return {
        src: "data:image/svg+xml;base64," + Buffer.from(asset.data).toString("base64"),
        width: Math.round(LOGO_H * svgAspect(asset.data)),
        height: LOGO_H,
      };
    }
    if (asset?.type === "png") {
      const size = readPngSize(new Uint8Array(Buffer.from(asset.data, "base64")));
      if (size) {
        return { src: "data:image/png;base64," + asset.data, width: Math.round((LOGO_H * size.w) / size.h), height: LOGO_H };
      }
    }
  } catch {
    // varsayılan logoya düş
  }
  const svg = await readFile(join(process.cwd(), "public/brand/logo-horizontal-dark.svg"), "utf8");
  return {
    src: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
    width: Math.round(LOGO_H * svgAspect(svg)),
    height: LOGO_H,
  };
}

/** Kart metni: yönetimden (Site menüsü > Paylaşım kartı; yayın yoksa bugünkü metin). Okunamazsa varsayılan. */
async function loadOgText(): Promise<OgCard> {
  try {
    return (await getLiveSiteMenu()).ogCard;
  } catch {
    return defaultSiteMenu().ogCard;
  }
}

/** 1200x630 marka kartı: opengraph-image ve twitter-image ortak çıktısı. Metin düz metindir (satori, HTML işlenmez). */
export async function renderBrandCard() {
  // Manrope 800 — satori woff2 desteklemediğinden woff olarak src/assets'te tutulur.
  const [manrope, logo, card] = await Promise.all([
    readFile(join(process.cwd(), "src/assets/manrope-800.woff")),
    loadOgLogo(),
    loadOgText(),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: OG_THEME.background,
          color: OG_THEME.text,
          fontFamily: "Manrope",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -120,
            width: 520,
            height: 520,
            borderRadius: "50%",
            background: OG_THEME.glowBlue,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -200,
            left: -140,
            width: 480,
            height: 480,
            borderRadius: "50%",
            background: OG_THEME.glowGold,
            display: "flex",
          }}
        />
        <div style={{ display: "flex" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- satori <img> */}
          <img src={logo.src} width={logo.width} height={logo.height} alt="" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5, maxWidth: 900 }}>
            {card.title}
          </div>
          {card.subtitle ? (
            <div style={{ fontSize: 30, color: OG_THEME.subtitle, maxWidth: 880, lineHeight: 1.35 }}>
              {card.subtitle}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 14 }}>
          {card.chips.map((t, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                fontSize: 24,
                fontWeight: 600,
                padding: "12px 22px",
                borderRadius: 999,
                border: OG_THEME.chipBorder,
                background: OG_THEME.chipBackground,
                color: OG_THEME.chipText,
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [{ name: "Manrope", data: manrope, style: "normal", weight: 800 }],
    },
  );
}
