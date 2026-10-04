import { z } from "zod";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { DEFAULT_PHONE_COUNTRY } from "@/lib/phone-countries";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";

/**
 * Zod sarmalayıcıları (parsePhone / normalizeEmail üstünde). NOT: mevcut server action'lar bugün doğrudan
 * `parsePhone` / `normalizeEmail` + `isValidEmail` kullanır; bu şemalar henüz üretimde import edilmiyor
 * (zod ile doğrulanan yeni action'larda kullanılabilir). Sözleşme testi: src/lib/contact-input-contract.test.ts.
 *
 * - phoneSchema: zorunlu; çıktı SAKLAMA BİÇİMİ (05XXXXXXXXX / 0XXXXXXXXXX / +<E.164>).
 * - optionalPhoneSchema: boş/null/undefined -> null; doluysa geçerli olmalı.
 * - emailSchema: zorunlu; çıktı normalize (kırpılmış, küçük harf).
 * - optionalEmailSchema: boş -> null.
 */

export function phoneSchemaFor(defaultCountry: string = DEFAULT_PHONE_COUNTRY) {
  return z
    .string({ error: "Telefon numarası girin" })
    .trim()
    .min(1, "Telefon numarası girin")
    .transform((value, ctx) => {
      const p = parsePhoneStrict(value, defaultCountry);
      if (!p.ok) {
        ctx.addIssue({ code: "custom", message: p.error ?? PHONE_ERROR_MESSAGE });
        return z.NEVER;
      }
      return p.stored;
    });
}

export function optionalPhoneSchemaFor(defaultCountry: string = DEFAULT_PHONE_COUNTRY) {
  return z
    .string()
    .nullish()
    .transform((value, ctx): string | null => {
      const raw = (value ?? "").trim();
      if (!raw) return null;
      const p = parsePhoneStrict(raw, defaultCountry);
      if (!p.ok) {
        ctx.addIssue({ code: "custom", message: p.error ?? PHONE_ERROR_MESSAGE });
        return z.NEVER;
      }
      return p.stored;
    });
}

export const phoneSchema = phoneSchemaFor();
export const optionalPhoneSchema = optionalPhoneSchemaFor();

export const emailSchema = z
  .string({ error: "E-posta adresi girin" })
  .trim()
  .min(1, "E-posta adresi girin")
  .transform((value, ctx) => {
    const email = normalizeEmail(value);
    if (!isValidEmail(email)) {
      ctx.addIssue({ code: "custom", message: EMAIL_ERROR_MESSAGE });
      return z.NEVER;
    }
    return email;
  });

export const optionalEmailSchema = z
  .string()
  .nullish()
  .transform((value, ctx): string | null => {
    const raw = (value ?? "").trim();
    if (!raw) return null;
    const email = normalizeEmail(raw);
    if (!isValidEmail(email)) {
      ctx.addIssue({ code: "custom", message: EMAIL_ERROR_MESSAGE });
      return z.NEVER;
    }
    return email;
  });
