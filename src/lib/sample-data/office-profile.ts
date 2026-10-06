import type { SamplePack } from "@/lib/sample-data-seed";

/**
 * Kurulum sihirbazı (/kayit) ofis profili — SAF (istemci ve sunucu import eder, sunucu modülü yok).
 *
 * Sihirbazın "Ofis", "Marka", "Odak" ve "Ekip" adımlarındaki seçimlerin TEK tanımı ve sunucu ayrıştırıcıları.
 * Form alan adları (`FIELD`) hem istemci formunda hem `signUp` içinde buradan okunur; ikisi ayrı yazılmaz.
 */

export const FIELD = {
  provinceId: "province_id",
  districtId: "district_id",
  officeType: "office_type",
  brandColor: "brand_color",
  logo: "logo",
  focus: "focus",
  workDistricts: "work_district_ids",
  inviteEmails: "invite_emails",
} as const;

export type OfficeType = "bagimsiz" | "franchise" | "kurumsal";
export const OFFICE_TYPES: readonly { key: OfficeType; label: string; description: string }[] = [
  { key: "bagimsiz", label: "Bağımsız ofis", description: "Kendi markanızla çalışan tek ofis." },
  { key: "franchise", label: "Franchise", description: "Bir markanın bayisi; marka kuralları ve raporlama var." },
  { key: "kurumsal", label: "Kurumsal / çok şubeli", description: "Birden fazla şube ya da ekip; merkezden yönetim." },
];

export function parseOfficeType(v: unknown): OfficeType | null {
  const s = String(v ?? "").trim();
  return OFFICE_TYPES.some((t) => t.key === s) ? (s as OfficeType) : null;
}

export type FocusSegment = "satilik" | "kiralik" | "ticari" | "arsa";
export const FOCUS_SEGMENTS: readonly { key: FocusSegment; label: string; description: string }[] = [
  { key: "satilik", label: "Satılık konut", description: "Daire, villa, müstakil." },
  { key: "kiralik", label: "Kiralık konut", description: "Kira sözleşmesi ve tahakkuk takibi." },
  { key: "ticari", label: "Ticari / iş yeri", description: "Dükkan, ofis, depo, plaza." },
  { key: "arsa", label: "Arsa / tarla", description: "İmar, parsel ve yatırım arazisi." },
];

/** Çoklu seçim: geçersizler atılır, sıra sabit (FOCUS_SEGMENTS sırası), tekrar yok. */
export function parseFocusSegments(values: readonly unknown[]): FocusSegment[] {
  const set = new Set(values.map((v) => String(v ?? "").trim()));
  return FOCUS_SEGMENTS.map((f) => f.key).filter((k) => set.has(k));
}

/**
 * Odak → örnek veri paketi ve ofis tipi tanım şablonu (ikisi aynı anahtarı kullanır: `sample_pack`).
 * Konut (satılık/kiralık) öncelikli; yalnız ticari seçildiyse ticari, yalnız arsa seçildiyse arsa.
 */
export function packForFocus(focus: readonly FocusSegment[]): SamplePack {
  if (focus.includes("satilik") || focus.includes("kiralik")) return "konut";
  if (focus.includes("ticari")) return "ticari";
  if (focus.includes("arsa")) return "arsa";
  return "konut";
}

/** Marka rengi ön ayarları: her biri `--brand-600` dolgusu olarak beyaz yazıyla >= 4.5:1 kontrast verir (tokens.css paleti). */
export const BRAND_COLOR_PRESETS: readonly { hex: string; label: string }[] = [
  { hex: "#1d5fd6", label: "Okyanus" },
  { hex: "#0f7b6c", label: "Zümrüt" },
  { hex: "#4f46e5", label: "İndigo" },
  { hex: "#9a6700", label: "Kehribar" },
  { hex: "#be185d", label: "Gül" },
  { hex: "#374151", label: "Grafit" },
];

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Geçerli 6 haneli hex (küçük harfe çevrilir); boş/geçersiz → null (renk yazılmaz). */
export function parseBrandColor(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return HEX6.test(s) ? s.toLowerCase() : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MAX_WORK_DISTRICTS = 30;

/** Çalışılan ilçeler: yalnız UUID, tekrarsız, en çok 30. */
export function parseWorkDistrictIds(values: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const s = String(v ?? "").trim().toLowerCase();
    if (UUID_RE.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= MAX_WORK_DISTRICTS) break;
  }
  return out;
}

export function parseUuid(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  return UUID_RE.test(s) ? s : null;
}

export const MAX_INVITES = 3;

/**
 * Ekip daveti e-postaları: kırpılmış küçük harf, basit biçim denetimi, kurucunun kendi e-postası ve tekrarlar atılır,
 * en çok 3. (Kesin doğrulama sunucuda `isValidEmail` ile ayrıca yapılır.)
 */
export function parseInviteEmails(values: readonly unknown[], ownerEmail: string): string[] {
  const own = ownerEmail.trim().toLowerCase();
  const out: string[] = [];
  for (const v of values) {
    const s = String(v ?? "").trim().toLowerCase();
    if (!s || s === own || out.includes(s)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) continue;
    out.push(s);
    if (out.length >= MAX_INVITES) break;
  }
  return out;
}

export type WizardOfficeProfile = {
  provinceId: string | null;
  districtId: string | null;
  officeType: OfficeType | null;
  brandColor: string | null;
  focus: FocusSegment[];
  workDistrictIds: string[];
  inviteEmails: string[];
  pack: SamplePack;
};

/** FormData → doğrulanmış profil. Hiçbir alan zorunlu değildir; eksik alan null/boş kalır (kayıt akışını kesmez). */
export function readWizardOfficeProfile(formData: FormData, ownerEmail: string): WizardOfficeProfile {
  const focus = parseFocusSegments(formData.getAll(FIELD.focus));
  return {
    provinceId: parseUuid(formData.get(FIELD.provinceId)),
    districtId: parseUuid(formData.get(FIELD.districtId)),
    officeType: parseOfficeType(formData.get(FIELD.officeType)),
    brandColor: parseBrandColor(formData.get(FIELD.brandColor)),
    focus,
    workDistrictIds: parseWorkDistrictIds(formData.getAll(FIELD.workDistricts)),
    inviteEmails: parseInviteEmails(formData.getAll(FIELD.inviteEmails), ownerEmail),
    pack: packForFocus(focus),
  };
}
