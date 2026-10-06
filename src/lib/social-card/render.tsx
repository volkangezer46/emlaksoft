import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SOCIAL_CARD_FORMATS, complianceLines, displayUrl, type SocialCardFormat } from "@/lib/social-card/core";

/**
 * Sosyal paylaşım kartı görseli (next/og). Yalnız gerçek veri basılır; boş alan çizilmez.
 * Alt bant: ofis adı + (doluysa) yetki belgesi no + (doluysa) EİDS taşınmaz no + doğrulanmış ilan bağlantısı.
 */
export type SocialCardRenderInput = {
  format: SocialCardFormat;
  coverDataUrl: string | null;
  badge: string | null;
  title: string;
  location: string | null;
  price: string | null;
  specs: string[];
  officeName: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  licenseNo: string | null;
  eidsNo: string | null;
  listingUrl: string;
};

function safeColor(c?: string | null): string {
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : "#1463ff";
}
function safeLogo(url?: string | null): string | null {
  if (!url || !/^https:\/\//i.test(url)) return null;
  return /\.(png|jpe?g)(\?|$)/i.test(url) ? url : null;
}

export async function renderSocialCard(input: SocialCardRenderInput): Promise<ImageResponse> {
  const { width, height } = SOCIAL_CARD_FORMATS[input.format];
  const story = input.format === "hikaye";
  const manrope = await readFile(join(process.cwd(), "src/assets/manrope-800.woff"));
  const accent = safeColor(input.brandColor);
  const logo = safeLogo(input.logoUrl);
  const title = input.title.length > 80 ? `${input.title.slice(0, 77)}...` : input.title;
  const photoH = story ? 1080 : 600;
  const lines = complianceLines({
    listingUrl: displayUrl(input.listingUrl, story ? 46 : 52),
    eidsNo: input.eidsNo,
    licenseNo: input.licenseNo,
    officeName: null,
  });

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#071a38", color: "#ffffff", fontFamily: "Manrope" }}>
        <div style={{ position: "relative", width: "100%", height: photoH, display: "flex", background: "linear-gradient(150deg, #0a2247 0%, #071a38 60%, #05122a 100%)" }}>
          {input.coverDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- next/og (satori) img kullanır
            <img src={input.coverDataUrl} alt="" width={width} height={photoH} style={{ width: "100%", height: photoH, objectFit: "cover" }} />
          ) : (
            <div style={{ position: "absolute", top: -200, right: -160, width: 640, height: 640, borderRadius: "50%", background: `radial-gradient(circle, ${accent}99, ${accent}00 70%)`, display: "flex" }} />
          )}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 220, display: "flex", background: "linear-gradient(to top, #071a38, rgba(7,26,56,0))" }} />
          {input.badge ? (
            <div style={{ position: "absolute", top: 48, left: 56, display: "flex", padding: "12px 28px", borderRadius: 999, background: accent, fontSize: 34 }}>{input.badge}</div>
          ) : null}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: story ? "48px 64px 64px" : "28px 56px 40px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: story ? 20 : 12 }}>
            {input.price ? <div style={{ fontSize: story ? 84 : 64, color: "#f4c45a" }}>{input.price}</div> : null}
            <div style={{ fontSize: story ? 56 : 42, lineHeight: 1.15 }}>{title}</div>
            {input.location || input.specs.length ? (
              <div style={{ fontSize: story ? 36 : 28, color: "rgba(255,255,255,0.72)" }}>{[input.location, ...input.specs].filter(Boolean).join("  ·  ")}</div>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, borderTop: "2px solid rgba(255,255,255,0.14)", paddingTop: story ? 28 : 18 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: story ? 26 : 21, color: "rgba(255,255,255,0.82)" }}>
              {input.officeName ? <div style={{ fontSize: story ? 32 : 26, color: "#ffffff" }}>{input.officeName}</div> : null}
              {lines.map((l) => (
                <div key={l}>{l}</div>
              ))}
            </div>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- next/og (satori) img kullanır
              <img src={logo} alt="" width={story ? 120 : 96} height={story ? 120 : 96} style={{ borderRadius: 20, objectFit: "contain", background: "#fff" }} />
            ) : null}
          </div>
        </div>
      </div>
    ),
    { width, height, fonts: [{ name: "Manrope", data: manrope, weight: 800, style: "normal" }] },
  );
}
