/**
 * OFİS OTURUMLARI (SAF; DB yok, istemci güvenli). Güvenlik & veri > Ofis oturumları ekranının görünüm modeli.
 * Kaynak `platform_list_office_sessions` RPC'si (20261025010000): IP veritabanında maskelenir, user agent kırpılmış
 * gelir; belirteç/refresh token/HMAC anahtarı RPC'den hiç dönmez. Bu dosya yalnız özet ve gruplama yapar.
 */

export type OfficeSessionRow = {
  sessionId: string;
  userId: string;
  name: string;
  role: string;
  tenantId: string;
  tenantName: string;
  createdAt: string;
  lastActiveAt: string | null;
  aal: string | null;
  ipMasked: string | null;
  userAgent: string | null;
  expiresAt: string | null;
};

type RawRow = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** RPC satırı → görünüm satırı (bilinmeyen alanlar atılır; tam IP ya da belirteç alanı OLUŞMAZ). */
export function toOfficeSessionRow(r: RawRow): OfficeSessionRow | null {
  const sessionId = str(r.session_id);
  const userId = str(r.user_id);
  const tenantId = str(r.tenant_id);
  if (!sessionId || !userId || !tenantId) return null;
  return {
    sessionId,
    userId,
    name: str(r.full_name) ?? "Kullanıcı",
    role: str(r.role) ?? "",
    tenantId,
    tenantName: str(r.tenant_name) ?? "Ofis",
    createdAt: str(r.created_at) ?? "",
    lastActiveAt: str(r.last_active_at),
    aal: str(r.aal),
    ipMasked: str(r.ip_masked),
    userAgent: str(r.user_agent),
    expiresAt: str(r.expires_at),
  };
}

/** User agent → "Chrome · Windows" / "Safari · iPhone" / "Uygulama" (sürüm numarası ve ayrıntı yok). */
export function summarizeUserAgent(ua: string | null | undefined): string {
  const s = String(ua ?? "").slice(0, 300);
  if (!s) return "Bilinmeyen cihaz";
  const os = /iPhone/i.test(s)
    ? "iPhone"
    : /iPad/i.test(s)
      ? "iPad"
      : /Android/i.test(s)
        ? "Android"
        : /Windows/i.test(s)
          ? "Windows"
          : /Mac OS X|Macintosh/i.test(s)
            ? "macOS"
            : /CrOS/i.test(s)
              ? "ChromeOS"
              : /Linux/i.test(s)
                ? "Linux"
                : null;
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /OPR\/|Opera/.test(s)
      ? "Opera"
      : /SamsungBrowser/.test(s)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS/.test(s)
          ? "Firefox"
          : /Chrome\/|CriOS/.test(s)
            ? "Chrome"
            : /Safari\//.test(s)
              ? "Safari"
              : /node|undici|axios|curl|okhttp|Dart|supabase/i.test(s)
                ? "Uygulama / API"
                : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os ?? "Diğer istemci";
}

export type OfficeSessionUser = {
  userId: string;
  name: string;
  role: string;
  sessions: OfficeSessionRow[];
  lastActiveAt: string | null;
};

export type OfficeSessionGroup = {
  tenantId: string;
  tenantName: string;
  users: OfficeSessionUser[];
  sessionCount: number;
  lastActiveAt: string | null;
};

export type OfficeSessionsSummary = {
  sessions: number;
  users: number;
  offices: number;
  /** İki adımlı doğrulamayla (AAL2) açılmış oturum. */
  aal2: number;
  /** MULTI_DEVICE_MIN ve üstü açık oturumu olan kullanıcı. */
  multiDeviceUsers: number;
  /** Son 24 saatte etkin oturum. */
  active24h: number;
};

export const MULTI_DEVICE_MIN = 3;

const later = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : a > b ? a : b);

/** Ofis → kullanıcı → oturum gruplaması; ofisler oturum sayısına, kullanıcılar son etkinliğe göre sıralı. */
export function groupOfficeSessions(rows: readonly OfficeSessionRow[]): OfficeSessionGroup[] {
  const offices = new Map<string, OfficeSessionGroup>();
  const users = new Map<string, OfficeSessionUser>();
  for (const r of rows) {
    let g = offices.get(r.tenantId);
    if (!g) {
      g = { tenantId: r.tenantId, tenantName: r.tenantName, users: [], sessionCount: 0, lastActiveAt: null };
      offices.set(r.tenantId, g);
    }
    g.sessionCount += 1;
    g.lastActiveAt = later(g.lastActiveAt, r.lastActiveAt);
    const key = `${r.tenantId}:${r.userId}`;
    let u = users.get(key);
    if (!u) {
      u = { userId: r.userId, name: r.name, role: r.role, sessions: [], lastActiveAt: null };
      users.set(key, u);
      g.users.push(u);
    }
    u.sessions.push(r);
    u.lastActiveAt = later(u.lastActiveAt, r.lastActiveAt);
  }
  const byLast = (a: { lastActiveAt: string | null }, b: { lastActiveAt: string | null }) => (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "");
  const out = [...offices.values()];
  for (const g of out) {
    g.users.sort(byLast);
    for (const u of g.users) u.sessions.sort(byLast);
  }
  return out.sort((a, b) => b.sessionCount - a.sessionCount || a.tenantName.localeCompare(b.tenantName, "tr"));
}

export function summarizeOfficeSessions(rows: readonly OfficeSessionRow[], nowMs: number): OfficeSessionsSummary {
  const perUser = new Map<string, number>();
  let aal2 = 0;
  let active24h = 0;
  const dayAgo = nowMs - 86_400_000;
  for (const r of rows) {
    perUser.set(r.userId, (perUser.get(r.userId) ?? 0) + 1);
    if (r.aal === "aal2") aal2 += 1;
    if (r.lastActiveAt && new Date(r.lastActiveAt).getTime() >= dayAgo) active24h += 1;
  }
  return {
    sessions: rows.length,
    users: perUser.size,
    offices: new Set(rows.map((r) => r.tenantId)).size,
    aal2,
    multiDeviceUsers: [...perUser.values()].filter((n) => n >= MULTI_DEVICE_MIN).length,
    active24h,
  };
}

export const SESSION_REASON_MIN = 10;
export const SESSION_REASON_MAX = 300;
