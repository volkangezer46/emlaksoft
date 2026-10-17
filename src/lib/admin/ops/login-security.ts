/**
 * GİRİŞ GÜVENLİĞİ (saf, yan etkisiz). Kaynak `login_events` (her giriş denemesi; `src/app/giris/_lib/login-events.ts`):
 * `success` · `failed` (parola yanlış; kullanıcı çoğu zaman bilinmez, yalnız IP izi) · `2fa_pending` · `2fa_failed`.
 * Bu modül başarısız denemeleri IP ve hesap bazında toplar, kaba kuvvet / kimlik doldurma (credential stuffing) desenini
 * işaretler ve ekranda gösterilecek IP'yi KVKK gereği MASKELER (son blok gizli). Ham IP ekrana basılmaz.
 */

export type LoginResult = "success" | "failed" | "2fa_pending" | "2fa_failed";

export type LoginEventRow = {
  userId: string | null;
  tenantId: string | null;
  ip: string | null;
  result: LoginResult;
  createdAt: string;
};

/** Eşikler: pencere içi (varsayılan 7 gün) başarısız deneme. */
export const LOGIN_THRESHOLDS = {
  /** Tek IP'den bu kadar ve üstü başarısız deneme = kaba kuvvet şüphesi. */
  ipBrute: 20,
  /** Tek IP'den bu kadar farklı hesaba deneme = kimlik doldurma şüphesi. */
  ipDistinctUsers: 5,
  /** Tek hesaba bu kadar başarısız (parola + 2FA) deneme = hedeflenen hesap. */
  userTargeted: 5,
} as const;

export type IpFinding = {
  /** Maskeli gösterim (ör. "85.105.12.•" / "2a02:4780:•"). Ham değer modelden çıkmaz. */
  ipMasked: string;
  /** Aynı IP'yi gruplamak için kararlı anahtar (ham IP'nin kendisi değil). */
  key: string;
  failures: number;
  distinctUsers: number;
  distinctTenants: number;
  lastAt: string;
  kind: "kaba_kuvvet" | "kimlik_doldurma" | "izleniyor";
};

export type UserFinding = {
  userId: string;
  tenantId: string | null;
  failures: number;
  twoFactorFailures: number;
  distinctIps: number;
  lastAt: string;
  /** Pencerede başarılı giriş de var mı (deneme sonrası ele geçirme riski). */
  succeededAfter: boolean;
};

export type LoginSecuritySummary = {
  totals: Record<LoginResult, number>;
  /** Başarısız / (başarılı + başarısız) yüzde; veri yoksa null. */
  failureRate: number | null;
  ips: IpFinding[];
  users: UserFinding[];
  /** Gün → başarısız deneme (eski → yeni). */
  daily: { day: string; failures: number }[];
};

/** IP'yi KVKK uyumlu maskeler: IPv4 son okteti, IPv6 ilk iki blok dışı gizlenir. */
export function maskIp(ip: string | null | undefined): string {
  const s = (ip ?? "").trim();
  if (!s) return "Bilinmiyor";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return `${s.split(".").slice(0, 3).join(".")}.•`;
  if (s.includes(":")) {
    const parts = s.split(":").filter(Boolean);
    return `${parts.slice(0, 2).join(":")}:•`;
  }
  return "•••";
}

/** Kararlı ve geri döndürülemez kısa anahtar (FNV-1a); ham IP anahtarda da tutulmaz. */
export function ipKey(ip: string | null | undefined): string {
  const s = (ip ?? "").trim() || "-";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const isFailure = (r: LoginResult) => r === "failed" || r === "2fa_failed";

/** TR günü anahtarı (UTC+3; Türkiye yaz saati uygulamaz). */
export function trDay(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + 3 * 3_600_000).toISOString().slice(0, 10) : "";
}

export function summarizeLogins(
  events: readonly LoginEventRow[],
  successCount: number | null,
  opts: { days?: number; endDay?: string; limit?: number } = {},
): LoginSecuritySummary {
  const limit = opts.limit ?? 15;
  const totals: Record<LoginResult, number> = { success: 0, failed: 0, "2fa_pending": 0, "2fa_failed": 0 };
  const byIp = new Map<string, { ip: string | null; failures: number; users: Set<string>; tenants: Set<string>; lastAt: string }>();
  const byUser = new Map<string, { tenantId: string | null; failures: number; twoFa: number; ips: Set<string>; lastAt: string; lastFailAt: string }>();
  const successAt = new Map<string, string>();
  const perDay = new Map<string, number>();

  for (const e of events) {
    totals[e.result] += 1;
    if (e.result === "success" && e.userId) {
      const prev = successAt.get(e.userId);
      if (!prev || e.createdAt > prev) successAt.set(e.userId, e.createdAt);
    }
    if (!isFailure(e.result)) continue;
    const day = trDay(e.createdAt);
    if (day) perDay.set(day, (perDay.get(day) ?? 0) + 1);
    const k = ipKey(e.ip);
    const ipRow = byIp.get(k) ?? { ip: e.ip, failures: 0, users: new Set<string>(), tenants: new Set<string>(), lastAt: e.createdAt };
    ipRow.failures += 1;
    if (e.userId) ipRow.users.add(e.userId);
    if (e.tenantId) ipRow.tenants.add(e.tenantId);
    if (e.createdAt > ipRow.lastAt) ipRow.lastAt = e.createdAt;
    byIp.set(k, ipRow);
    if (e.userId) {
      const u = byUser.get(e.userId) ?? { tenantId: e.tenantId, failures: 0, twoFa: 0, ips: new Set<string>(), lastAt: e.createdAt, lastFailAt: e.createdAt };
      u.failures += 1;
      if (e.result === "2fa_failed") u.twoFa += 1;
      u.ips.add(k);
      if (e.createdAt > u.lastAt) u.lastAt = e.createdAt;
      if (e.createdAt > u.lastFailAt) u.lastFailAt = e.createdAt;
      if (!u.tenantId && e.tenantId) u.tenantId = e.tenantId;
      byUser.set(e.userId, u);
    }
  }
  // Başarı sayısı yalnız başarısız satırlar okunduysa ayrıca (HEAD sayımı) verilir.
  if (successCount !== null) totals.success = Math.max(totals.success, successCount);

  const ips: IpFinding[] = [...byIp.entries()]
    .map(([key, r]) => ({
      key,
      ipMasked: maskIp(r.ip),
      failures: r.failures,
      distinctUsers: r.users.size,
      distinctTenants: r.tenants.size,
      lastAt: r.lastAt,
      kind:
        r.users.size >= LOGIN_THRESHOLDS.ipDistinctUsers
          ? ("kimlik_doldurma" as const)
          : r.failures >= LOGIN_THRESHOLDS.ipBrute
            ? ("kaba_kuvvet" as const)
            : ("izleniyor" as const),
    }))
    .filter((r) => r.kind !== "izleniyor" || r.failures >= 5)
    .sort((a, b) => rankKind(a.kind) - rankKind(b.kind) || b.failures - a.failures)
    .slice(0, limit);

  const users: UserFinding[] = [...byUser.entries()]
    .filter(([, u]) => u.failures >= LOGIN_THRESHOLDS.userTargeted)
    .map(([userId, u]) => ({
      userId,
      tenantId: u.tenantId,
      failures: u.failures,
      twoFactorFailures: u.twoFa,
      distinctIps: u.ips.size,
      lastAt: u.lastAt,
      succeededAfter: (successAt.get(userId) ?? "") > u.lastFailAt,
    }))
    .sort((a, b) => Number(b.succeededAfter) - Number(a.succeededAfter) || b.failures - a.failures)
    .slice(0, limit);

  const fail = totals.failed + totals["2fa_failed"];
  const denom = totals.success + fail;
  const days = opts.days ?? 7;
  const end = opts.endDay ?? [...perDay.keys()].sort().at(-1) ?? null;
  const daily = end
    ? Array.from({ length: days }, (_, i) => {
        const t = Date.parse(`${end}T00:00:00Z`) - (days - 1 - i) * 86_400_000;
        const day = new Date(t).toISOString().slice(0, 10);
        return { day, failures: perDay.get(day) ?? 0 };
      })
    : [];
  return { totals, failureRate: denom > 0 ? Math.round((fail / denom) * 1000) / 10 : null, ips, users, daily };
}

function rankKind(k: IpFinding["kind"]): number {
  return k === "kimlik_doldurma" ? 0 : k === "kaba_kuvvet" ? 1 : 2;
}

export const IP_KIND_LABEL: Record<IpFinding["kind"], string> = {
  kimlik_doldurma: "Kimlik doldurma şüphesi",
  kaba_kuvvet: "Kaba kuvvet şüphesi",
  izleniyor: "İzleniyor",
};

export type TwoFactorRow = { tenantId: string; twoFactor: boolean };

export type TwoFactorAdoption = {
  users: number;
  enabled: number;
  percent: number | null;
  /** En az `minUsers` aktif kullanıcısı olup HİÇ kimsenin iki adımlı doğrulama açmadığı ofisler. */
  officesWithout: { tenantId: string; users: number }[];
};

/** Aktif ofis kullanıcılarında SMS iki adımlı doğrulama benimsemesi. */
export function twoFactorAdoption(rows: readonly TwoFactorRow[], minUsers = 3, limit = 12): TwoFactorAdoption {
  const by = new Map<string, { users: number; on: number }>();
  let enabled = 0;
  for (const r of rows) {
    const t = by.get(r.tenantId) ?? { users: 0, on: 0 };
    t.users += 1;
    if (r.twoFactor) {
      t.on += 1;
      enabled += 1;
    }
    by.set(r.tenantId, t);
  }
  const officesWithout = [...by.entries()]
    .filter(([, t]) => t.users >= minUsers && t.on === 0)
    .map(([tenantId, t]) => ({ tenantId, users: t.users }))
    .sort((a, b) => b.users - a.users)
    .slice(0, limit);
  return { users: rows.length, enabled, percent: rows.length ? Math.round((enabled / rows.length) * 1000) / 10 : null, officesWithout };
}
