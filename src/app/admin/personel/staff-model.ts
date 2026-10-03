import {
  PLATFORM_ROLE_LABELS,
  PLATFORM_ROLE_TAGLINES,
  platformModulesFor,
  type PlatformModule,
  type PlatformRole,
} from "@/lib/platform-access";

/** Platform modüllerinin Türkçe adları (rol yetki özeti için). */
export const PLATFORM_MODULE_LABELS: Record<PlatformModule, string> = {
  dashboard: "Genel bakış",
  sales: "Satış adayları",
  tenants: "Ofisler",
  members: "Kullanıcılar",
  billing: "Faturalama",
  tickets: "Destek talepleri",
  reports: "Raporlar",
  advisor: "AI danışman",
  activity: "Aktivite kaydı",
  geo: "Coğrafya",
  sistem: "Sistem",
  broadcast: "Duyurular",
  personel: "Personel yönetimi",
};

export const PLATFORM_ROLES: PlatformRole[] = ["super_admin", "ops", "support", "billing"];

export type RoleSummary = {
  role: PlatformRole;
  label: string;
  tagline: string;
  allowed: string[];
  denied: string[];
};

/** Bir rolün erişebildiği / erişemediği ekranlar (PLATFORM_ROLE_MODULES'tan; uydurma yok). */
export function roleSummary(role: PlatformRole): RoleSummary {
  const mods = platformModulesFor(role);
  const all = Object.keys(PLATFORM_MODULE_LABELS) as PlatformModule[];
  return {
    role,
    label: PLATFORM_ROLE_LABELS[role],
    tagline: PLATFORM_ROLE_TAGLINES[role],
    allowed: all.filter((m) => mods.includes(m)).map((m) => PLATFORM_MODULE_LABELS[m]),
    denied: all.filter((m) => !mods.includes(m)).map((m) => PLATFORM_MODULE_LABELS[m]),
  };
}

const LOWER = "abcdefghijkmnopqrstuvwxyz"; // l yok
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // I, O yok
const DIGITS = "23456789"; // 0, 1 yok
const SYMBOLS = "!@#$%*-_+?";

/**
 * Okunaklı geçici parola üretir. `randomInt(max)` enjekte edilir (istemcide crypto,
 * testte deterministik). Her sınıftan en az bir karakter garanti edilir.
 */
export function generatePassword(randomInt: (max: number) => number, length = 14): string {
  const n = Math.max(length, 10);
  const pick = (set: string) => set[randomInt(set.length)];
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < n) chars.push(pick(all));
  // Fisher-Yates
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export type PasswordStrength = {
  /** 0 (boş) .. 4 (çok güçlü) */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  tone: "neutral" | "danger" | "warn" | "success";
  checks: { id: string; label: string; ok: boolean }[];
  /** Sunucunun kabul ettiği asgari (>= 10 karakter). */
  acceptable: boolean;
};

export function passwordStrength(pw: string): PasswordStrength {
  const checks = [
    { id: "len", label: "En az 10 karakter", ok: pw.length >= 10 },
    { id: "case", label: "Büyük ve küçük harf", ok: /[a-zçğıöşü]/.test(pw) && /[A-ZÇĞİÖŞÜ]/.test(pw) },
    { id: "digit", label: "Rakam", ok: /\d/.test(pw) },
    { id: "sym", label: "Sembol", ok: /[^\p{L}\d]/u.test(pw) },
  ];
  if (!pw) {
    return { score: 0, label: "Girilmedi", tone: "neutral", checks, acceptable: false };
  }
  const passed = checks.filter((c) => c.ok).length;
  const longBonus = pw.length >= 14 ? 1 : 0;
  const raw = pw.length < 10 ? Math.min(passed, 1) : passed + longBonus - 1;
  const score = Math.max(1, Math.min(4, raw)) as 1 | 2 | 3 | 4;
  const label = ["", "Zayıf", "Orta", "Güçlü", "Çok güçlü"][score];
  const tone = score <= 1 ? "danger" : score === 2 ? "warn" : "success";
  return { score, label, tone, checks, acceptable: pw.length >= 10 };
}

/** Ay/gün farkı yerine "Hiç giriş yapmadı" / ISO için ortak metin (saf). */
export function lastLoginText(iso: string | null | undefined, format: (iso: string) => string): string {
  return iso ? format(iso) : "Hiç giriş yapmadı";
}

export type StaffKpi = {
  total: number;
  active: number;
  passive: number;
  neverLoggedIn: number;
  /** Son 30 günde giriş yapan aktif personel. */
  recentLogin: number;
};

type KpiRow = { is_active: boolean; last_sign_in_at?: string | null };

/** KPI şeridi sayıları gerçek satırlardan; `since` ISO eşiği (clock.daysAgoIso) dışarıdan gelir. */
export function staffKpi(rows: KpiRow[], since: string): StaffKpi {
  const active = rows.filter((r) => r.is_active);
  return {
    total: rows.length,
    active: active.length,
    passive: rows.length - active.length,
    neverLoggedIn: active.filter((r) => !r.last_sign_in_at).length,
    recentLogin: active.filter((r) => r.last_sign_in_at && r.last_sign_in_at >= since).length,
  };
}
