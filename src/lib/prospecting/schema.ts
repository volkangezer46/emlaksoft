import { z } from "zod";
import { optionalPhoneSchema } from "@/lib/validation/contact";
import { FSBO_PORTALS, FSBO_SOURCES, FSBO_TRANSACTIONS } from "./types";
import { parseListingUrl } from "./url";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const num = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000_000) {
      ctx.addIssue({ code: "custom", message: "Sayı geçersiz." });
      return z.NEVER;
    }
    return n;
  });

/**
 * Sahibinden ilan kaydı girdisi (elle ekleme + eklenti). Telefon `optionalPhoneSchema` ile (parsePhoneStrict) doğrulanır
 * ve SAKLAMA BİÇİMİNE çevrilir. Açıklama metni ve fotoğraf kabul edilmez (telif; yalnız bağlantı).
 */
export const fsboSaveSchema = z
  .object({
    source: z.enum(FSBO_SOURCES).default("manual"),
    url: text(600),
    portal: z.enum(FSBO_PORTALS).nullish(),
    externalId: text(40),
    title: text(200),
    transactionType: z.enum(FSBO_TRANSACTIONS).default("sale"),
    propertyType: text(60),
    price: num,
    rooms: text(20),
    grossM2: num,
    netM2: num,
    districtId: text(60),
    provinceId: text(60),
    locationText: text(200),
    listedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v ?? null),
    ownerName: text(120),
    phone: optionalPhoneSchema,
    assignedTo: text(60),
  })
  .superRefine((v, ctx) => {
    const parsed = parseListingUrl(v.url);
    if (v.url && !parsed) ctx.addIssue({ code: "custom", path: ["url"], message: "Yalnız Sahibinden, Hepsiemlak veya Emlakjet ilan bağlantısı girin." });
    if (!v.url && !v.title && !v.phone) ctx.addIssue({ code: "custom", path: ["url"], message: "İlan bağlantısı, başlık veya telefondan en az biri gerekli." });
  })
  .transform((v) => {
    const parsed = parseListingUrl(v.url);
    return {
      ...v,
      url: parsed?.url ?? null,
      portal: parsed?.portal ?? v.portal ?? "other",
      externalId: parsed?.externalId ?? v.externalId,
    };
  });

export type FsboSaveInput = z.output<typeof fsboSaveSchema>;
