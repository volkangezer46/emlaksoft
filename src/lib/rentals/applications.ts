/**
 * Kiracı başvurusu (SP5) — SAF model: durum etiketleri, geçişler, evrak türleri, form alanı ayrıştırma,
 * kira/gelir oranı ve yan yana karşılaştırma satırları. Sunucu ve istemci güvenle import eder (telefon doğrulaması
 * sunucuda `parsePhoneStrict` ile yapılır; burada yok).
 */
import { parseMoneyInput } from "@/lib/money-input";
import { isIsoDate, type RentalApplicationStatus, RENTAL_APPLICATION_STATUSES } from "@/lib/workflow-state";

export const APPLICATION_STATUS_LABELS: Record<RentalApplicationStatus, string> = {
  new: "Yeni",
  shortlisted: "Kısa liste",
  owner_review: "Malik onayında",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  withdrawn: "Geri çekildi",
};

export type StatusTone = "info" | "warning" | "success" | "outline" | "danger";
export const APPLICATION_STATUS_TONES: Record<RentalApplicationStatus, StatusTone> = {
  new: "info",
  shortlisted: "warning",
  owner_review: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "outline",
};

export function isApplicationStatus(v: unknown): v is RentalApplicationStatus {
  return typeof v === "string" && (RENTAL_APPLICATION_STATUSES as readonly string[]).includes(v);
}

/**
 * Ofis kullanıcısının yapabileceği geçişler. Malik kararı (owner_review → approved/rejected) malik portalından da
 * gelir; ofis malik adına da karar verebilir (telefonla onay). Onaylanan ve geri çekilen başvuru kapanmıştır.
 */
const OFFICE_TRANSITIONS: Record<RentalApplicationStatus, readonly RentalApplicationStatus[]> = {
  new: ["shortlisted", "owner_review", "approved", "rejected"],
  shortlisted: ["new", "owner_review", "approved", "rejected"],
  owner_review: ["shortlisted", "approved", "rejected"],
  approved: [],
  rejected: ["new", "shortlisted"],
  withdrawn: [],
};

export function canTransitionApplication(from: RentalApplicationStatus, to: RentalApplicationStatus): boolean {
  return OFFICE_TRANSITIONS[from].includes(to);
}

export function nextApplicationStatuses(from: RentalApplicationStatus): readonly RentalApplicationStatus[] {
  return OFFICE_TRANSITIONS[from];
}

/** Evrak türleri (SQL CHECK ile aynı). */
export const APPLICATION_DOC_TYPES = ["kimlik", "gelir", "calisma", "kefil_kimlik", "kefil_gelir", "diger"] as const;
export type ApplicationDocType = (typeof APPLICATION_DOC_TYPES)[number];
export const APPLICATION_DOC_LABELS: Record<ApplicationDocType, string> = {
  kimlik: "Kimlik (ön yüz)",
  gelir: "Gelir belgesi (bordro / SGK dökümü)",
  calisma: "Çalışma belgesi",
  kefil_kimlik: "Kefil kimliği",
  kefil_gelir: "Kefil gelir belgesi",
  diger: "Diğer belge",
};
export const APPLICATION_DOC_HINTS: Partial<Record<ApplicationDocType, string>> = {
  kimlik: "TC kimlik numaranızın görünmesi yeterli; arka yüz gerekmez.",
  gelir: "Son ay maaş bordrosu, e-Devlet SGK hizmet dökümü veya vergi levhası.",
};
export function isApplicationDocType(v: unknown): v is ApplicationDocType {
  return typeof v === "string" && (APPLICATION_DOC_TYPES as readonly string[]).includes(v);
}

/** Başvuru başına en çok dosya (SQL CHECK file_count ≤ 30 ile uyumlu, pratik sınır). */
export const APPLICATION_MAX_FILES = 12;
/** Gönderimden sonra evrak yükleme anahtarının ömrü. */
export const APPLICATION_UPLOAD_KEY_TTL_MS = 2 * 60 * 60 * 1000;
/** Yeni bağlantının varsayılan ömrü (gün). */
export const APPLICATION_LINK_TTL_DAYS = 60;

export const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
export function applicationLinkPath(token: string): string {
  return `/kiraci-basvuru/${token}`;
}

const clean = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const cleanBlock = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").replace(/\r\n/g, "\n").trim();
  return s ? s.slice(0, max) : null;
};

export type ApplicationFormValues = {
  fullName: string;
  phoneRaw: string;
  email: string | null;
  occupation: string | null;
  employer: string | null;
  monthlyIncome: number | null;
  householdSize: number | null;
  hasPets: boolean;
  petsNote: string | null;
  smoker: boolean;
  moveInDate: string | null;
  message: string | null;
  guarantorName: string | null;
  guarantorPhoneRaw: string | null;
  guarantorRelation: string | null;
  guarantorOccupation: string | null;
  guarantorIncome: number | null;
  guarantorAddress: string | null;
};

type Getter = { get(name: string): FormDataEntryValue | null };

/**
 * Public formun metin/sayı alanlarını ayrıştırır (telefonlar ham döner; sunucu `parsePhoneStrict` ile doğrular).
 * `today` (YYYY-MM-DD) taşınma tarihinin geçmişte olmamasını denetler.
 */
export function parseApplicationForm(fd: Getter, today: string): { ok: true; value: ApplicationFormValues } | { ok: false; error: string } {
  const fullName = clean(fd.get("full_name"), 160) ?? "";
  if (fullName.length < 2) return { ok: false, error: "Adınızı ve soyadınızı yazın." };
  const phoneRaw = String(fd.get("phone") ?? "").trim();
  if (!phoneRaw) return { ok: false, error: "Cep telefonunuzu yazın." };
  const email = clean(fd.get("email"), 254);

  const income = parseMoneyInput(fd.get("monthly_income"), { max: 99_999_999 });
  if (!income.ok) return { ok: false, error: "Aylık net geliri yalnız rakamla yazın (örn. 45.000)." };
  const gIncome = parseMoneyInput(fd.get("guarantor_income"), { max: 99_999_999 });
  if (!gIncome.ok) return { ok: false, error: "Kefil gelirini yalnız rakamla yazın (örn. 60.000)." };

  const hhRaw = String(fd.get("household_size") ?? "").trim();
  let householdSize: number | null = null;
  if (hhRaw) {
    const n = Number(hhRaw);
    if (!Number.isInteger(n) || n < 1 || n > 20) return { ok: false, error: "Hanede yaşayacak kişi sayısı 1 ile 20 arasında olmalı." };
    householdSize = n;
  }

  const moveIn = String(fd.get("move_in_date") ?? "").trim();
  if (moveIn && (!isIsoDate(moveIn) || moveIn < today)) return { ok: false, error: "Taşınma tarihi bugün ya da ileri bir tarih olmalı." };

  const hasPets = String(fd.get("has_pets") ?? "") === "on" || String(fd.get("has_pets") ?? "") === "evet";
  const guarantorName = clean(fd.get("guarantor_name"), 160);
  const guarantorPhoneRaw = String(fd.get("guarantor_phone") ?? "").trim() || null;
  if (guarantorPhoneRaw && !guarantorName) return { ok: false, error: "Kefil telefonunu yazdıysanız kefilin adını da yazın." };

  return {
    ok: true,
    value: {
      fullName,
      phoneRaw,
      email,
      occupation: clean(fd.get("occupation"), 120),
      employer: clean(fd.get("employer"), 160),
      monthlyIncome: income.value,
      householdSize,
      hasPets,
      petsNote: hasPets ? clean(fd.get("pets_note"), 200) : null,
      smoker: String(fd.get("smoker") ?? "") === "on" || String(fd.get("smoker") ?? "") === "evet",
      moveInDate: moveIn || null,
      message: cleanBlock(fd.get("message"), 1000),
      guarantorName,
      guarantorPhoneRaw,
      guarantorRelation: guarantorName ? clean(fd.get("guarantor_relation"), 80) : null,
      guarantorOccupation: guarantorName ? clean(fd.get("guarantor_occupation"), 120) : null,
      guarantorIncome: guarantorName ? gIncome.value : null,
      guarantorAddress: guarantorName ? cleanBlock(fd.get("guarantor_address"), 500) : null,
    },
  };
}

/** Kira / gelir oranı (0..∞). Gelir ya da kira yoksa null. */
export function rentToIncomeRatio(monthlyRent: number | null | undefined, monthlyIncome: number | null | undefined): number | null {
  const rent = Number(monthlyRent);
  const income = Number(monthlyIncome);
  if (!Number.isFinite(rent) || !Number.isFinite(income) || rent <= 0 || income <= 0) return null;
  return rent / income;
}

/**
 * Ödeme gücü yorumu. Türkiye'de yaygın kural: kira net gelirin üçte birini aşmamalı.
 * ≤ %33 rahat, ≤ %45 sınırda, üstü riskli. Kefil geliri ayrıca gösterilir (toplanmaz).
 */
export type Affordability = "comfortable" | "borderline" | "risky" | "unknown";
export function affordability(ratio: number | null): Affordability {
  if (ratio == null) return "unknown";
  if (ratio <= 1 / 3 + 1e-9) return "comfortable";
  if (ratio <= 0.45) return "borderline";
  return "risky";
}
export const AFFORDABILITY_LABELS: Record<Affordability, string> = {
  comfortable: "Rahat",
  borderline: "Sınırda",
  risky: "Riskli",
  unknown: "Gelir yok",
};

export function ratioLabel(ratio: number | null): string {
  if (ratio == null) return "—";
  return `%${Math.round(ratio * 100)}`;
}

export type ComparableApplication = {
  id: string;
  full_name: string;
  occupation: string | null;
  employer: string | null;
  monthly_income: number | null;
  household_size: number | null;
  has_pets: boolean;
  smoker: boolean;
  move_in_date: string | null;
  guarantor_name: string | null;
  guarantor_income: number | null;
  file_count: number;
  status: RentalApplicationStatus;
  created_at: string;
  /** Adayın başvurduğu ilanın aylık kirası (bağlantı kirası ya da ilan fiyatı); yoksa genel kira kullanılır. */
  monthly_rent?: number | null;
};

export type ComparisonCell = { text: string; best?: boolean; tone?: "good" | "warn" | "bad" };
export type ComparisonRow = { label: string; cells: ComparisonCell[] };

const tl = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
const dateTr = (iso: string | null) => {
  if (!iso) return "Belirtilmedi";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "Belirtilmedi";
};

/**
 * Yan yana karşılaştırma satırları. "En iyi" işareti yalnız ölçülebilir satırlarda (gelir, kira/gelir, kefil geliri,
 * evrak) ve en az iki adayda veri varken verilir — veri yoksa işaret yok (sahte skor yok).
 */
export function buildComparison(apps: readonly ComparableApplication[], monthlyRent: number | null): ComparisonRow[] {
  const markBest = (values: (number | null)[], higherIsBetter: boolean): boolean[] => {
    const nums = values.filter((v): v is number => v != null);
    if (nums.length < 2) return values.map(() => false);
    const target = higherIsBetter ? Math.max(...nums) : Math.min(...nums);
    if (nums.every((n) => n === target)) return values.map(() => false);
    return values.map((v) => v != null && v === target);
  };
  const ratios = apps.map((a) => rentToIncomeRatio(a.monthly_rent ?? monthlyRent, a.monthly_income));
  const incomes = apps.map((a) => a.monthly_income);
  const gIncomes = apps.map((a) => (a.guarantor_name ? a.guarantor_income : null));
  const files = apps.map((a) => a.file_count);
  const bestIncome = markBest(incomes, true);
  const bestRatio = markBest(ratios, false);
  const bestG = markBest(gIncomes, true);
  const bestFiles = markBest(files, true);
  const toneOf = (r: number | null): ComparisonCell["tone"] => {
    const a = affordability(r);
    return a === "comfortable" ? "good" : a === "borderline" ? "warn" : a === "risky" ? "bad" : undefined;
  };
  return [
    { label: "Meslek", cells: apps.map((a) => ({ text: [a.occupation, a.employer].filter(Boolean).join(" · ") || "Belirtilmedi" })) },
    { label: "Aylık net gelir", cells: apps.map((a, i) => ({ text: tl(a.monthly_income), best: bestIncome[i] })) },
    {
      label: "Kira / gelir",
      cells: apps.map((_, i) => ({ text: ratios[i] == null ? "—" : `${ratioLabel(ratios[i])} · ${AFFORDABILITY_LABELS[affordability(ratios[i])]}`, best: bestRatio[i], tone: toneOf(ratios[i]) })),
    },
    { label: "Hane", cells: apps.map((a) => ({ text: a.household_size ? `${a.household_size} kişi` : "Belirtilmedi" })) },
    { label: "Evcil hayvan", cells: apps.map((a) => ({ text: a.has_pets ? "Var" : "Yok" })) },
    { label: "Sigara", cells: apps.map((a) => ({ text: a.smoker ? "İçiyor" : "İçmiyor" })) },
    { label: "Taşınma", cells: apps.map((a) => ({ text: dateTr(a.move_in_date) })) },
    { label: "Kefil", cells: apps.map((a) => ({ text: a.guarantor_name ? a.guarantor_name : "Kefil yok", tone: a.guarantor_name ? undefined : "warn" })) },
    { label: "Kefil geliri", cells: apps.map((a, i) => ({ text: a.guarantor_name ? tl(a.guarantor_income) : "—", best: bestG[i] })) },
    { label: "Evrak", cells: apps.map((a, i) => ({ text: a.file_count > 0 ? `${a.file_count} dosya` : "Yüklenmedi", best: bestFiles[i], tone: a.file_count > 0 ? undefined : "warn" })) },
  ];
}

/** Karşılaştırma seçimi: 2-4 benzersiz UUID (URL `?ids=a,b,c`). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COMPARE_MAX = 4;
export function parseCompareIds(raw: string | string[] | undefined): string[] {
  const s = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  const out: string[] = [];
  for (const part of s.split(",")) {
    const id = part.trim().toLowerCase();
    if (UUID_RE.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= COMPARE_MAX) break;
  }
  return out;
}
