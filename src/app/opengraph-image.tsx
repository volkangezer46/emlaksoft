import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "EmlakSoft — Türkiye'nin emlak işletim sistemi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  // Manrope 800 — satori woff2 desteklemediğinden woff olarak src/assets'te tutulur.
  // Node runtime (varsayılan) fs erişimi sağlar; process.cwd() proje kökü.
  const manrope = await readFile(join(process.cwd(), "src/assets/manrope-800.woff"));

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
        {/* Glow */}
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
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: 18,
              background: "linear-gradient(120deg, #1463ff, #22d3ee 55%, #10b9a3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 38,
              fontWeight: 800,
            }}
          >
            E
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>EmlakSoft</div>
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
          {["İYS/EİDS uyumlu", "Yapay zeka destekli", "Portal entegrasyonu"].map((t) => (
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
                color: "#7de3d3",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Manrope", data: manrope, style: "normal", weight: 800 }],
    },
  );
}
