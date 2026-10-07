import { isValidEmail, normalizeEmail } from "@/lib/email";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { ActionUserError } from "@/lib/action-errors";

export type CheckoutBuyerDraft = {
  id: string;
  fullName: string | null | undefined;
  email: string | null | undefined;
  phone: string | null | undefined;
  identityNumber: string | null | undefined;
  address: string | null | undefined;
  city: string | null | undefined;
  ip: string;
};

export type ValidatedCheckoutBuyer = {
  buyer: {
    id: string;
    name: string;
    surname: string;
    email: string;
    gsmNumber: string;
    identityNumber: string;
    registrationAddress: string;
    city: string;
    country: "Turkey";
    ip: string;
  };
  billingAddress: {
    contactName: string;
    city: string;
    country: "Turkey";
    address: string;
  };
};

function clean(value: string | null | undefined, maxLength: number) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

/** Turkish citizen identity checksum; 10-digit tax numbers are format checked. */
export function normalizeBuyerIdentityNumber(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").replace(/[\s.-]/g, "");
  if (!/^\d{10,11}$/.test(normalized) || /^(\d)\1+$/.test(normalized)) return null;

  if (normalized.length === 11) {
    if (normalized[0] === "0") return null;
    const digits = [...normalized].map(Number);
    const odd = digits[0]! + digits[2]! + digits[4]! + digits[6]! + digits[8]!;
    const even = digits[1]! + digits[3]! + digits[5]! + digits[7]!;
    const tenth = ((odd * 7 - even) % 10 + 10) % 10;
    const eleventh = digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10;
    if (digits[9] !== tenth || digits[10] !== eleventh) return null;
  }

  return normalized;
}

/**
 * Produces the exact buyer/address object sent to iyzico. No sample, fallback or
 * `.test` identity is ever synthesized at this boundary.
 */
export function validateCheckoutBuyer(input: CheckoutBuyerDraft): ValidatedCheckoutBuyer {
  const id = clean(input.id, 32);
  const fullName = clean(input.fullName, 120);
  const nameParts = fullName.split(" ").filter(Boolean);
  const email = normalizeEmail(clean(input.email, 254));
  const parsedPhone = parsePhoneStrict(input.phone);
  const gsmNumber = parsedPhone.ok ? parsedPhone.e164 : "";
  const identityNumber = normalizeBuyerIdentityNumber(input.identityNumber);
  const address = clean(input.address, 250);
  const city = clean(input.city, 80);

  if (!id) throw new ActionUserError("Ödeme sahibi kimliği bulunamadı.");
  if (nameParts.length < 2) throw new ActionUserError("Ödeme için ad ve soyad eksiksiz girilmelidir.");
  if (!isValidEmail(email)) throw new ActionUserError("Ödeme için geçerli bir e-posta adresi girilmelidir.");
  if (!gsmNumber) throw new ActionUserError("Ödeme için geçerli bir telefon numarası girilmelidir.");
  if (!identityNumber) throw new ActionUserError("Geçerli T.C. kimlik veya vergi numarası girilmelidir.");
  if (address.length < 10) throw new ActionUserError("Ödeme için açık adres en az 10 karakter olmalıdır.");
  if (city.length < 2) throw new ActionUserError("Ödeme için şehir bilgisi girilmelidir.");

  const name = nameParts[0]!;
  const surname = nameParts.slice(1).join(" ");
  return {
    buyer: {
      id,
      name,
      surname,
      email,
      gsmNumber,
      identityNumber,
      registrationAddress: address,
      city,
      country: "Turkey",
      ip: input.ip,
    },
    billingAddress: {
      contactName: fullName,
      city,
      country: "Turkey",
      address,
    },
  };
}
