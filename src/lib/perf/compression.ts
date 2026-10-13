import { discardExternalResponse, fetchOwnOriginInspect } from "@/lib/external-fetch";

/**
 * SIKIŞTIRMA ÖZ TESTİ: herkese açık kökene `accept-encoding: br, gzip` ile istek atılır ve dönen `content-encoding`
 * okunur (gövde okunmaz). Brotli/zstd açmak Traefik `compress` ara katmanı ayarıdır (operasyon onayı gerekir):
 * docs/runbooks/HIZ_SIKISTIRMA.md.
 */
export type CompressionTone = "ok" | "warn" | "bad";
export type CompressionResult = {
  encoding: string | null;
  label: string;
  tone: CompressionTone;
  status: number | null;
  error?: string;
};

export const COMPRESSION_RUNBOOK = "docs/runbooks/HIZ_SIKISTIRMA.md";

/** `content-encoding` değeri → Türkçe sonuç (SAF). */
export function classifyEncoding(raw: string | null | undefined): Omit<CompressionResult, "status"> {
  const enc = (raw ?? "").trim().toLowerCase() || null;
  if (enc === "br") return { encoding: "br", label: "Brotli (br) — en iyi seçenek açık", tone: "ok" };
  if (enc === "zstd") return { encoding: "zstd", label: "zstd — modern sıkıştırma açık", tone: "ok" };
  if (enc === "gzip") return { encoding: "gzip", label: "gzip (br önerilir; operasyon onayı gerekir)", tone: "warn" };
  if (enc) return { encoding: enc, label: `${enc} (beklenmeyen kodlama; br önerilir)`, tone: "warn" };
  return { encoding: null, label: "Sıkıştırma yok (HTML ham gidiyor; gzip/br açılmalı)", tone: "bad" };
}

export async function selfTestCompression(origin: string, path = "/"): Promise<CompressionResult> {
  try {
    const res = await fetchOwnOriginInspect(
      `${origin.replace(/\/$/, "")}${path}`,
      { headers: { "accept-encoding": "br, gzip", accept: "text/html" }, cache: "no-store" },
      { timeoutMs: 10_000 },
    );
    const enc = res.headers.get("content-encoding");
    await discardExternalResponse(res);
    return { ...classifyEncoding(enc), status: res.status };
  } catch (e) {
    return { encoding: null, label: "Ölçülemedi (bağlantı hatası)", tone: "bad", status: null, error: e instanceof Error ? e.message : "bilinmeyen hata" };
  }
}
