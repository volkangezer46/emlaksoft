/**
 * Müşterinin EK iletişim bilgileri (CRM-G7) — SAF modül (istemci + sunucu).
 * Birincil telefon/e-posta `customers.phone/email`'de kalır; ek değerler `customer_contacts` tablosundadır
 * (20261020010000). Arama (`customers.contacts_fold`), mükerrer kontrolü, arayan tanıma ve birleştirme bu tabloyu okur.
 */

export type ContactKind = "phone" | "email";
export type ContactLabel = "cep" | "is" | "ev" | "whatsapp" | "diger";

export type CustomerContact = {
  id: string;
  kind: ContactKind;
  value: string;
  label: ContactLabel;
  created_at: string;
};

export const CONTACT_LABELS: Record<ContactLabel, string> = {
  cep: "Cep",
  is: "İş",
  ev: "Ev",
  whatsapp: "WhatsApp",
  diger: "Diğer",
};

/** Telefon etiket seçenekleri (formda sıra bu). E-posta için yalnız İş/Diğer anlamlı. */
export const PHONE_LABEL_OPTIONS: ContactLabel[] = ["cep", "is", "ev", "whatsapp", "diger"];
export const EMAIL_LABEL_OPTIONS: ContactLabel[] = ["is", "diger"];

/** Müşteri başına en fazla ek iletişim bilgisi (form ve action aynı sınırı uygular). */
export const MAX_EXTRA_CONTACTS = 10;

export function isContactLabel(v: unknown): v is ContactLabel {
  return typeof v === "string" && v in CONTACT_LABELS;
}

export function contactLabelText(label: string | null | undefined): string {
  return isContactLabel(label) ? CONTACT_LABELS[label] : "Diğer";
}

/** Satırları güvenle türetir (bilinmeyen tür/etiket atılır ya da "diğer"e düşer). */
export function contactsFromRows(rows: unknown): CustomerContact[] {
  if (!Array.isArray(rows)) return [];
  const out: CustomerContact[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r.id !== "string" || typeof r.value !== "string") continue;
    if (r.kind !== "phone" && r.kind !== "email") continue;
    out.push({
      id: r.id,
      kind: r.kind,
      value: r.value,
      label: isContactLabel(r.label) ? r.label : "diger",
      created_at: typeof r.created_at === "string" ? r.created_at : "",
    });
  }
  return out;
}

export type PhoneChoice = { value: string; label: string; primary: boolean; whatsapp: boolean };

/**
 * Ara / WhatsApp seçicisinin numara listesi: önce birincil, sonra ek numaralar (WhatsApp etiketli olan önde).
 * Aynı numara iki kez listelenmez.
 */
export function phoneChoices(primary: string | null | undefined, contacts: readonly CustomerContact[]): PhoneChoice[] {
  const out: PhoneChoice[] = [];
  const seen = new Set<string>();
  const key = (v: string) => v.replace(/\D/g, "");
  const p = (primary ?? "").trim();
  if (p) {
    out.push({ value: p, label: "Birincil", primary: true, whatsapp: false });
    seen.add(key(p));
  }
  const phones = contacts
    .filter((c) => c.kind === "phone")
    .sort((a, b) => Number(b.label === "whatsapp") - Number(a.label === "whatsapp"));
  for (const c of phones) {
    const k = key(c.value);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ value: c.value, label: CONTACT_LABELS[c.label], primary: false, whatsapp: c.label === "whatsapp" });
  }
  return out;
}

/** WhatsApp için varsayılan numara: "WhatsApp" etiketli ek numara varsa o, yoksa birincil. */
export function whatsappPhone(primary: string | null | undefined, contacts: readonly CustomerContact[]): string | null {
  const wa = contacts.find((c) => c.kind === "phone" && c.label === "whatsapp");
  return wa?.value ?? ((primary ?? "").trim() || null);
}

/** Tablo/kolon henüz yok (migration uygulanmadı) hatası mı? Kart "kurulum bekliyor" der, sayfa düşmez. */
export function isMissingRelationError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST205" ||
    error.code === "PGRST204" ||
    msg.includes("schema cache") ||
    (msg.includes("does not exist") && (msg.includes("relation") || msg.includes("column")))
  );
}
