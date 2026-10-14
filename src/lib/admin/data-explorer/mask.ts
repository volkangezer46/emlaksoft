/**
 * Veri gezgini (SN4) kişisel veri maskeleri — SAF, yan etkisiz. Mevcut maskeleyiciler yeniden kullanılır
 * (ad: KVKK başvuruları, e-posta: hesap e-postası değişimi, IBAN: mülk yönetimi, serbest metin: hata kaydı maskesi);
 * telefon, vergi/kimlik no, adres, doğum tarihi ve IP için kısa yerel kurallar.
 *
 * Kural: maskeli sütunun HAM değeri sunucudan istemciye hiç gitmez (görünüm sunucu bileşenidir; maske render'dan önce).
 */
import { maskPersonName } from "@/lib/compliance/platform-kvkk";
import { maskEmail } from "@/lib/account/email-change";
import { maskIban } from "@/lib/property-management/iban";
import { maskPii } from "@/lib/pii-mask";

export type MaskKind = "name" | "phone" | "email" | "iban" | "idNo" | "address" | "birthDate" | "freeText" | "ip";

export const MASK_LABELS: Record<MaskKind, string> = {
  name: "Ad soyad",
  phone: "Telefon",
  email: "E-posta",
  iban: "IBAN",
  idNo: "Kimlik / vergi no",
  address: "Adres",
  birthDate: "Doğum tarihi",
  freeText: "Serbest metin (kişisel veri desenleri gizli)",
  ip: "IP adresi",
};

const FREE_TEXT_MAX = 200;

/** "05321234567" → "05** *** ** 67": yalnız son 2 hane görünür (uzunluk ipucu verilmez). */
export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  const prefix = raw.trim().startsWith("+") ? "+" : digits.startsWith("0") ? "0" : "";
  return `${prefix}*** *** ** ${digits.slice(-2)}`;
}

/** Vergi / TC / pasaport no: yalnız son 2 karakter. */
export function maskIdNo(raw: string): string {
  const v = raw.replace(/\s+/g, "");
  return v.length <= 2 ? "***" : `*******${v.slice(-2)}`;
}

/** Adres: yalnız ilk sözcüğün ilk 3 harfi (mahalle/cadde ipucu bile verilmez). */
export function maskAddress(raw: string): string {
  const first = raw.trim().split(/\s+/)[0] ?? "";
  return first ? `${Array.from(first).slice(0, 3).join("")}*** (gizli)` : "***";
}

/** Doğum tarihi: yalnız yıl. */
export function maskBirthDate(raw: string): string {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(raw.trim());
  return m ? `**.**.${m[1]}` : "***";
}

/** IPv4 son iki oktet, IPv6 ilk iki grup dışı gizli. */
export function maskIp(raw: string): string {
  const v = raw.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return `${v.split(".").slice(0, 2).join(".")}.*.*`;
  if (v.includes(":")) return `${v.split(":").slice(0, 2).join(":")}:****`;
  return "***";
}

/** Maskeli sütunun gösterilecek değeri. Boş değer boş kalır (maske "veri var" izlenimi vermez). */
export function maskValue(kind: MaskKind, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value);
  switch (kind) {
    case "name":
      return maskPersonName(raw);
    case "phone":
      return maskPhone(raw);
    case "email":
      return maskEmail(raw.trim().toLowerCase());
    case "iban":
      return maskIban(raw) ?? "***";
    case "idNo":
      return maskIdNo(raw);
    case "address":
      return maskAddress(raw);
    case "birthDate":
      return maskBirthDate(raw);
    case "ip":
      return maskIp(raw);
    case "freeText": {
      // Önce maskele sonra kırp: kırpma bir deseni bölüp sızdırmasın (sanitizeLogText ile aynı sıra).
      const masked = maskPii(raw).trim();
      return masked.length > FREE_TEXT_MAX ? `${masked.slice(0, FREE_TEXT_MAX)}…` : masked;
    }
  }
}
