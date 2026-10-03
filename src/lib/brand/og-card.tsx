import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getBrandAsset, getBrandMeta } from "@/lib/brand/store";
import { readPngSize } from "@/lib/brand/upload-validation";

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

/** 1200x630 marka kartı: opengraph-image ve twitter-image ortak çıktısı. */
export async function renderBrandCard() {
  // Manrope 800 — satori woff2 desteklemediğinden woff olarak src/assets'te tutulur.
  const manrope = await readFile(join(process.cwd(), "src/assets/manrope-800.woff"));
  const logo = await loadOgLogo();

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
          background: "linear-gradient(150deg, #0a2247 0%, #071a38 55%, #05122a 100%)",
          color: "#ffffff",
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
            background: "radial-gradient(circle, rgba(20,99,255,0.55), rgba(20,99,255,0) 70%)",
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
            background: "radial-gradient(circle, rgba(246,210,122,0.22), rgba(246,210,122,0) 70%)",
            display: "flex",
          }}
        />
        <div style={{ display: "flex" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- satori <img> */}
          <img src={logo.src} width={logo.width} height={logo.height} alt="" />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5, maxWidth: 900 }}>
            Türkiye’nin emlak işletim sistemi
          </div>
          <div style={{ fontSize: 30, color: "rgba(255,255,255,0.66)", maxWidth: 880, lineHeight: 1.35 }}>
            Müşteriden tapuya, ilandan komisyona — ofisinizi tek premium platformda yönetin.
          </div>
        </div>

        <div style={{ display: "flex", gap: 14 }}>
          {["İYS/EİDS hazırlık akışları", "Yapay zeka destekli", "Portal operasyonları"].map((t) => (
            <div
              key={t}
              style={{
                display: "flex",
                fontSize: 24,
                fontWeight: 600,
                padding: "12px 22px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.16)",
                background: "rgba(255,255,255,0.06)",
                color: "#f6d27a",
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
