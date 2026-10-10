/**
 * Kayıt formu hata eşlemesi (SAF; istemci + sunucu ortak).
 *
 * Sunucu (`signUp`) alanla eşleşen hatada `field` döner; form o alanı odaklar ve hatayı ALANIN ALTINDA gösterir.
 * Alanla eşleşmeyen hatalar (kayıt kapalı, hız sınırı, teknik hata) genel bantta gösterilir. Metin tarayan
 * sezgisel eşleme YOK: hata metni değişse de alan doğru kalır.
 *
 * Kayıt TEK ekrandır ve 4 alan sorar (ad soyad, cep telefonu, e-posta, şifre); ofis bilgileri, paket ve ayrıntılar
 * üye olduktan sonra Kurulum sihirbazında (`/app/baslangic`) tamamlanır.
 */
import { parsePhone, PHONE_ERROR_MESSAGE, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";

export type SignupField = "name" | "email" | "phone" | "password";

/** Sunucunun "e-posta zaten kayıtlı" mesajı (action ile aynı metin); formda giriş / şifremi unuttum bağlantıları buna bağlanır. */
export const SIGNUP_EMAIL_EXISTS_MESSAGE = "Bu e-posta zaten kayıtlı.";

/** Alan -> adım (tek ekran: hepsi 1). */
export const SIGNUP_FIELD_STEP: Record<SignupField, number> = {
  name: 1,
  email: 1,
  phone: 1,
  password: 1,
};

/** Formdaki odaklanacak öğenin id'si (alan adıyla aynı). */
export function signupFieldInputId(field: SignupField): string {
  return field;
}

export function isSignupField(v: unknown): v is SignupField {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SIGNUP_FIELD_STEP, v);
}

export type SignupErrorTarget =
  | { kind: "none" }
  | { kind: "field"; field: SignupField; step: number; message: string }
  | { kind: "general"; message: string };

/** Sunucu yanıtını hedefe çevirir: alan hatası -> alan; diğer hata -> genel bant. */
export function signupErrorTarget(result: { error?: string; field?: string } | null | undefined): SignupErrorTarget {
  const message = result?.error?.trim();
  if (!message) return { kind: "none" };
  if (isSignupField(result?.field)) {
    return { kind: "field", field: result.field, step: SIGNUP_FIELD_STEP[result.field], message };
  }
  return { kind: "general", message };
}

/**
 * İstemci ön doğrulaması (gönderimden önce): kayıt telefonu ZORUNLU ve TR cep olmalı
 * (profiles.phone + SMS doğrulaması yalnız TR cep). Sunucu yine `parsePhoneStrict` ile doğrular.
 * Hafif `parsePhone` kullanır (istemci paketine libphonenumber girmez). Hata yoksa null.
 */
export function signupPhoneClientError(stored: string | null | undefined): string | null {
  const v = (stored ?? "").trim();
  if (!v) return "Cep telefonu numaranı yaz.";
  const p = parsePhone(v);
  if (!p.ok) return p.error ?? PHONE_ERROR_MESSAGE;
  if (p.country !== "TR" || p.kind !== "mobile") return TR_MOBILE_ERROR_MESSAGE;
  return null;
}
