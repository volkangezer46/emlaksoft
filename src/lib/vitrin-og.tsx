import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Vitrin paylaşım kartı (1200x630) — ilan/ofis başına dinamik OG görseli.
 * Ortak Brand bileşenine BAĞIMLI DEĞİL: logo yalnız kiracının PNG/JPG logo URL'i varsa
 * kullanılır (satori webp/svg okumaz), yoksa baş harf sembolü çizilir.
 * Yalnız gerçek veri basılır; boş alan hiç çizilmez.
 */
export const OG_SIZE = { width: 1200, height: 630 };

export type VitrinOgInput = {
  office: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  badge?: string | null; // "Satılık" / "Kiralık"
  title: string;
  location?: string | null;
  price?: string | null;
  specs?: string[];
  /**
   * Arka plan fotoğrafı (data: URL, JPEG; `loadOgPhoto` üretir). Verilirse kart fotoğraflı çizilir: tam kaplayan
   * görsel + okunabilirlik için koyu degrade. Verilmezse (fotoğrafsız ilan) markalı yedek kart aynen çizilir.
   */
  photo?: string | null;
};

function safeLogo(url?: string | null): string | null {
  if (!url || !/^https:\/\//i.test(url)) return null;
  return /\.(png|jpe?g)(\?|$)/i.test(url) ? url : null;
}

function safeColor(c?: string | null): string {
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : "#1463ff";
}

/**
 * `init.headers`: ImageResponse üretimde 1 yıllık `immutable` önbellek başlığı yazar; token'lı kartlar (kapı her
 * istekte değerlendirilir) `no-store` geçer. Vitrin kartları varsayılanı kullanır.
 */
export async function renderVitrinOg(input: VitrinOgInput, init?: { headers?: Record<string, string> }): Promise<ImageResponse> {
  const manrope = await readFile(join(process.cwd(), "src/assets/manrope-800.woff"));
  const logo = safeLogo(input.logoUrl);
  const accent = safeColor(input.brandColor);
  const title = input.title.length > 90 ? `${input.title.slice(0, 87)}...` : input.title;
  const photo = input.photo && input.photo.startsWith("data:image/") ? input.photo : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(150deg, #0a2247 0%, #071a38 55%, #05122a 100%)",
          color: "#ffffff",
          fontFamily: "Manrope",
        }}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- next/og (satori) img kullanır
          <img
            src={photo}
            alt=""
            width={OG_SIZE.width}
            height={OG_SIZE.height}
            style={{ position: "absolute", top: 0, left: 0, width: OG_SIZE.width, height: OG_SIZE.height, objectFit: "cover" }}
          />
        ) : null}
        {photo ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: OG_SIZE.width,
              height: OG_SIZE.height,
              display: "flex",
              background: "linear-gradient(180deg, rgba(5,18,42,0.78) 0%, rgba(5,18,42,0.18) 34%, rgba(5,18,42,0.35) 55%, rgba(5,18,42,0.92) 100%)",
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -120,
            width: 520,
            height: 520,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${accent}88, ${accent}00 70%)`,
            display: photo ? "none" : "flex",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- next/og (satori) img kullanır
            <img src={logo} alt="" width={64} height={64} style={{ borderRadius: 16, objectFit: "contain", background: "#fff" }} />
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                background: accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 36,
                fontWeight: 800,
              }}
            >
              {(input.office[0] ?? "E").toLocaleUpperCase("tr-TR")}
            </div>
          )}
          <div style={{ fontSize: 32, fontWeight: 800, display: "flex" }}>{input.office}</div>
          {input.badge ? (
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                padding: "10px 22px",
                borderRadius: 999,
                background: "#10b9a3",
                fontSize: 26,
                fontWeight: 800,
              }}
            >
              {input.badge}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 60, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5, display: "flex" }}>{title}</div>
          {input.location ? (
            <div style={{ fontSize: 30, color: "rgba(255,255,255,0.7)", display: "flex" }}>{input.location}</div>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          {input.price ? (
            <div style={{ fontSize: 64, fontWeight: 800, color: "#5eead4", display: "flex" }}>{input.price}</div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
          {input.specs && input.specs.length > 0 ? (
            <div style={{ display: "flex", gap: 14 }}>
              {input.specs.slice(0, 3).map((s) => (
                <div
                  key={s}
                  style={{
                    display: "flex",
                    padding: "10px 20px",
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.12)",
                    fontSize: 28,
                    fontWeight: 800,
                  }}
                >
                  {s}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [{ name: "Manrope", data: manrope, weight: 800, style: "normal" }],
      ...(init?.headers ? { headers: init.headers } : {}),
    },
  );
}
