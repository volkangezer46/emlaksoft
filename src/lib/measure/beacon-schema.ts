import { z } from "zod";
import { METRICS } from "./vitals";

/**
 * `/api/v` ölçüm işaretçisi (beacon) gövdesi. İstemci (`client/main.ts`) aynı kısa alan adlarını yazar.
 * Kişisel veri YOK: IP, çerez, kullanıcı aracısı, tam referrer URL'si, sorgu dizesi gönderilmez/saklanmaz.
 *   p: yol (sorgu sunucuda da atılır)       r: yalnız yönlendiren ana makine ("" = yok)
 *   u: { s, m, c } utm_source/medium/campaign (sunucuda cleanUtm + 32 karakter)
 *   d: "m" telefon | "d" bilgisayar           v: [[metrik, değer], ...] (en çok 10)
 *   s: 1 statik ana sayfa HTML'i, 0 normal    n: 1 bu gönderim sayfa görüntülemesini de taşır (sayfa başına bir kez)
 */
export const BEACON_MAX_BYTES = 4096;

const utmPart = z.string().max(64).optional();

export const BeaconSchema = z.object({
  p: z.string().min(1).max(300),
  r: z.string().max(253).optional().default(""),
  u: z.object({ s: utmPart, m: utmPart, c: utmPart }).partial().optional(),
  d: z.enum(["m", "d"]),
  v: z
    .array(z.tuple([z.enum(METRICS), z.number().finite().nonnegative()]))
    .max(10)
    .optional()
    .default([]),
  s: z.union([z.literal(0), z.literal(1)]).optional().default(0),
  n: z.union([z.literal(0), z.literal(1)]).optional().default(0),
});

export type Beacon = z.infer<typeof BeaconSchema>;

/** Ham metni (≤4 KB) güvenle çözer; geçersizse null. */
export function parseBeacon(text: string): Beacon | null {
  if (!text || text.length > BEACON_MAX_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = BeaconSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
