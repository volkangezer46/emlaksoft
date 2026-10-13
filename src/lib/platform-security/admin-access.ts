/**
 * AD11 Yönetim paneli erişim politikası (SAF çekirdek + proxy okuyucusu):
 *  - IP izin listesi (`platform.admin_ip_allowlist`): boş = kısıt yok. IPv4/IPv6 tekil adres veya CIDR; satır ya da
 *    virgülle ayrılır, `#` sonrası açıklamadır. Listede olmayan IP /admin ve /api/admin'de 403 alır.
 *  - Boşta kalma zaman aşımı (`platform.session_idle_minutes`): imzalı `es_admin_seen` çerezi son etkinliği taşır;
 *    süre aşılırsa oturum kapatılır (/giris/oturum-sonu). Oturum ömrü (`platform.session_max_hours`) sunucu kapısında
 *    (`src/lib/platform.ts`) JWT `amr` zamanından denetlenir.
 * ACİL KURTARMA (süper admin kendini kilitlerse): `.env.production` içinde `ADMIN_IP_ALLOWLIST=off` + yeniden yayın,
 * ya da sunucuda `delete from platform_settings where key='platform.admin_ip_allowlist';` (≤30 sn içinde etkin).
 */

export const ADMIN_IP_ALLOWLIST_KEY = "platform.admin_ip_allowlist";
export const SESSION_IDLE_MINUTES_KEY = "platform.session_idle_minutes";
export const SESSION_MAX_HOURS_KEY = "platform.session_max_hours";
export const DEFAULT_IDLE_MINUTES = 60;
export const DEFAULT_MAX_HOURS = 12;
export const IDLE_COOKIE = "es_admin_seen";
/** Etkinlik çerezi en fazla bu sıklıkta yenilenir (her istekte Set-Cookie yazmamak için). */
export const IDLE_REFRESH_SEC = 60;
export const MAX_ALLOWLIST_ENTRIES = 100;

// ---------------------------------------------------------------- IP ayrıştırma

type ParsedIp = { v: 4 | 6; n: bigint };

function parseV4(s: string): bigint | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = BigInt(0);
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const x = Number(p);
    if (x > 255) return null;
    n = (n << BigInt(8)) | BigInt(x);
  }
  return n;
}

function parseV6(s: string): bigint | null {
  let str = s.toLowerCase();
  const zone = str.indexOf("%");
  if (zone >= 0) str = str.slice(0, zone);
  // Gömülü IPv4 (::ffff:1.2.3.4)
  let tailV4: bigint | null = null;
  const lastColon = str.lastIndexOf(":");
  if (str.includes(".") && lastColon >= 0) {
    tailV4 = parseV4(str.slice(lastColon + 1));
    if (tailV4 === null) return null;
    str = `${str.slice(0, lastColon + 1)}0:0`;
  }
  const dbl = str.split("::");
  if (dbl.length > 2) return null;
  const head = dbl[0] ? dbl[0].split(":") : [];
  const tail = dbl.length === 2 && dbl[1] ? dbl[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (dbl.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(dbl.length === 2 ? missing : 0).fill("0"), ...tail];
  let n = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  if (tailV4 !== null) n = (n & ~BigInt(0xffffffff)) | tailV4;
  return n;
}

export function parseIp(raw: string | null | undefined): ParsedIp | null {
  const s = (raw ?? "").trim().replace(/^\[|\]$/g, "");
  if (!s) return null;
  if (s.includes(":")) {
    const n = parseV6(s);
    if (n === null) return null;
    // IPv4 eşlemeli IPv6 (::ffff:a.b.c.d) IPv4 kuralıyla karşılaştırılır.
    if (n >> BigInt(32) === BigInt(0xffff)) return { v: 4, n: n & BigInt(0xffffffff) };
    return { v: 6, n };
  }
  const n = parseV4(s);
  return n === null ? null : { v: 4, n };
}

export type AllowRule = { v: 4 | 6; net: bigint; bits: number; text: string };

/** Tek satır kural (ör. `203.0.113.7`, `10.0.0.0/8`, `2001:db8::/32`); geçersizse null. */
export function parseRule(raw: string): AllowRule | null {
  const text = raw.trim();
  if (!text) return null;
  const [addr, prefix, extra] = text.split("/");
  if (extra !== undefined) return null;
  const ip = parseIp(addr);
  if (!ip) return null;
  const max = ip.v === 4 ? 32 : 128;
  let bits = max;
  if (prefix !== undefined) {
    if (!/^\d{1,3}$/.test(prefix)) return null;
    bits = Number(prefix);
    if (bits < 0 || bits > max) return null;
  }
  const shift = BigInt(max - bits);
  const net = bits === 0 ? BigInt(0) : (ip.n >> shift) << shift;
  return { v: ip.v, net, bits, text };
}

export type AllowlistParse = { rules: AllowRule[]; invalid: string[] };

/** Ham ayar metnini kurallara ayırır (`#` sonrası yorum; boş satır atlanır). */
export function parseAllowlist(raw: string | null | undefined): AllowlistParse {
  const rules: AllowRule[] = [];
  const invalid: string[] = [];
  for (const line of (raw ?? "").split(/\n/)) {
    const body = line.split("#")[0];
    for (const tok of body.split(/[,\s]+/)) {
      if (!tok.trim()) continue;
      const r = parseRule(tok);
      if (r) rules.push(r);
      else invalid.push(tok.trim().slice(0, 60));
    }
  }
  return { rules, invalid };
}

/** Ayar kaydı doğrulaması (kayıt defteri crossRule): hata metni ya da null. */
export function validateAllowlist(raw: string): string | null {
  const { rules, invalid } = parseAllowlist(raw);
  if (invalid.length) return `Geçersiz IP/CIDR: ${invalid.slice(0, 3).join(", ")}`;
  if (rules.length > MAX_ALLOWLIST_ENTRIES) return `En çok ${MAX_ALLOWLIST_ENTRIES} kural girilebilir.`;
  return null;
}

export function ipMatches(rules: readonly AllowRule[], ipRaw: string | null | undefined): boolean {
  const ip = parseIp(ipRaw);
  if (!ip) return false;
  const max = ip.v === 4 ? 32 : 128;
  return rules.some((r) => {
    if (r.v !== ip.v) return false;
    if (r.bits === 0) return true;
    const shift = BigInt(max - r.bits);
    return (ip.n >> shift) << shift === r.net;
  });
}

export type AdminAccessPolicy = {
  /** Geçerli kurallar; boş = kısıt yok. */
  rules: AllowRule[];
  idleMinutes: number;
  /** Oturum ömrü (saat); 0 = sınırsız. */
  maxHours: number;
};

/**
 * IP izni. Kural yoksa ya da acil kapatma (`ADMIN_IP_ALLOWLIST=off`) varsa serbest. Liste dolu ama hiçbiri geçerli
 * değilse (bozuk kayıt) kilitlememek için serbest bırakılır; kayıt ekranı geçersiz değeri zaten reddeder.
 */
export function adminIpAllowed(policy: Pick<AdminAccessPolicy, "rules">, ip: string | null, envOverride?: string): boolean {
  if ((envOverride ?? "").trim().toLowerCase() === "off") return true;
  if (policy.rules.length === 0) return true;
  return ipMatches(policy.rules, ip);
}

export function parseMinutes(raw: string | null | undefined, def: number, min: number, max: number): number {
  const v = (raw ?? "").trim();
  if (!/^\d{1,5}$/.test(v)) return def;
  const n = Number(v);
  return n >= min && n <= max ? n : def;
}

export function isAdminPolicyPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/") || path === "/api/admin" || path.startsWith("/api/admin/");
}

// ---------------------------------------------------------------- Etkinlik çerezi (HMAC)

const enc = new TextEncoder();

function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(`${secret}:admin-idle-v1`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

export async function signIdleCookie(userId: string, lastSec: number, secret: string): Promise<string> {
  const payload = `v1.${userId}.${Math.floor(lastSec)}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

/** Geçerli ve bu kullanıcıya aitse son etkinlik (sn); aksi halde null. Sabit zamanlı karşılaştırma. */
export async function verifyIdleCookie(value: string | undefined, userId: string, secret: string): Promise<number | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1" || parts[1] !== userId || !/^\d{1,12}$/.test(parts[2])) return null;
  const expected = await hmac(secret, `${parts[0]}.${parts[1]}.${parts[2]}`);
  const got = parts[3];
  if (got.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? Number(parts[2]) : null;
}

export type IdleDecision = { kind: "expired" } | { kind: "refresh" } | { kind: "keep" };

/** Saf karar: süre aşıldı mı, çerez yenilenmeli mi. `idleMinutes` 0 = kapalı. */
export function decideIdle(lastSec: number | null, nowSec: number, idleMinutes: number, passive: boolean): IdleDecision {
  if (lastSec !== null && idleMinutes > 0 && nowSec - lastSec > idleMinutes * 60) return { kind: "expired" };
  if (passive && lastSec !== null) return { kind: "keep" };
  if (lastSec === null || nowSec - lastSec >= IDLE_REFRESH_SEC) return { kind: "refresh" };
  return { kind: "keep" };
}

/** JWT `amr` zamanlarından oturum başlangıcı (sn); okunamazsa null. */
export function sessionStartSec(claims: Record<string, unknown> | null | undefined): number | null {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return null;
  let min: number | null = null;
  for (const e of amr) {
    const t = e && typeof e === "object" ? Number((e as { timestamp?: unknown }).timestamp) : NaN;
    if (Number.isFinite(t) && t > 0) min = min === null ? t : Math.min(min, t);
  }
  return min;
}

export function sessionExpired(startSec: number | null, nowSec: number, maxHours: number): boolean {
  return startSec !== null && maxHours > 0 && nowSec - startSec > maxHours * 3600;
}
