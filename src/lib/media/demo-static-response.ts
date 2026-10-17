import { demoVariantUrl } from "@/lib/sample-data/demo-photo-pick";

/**
 * Statik demo fotoğrafı (örnek portföy; `/img/demo/...`) için medya uçlarının ortak yanıtı: aynı sitedeki statik dosyaya
 * 307. Hedef `demoStaticTarget` ile doğrulanmış yoldur (dış adres olamaz); genişlik verilirse manifestteki en yakın türev.
 * Kapılar (izin, tenant, public kuralı) çağıranda AYNEN uygulanmış olmalıdır; bu yardımcı yalnız yanıtı kurar.
 */
export function demoStaticResponse(_req: Request, target: string, width?: number): Response {
  const path = width ? demoVariantUrl(target, width) : target;
  return new Response(null, {
    status: 307,
    headers: {
      // Göreli konum: konteyner içinde `req.url` iç adres (0.0.0.0:3000) taşır; mutlak URL tarayıcıyı oraya yolluyordu.
      Location: path,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
