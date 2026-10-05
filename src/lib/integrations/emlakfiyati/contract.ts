/**
 * Emlakfiyati arayüz SÖZLEŞMESİ (iskelet) — ONERI belgesi bölüm 3.2.
 *
 * DURUM: Emlakfiyati'nın gerçek API adresi, kimlik doğrulaması, alan adları ve kotası BİLİNMİYOR.
 * Buradaki şemalar Emlaksoft'un KENDİ tarafının tarif ettiği öneridir; hiçbir adres/alan adı sağlayıcıdan
 * alınmamıştır ve sağlayıcı belgesi gelince uyarlanır. Dış servis çağrısı YOKTUR (bkz. client.ts).
 *
 * Sözleşme kuralları:
 *  - İstek KİŞİSEL VERİ taşımaz (müşteri adı/telefon/e-posta/adres satırı/ofis adı yok); ofis yalnız tek yönlü `tenantRef`.
 *  - Yanıt zod ile doğrulanır; bilinmeyen alan atılır; zorunlu alan eksikse kaynak ATLANIR (null).
 *  - Çıktı mevcut `ValuationSource` biçimine eşlenir; ofis emsal motoru en yüksek ağırlıkta kalır (ağırlık sahibin kararı).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ValuationSource } from "@/lib/valuation";

export const EMLAKFIYATI_SOURCE_NAME = "Emlakfiyati";

/** Küçük örneklem eşiği: bunun altında kaynak güveni düşük sayılır ve nota yazılır. */
export const EMLAKFIYATI_LOW_SAMPLE = 5;

const shortText = z.string().trim().min(1).max(120);

/** Gönderilebilecek taşınmaz özeti. Alan beyaz listesidir: şemada olmayan hiçbir alan isteğe girmez. */
export const valuationSubjectSchema = z
  .object({
    province: shortText,
    district: shortText,
    neighborhood: shortText.optional(),
    propertyType: shortText,
    transactionType: z.enum(["sale", "rent"]),
    grossSqm: z.number().positive().max(100_000).optional(),
    netSqm: z.number().positive().max(100_000).optional(),
    rooms: z.string().trim().max(20).optional(),
    floor: z.number().int().min(-5).max(200).optional(),
    buildingAge: z.number().int().min(0).max(500).optional(),
    heating: shortText.optional(),
    facade: shortText.optional(),
    ada: z.string().trim().max(20).optional(),
    parsel: z.string().trim().max(20).optional(),
  })
  .strict();

export type ValuationSubject = z.infer<typeof valuationSubjectSchema>;

export const valuationRequestSchema = z
  .object({
    requestId: z.string().min(8).max(80),
    tenantRef: z.string().regex(/^[0-9a-f]{32}$/),
    subject: valuationSubjectSchema,
    options: z.object({ wantRange: z.boolean().optional(), wantComparables: z.boolean().optional() }).strict().optional(),
  })
  .strict();

export type ValuationRequest = z.infer<typeof valuationRequestSchema>;

/** Ofis kimliğinin tek yönlü karması (kota için); ham tenantId sağlayıcıya gitmez. */
export function tenantRef(tenantId: string, salt = "emlaksoft:emlakfiyati:v1"): string {
  return createHash("sha256").update(`${salt}:${tenantId}`).digest("hex").slice(0, 32);
}

/** İstek üretir ve şemayla doğrular (fazla/bilinmeyen alan ya da geçersiz değer atar → hata). */
export function buildValuationRequest(input: {
  requestId: string;
  tenantId: string;
  subject: ValuationSubject;
  options?: ValuationRequest["options"];
}): ValuationRequest {
  return valuationRequestSchema.parse({
    requestId: input.requestId,
    tenantRef: tenantRef(input.tenantId),
    subject: input.subject,
    options: input.options,
  });
}

const money = z.number().finite().positive();

export const valuationResponseSchema = z.object({
  estimate: z.object({
    low: money.optional(),
    mid: money,
    high: money.optional(),
    currency: z.literal("TRY"),
    pricePerSqm: money.optional(),
  }),
  confidence: z
    .object({
      level: z.string().max(40).optional(),
      basis: z.string().max(200).optional(),
      sampleSize: z.number().int().min(0).optional(),
    })
    .optional(),
  comparables: z
    .array(
      z.object({
        label: z.string().max(120),
        price: money,
        sqm: z.number().positive().optional(),
        asOf: z.string().max(40).optional(),
      }),
    )
    .max(50)
    .optional(),
  asOf: z.string().min(4).max(40),
  provider: z.object({ name: z.string().max(80), version: z.string().max(40).optional() }),
  methodologyNote: z.string().max(500).optional(),
});

export type ValuationResponse = z.infer<typeof valuationResponseSchema>;

/** Ham yanıtı doğrular; geçersizse (zorunlu alan eksik, TRY dışı para birimi...) null → çağıran kaynağı atlar. */
export function parseValuationResponse(raw: unknown): ValuationResponse | null {
  const res = valuationResponseSchema.safeParse(raw);
  if (!res.success) return null;
  const { low, mid, high } = res.data.estimate;
  if ((low !== undefined && low > mid) || (high !== undefined && high < mid)) return null; // tutarsız aralık
  return res.data;
}

/**
 * Yanıtı değerleme kaynağına eşler. `weight` dışarıdan (ofis/platform ayarı) gelir; varsayılan YOKTUR —
 * ağırlık politikası sahibin kararıdır. Sağlayıcı yanıtının ham gövdesi saklanmaz, yalnız bu özet.
 */
export function toValuationSource(resp: ValuationResponse, weight: number): ValuationSource | null {
  if (!Number.isFinite(weight) || weight <= 0) return null;
  const n = resp.confidence?.sampleSize;
  const parts = [
    resp.methodologyNote?.trim(),
    `Veri tarihi: ${resp.asOf}`,
    n !== undefined ? `Örneklem: ${n}${n < EMLAKFIYATI_LOW_SAMPLE ? " (az, güven düşük)" : ""}` : null,
  ].filter((s): s is string => Boolean(s));
  return { name: EMLAKFIYATI_SOURCE_NAME, weight, value: resp.estimate.mid, note: parts.join(" · ") };
}
