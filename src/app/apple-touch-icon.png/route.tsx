/* eslint-disable @next/next/no-img-element -- ImageResponse (satori) yalnız <img> kabul eder */
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getBrandAsset, getBrandMeta } from "@/lib/brand/store";

/**
 * /apple-touch-icon.png (180x180). iOS ve bazı tarayıcılar bu adresi <link> beklemeden doğrudan ister; dosya yoktu
 * ve 404 listesini dolduruyordu. Süper admin marka SEMBOLÜ yüklediyse ondan beyaz zeminde üretilir (ImageResponse);
 * yoksa varsayılan favicon kaynağından üretilmiş public/brand/apple-touch-icon.png sunulur.
 */

export const dynamic = "force-dynamic";

const SIZE = 180;
const CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

async function fromBrandMark(): Promise<Response | null> {
  try {
    const meta = await getBrandMeta();
    if (!meta.slots.mark) return null;
    const asset = await getBrandAsset("mark");
    if (!asset) return null;
    const src = asset.type === "svg" ? `data:image/svg+xml;base64,${Buffer.from(asset.data).toString("base64")}` : `data:image/png;base64,${asset.data}`;
    const img = new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
          <img src={src} width={132} height={132} alt="" style={{ objectFit: "contain" }} />
        </div>
      ),
      { width: SIZE, height: SIZE },
    );
    const body = await img.arrayBuffer();
    return new Response(body, { headers: { "Content-Type": "image/png", "Cache-Control": CACHE } });
  } catch {
    return null;
  }
}

export async function GET() {
  const branded = await fromBrandMark();
  if (branded) return branded;
  try {
    const file = await readFile(join(process.cwd(), "public/brand/apple-touch-icon.png"));
    return new Response(new Uint8Array(file), { headers: { "Content-Type": "image/png", "Cache-Control": CACHE } });
  } catch {
    return new Response(null, { status: 307, headers: { Location: "/brand/apple-touch-icon.png", "Cache-Control": "public, max-age=300" } });
  }
}
