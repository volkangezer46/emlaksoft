import { resolveSupabaseAdminKey } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { OFFICE_SECURITY_PREFIX, policyFromSettingRows, type OfficeSecurityPolicy } from "./policy";

/**
 * Proxy için ofis güvenlik politikası okuyucusu (DG7). `admin-access-cache.ts` deseni, tek farkla: ofis başına değil
 * TÜM ofislerin `office.security.*` satırları tek anlık görüntüde okunur (örnek başına 30 sn bellek önbelleği).
 * Varsayılana dönen ayar satırı silindiği için (write_setting null = delete) görüntüde yalnız politika belirlemiş
 * ofisler bulunur; politika yoksa proxy ek iş yapmaz (otuz saniyede bir, yalnız /app isteğinde tek okuma).
 * Okuma hatasında SON BAŞARILI görüntü kullanılır (IP kısıtı bir DB kesintisinde kendiliğinden açılmaz); hiç başarılı
 * okuma yoksa kısıtsız (panel zaten DB'siz çalışmaz). Eşzamanlı istekler tek okumayı paylaşır.
 */
const OK_TTL_MS = 30_000;
const FAIL_TTL_MS = 10_000;
const FETCH_TIMEOUT_MS = 1_500;
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

type Snapshot = Map<string, OfficeSecurityPolicy>;

let memo: { at: number; ttl: number; value: Snapshot } | null = null;
let lastGood: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;

export function resetOfficeSecurityCache() {
  memo = null;
}

/** Ham satırlar (tenant_id, key, value) → ofis başına politika. */
export function snapshotFromRows(rows: unknown): Snapshot {
  const byTenant = new Map<string, { key: string; value: unknown }[]>();
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      const { tenant_id: tenantId, key, value } = r as { tenant_id?: unknown; key?: unknown; value?: unknown };
      if (typeof tenantId !== "string" || typeof key !== "string" || !key.startsWith(OFFICE_SECURITY_PREFIX)) continue;
      const list = byTenant.get(tenantId) ?? [];
      list.push({ key, value });
      byTenant.set(tenantId, list);
    }
  }
  const out: Snapshot = new Map();
  for (const [tenantId, list] of byTenant) out.set(tenantId, policyFromSettingRows(list));
  return out;
}

type Deps = { nowMs?: number; fetchImpl?: typeof fetch; url?: string; key?: string };

async function load(url: string, key: string, fetchImpl: typeof fetch): Promise<Snapshot> {
  const rows: unknown[] = [];
  const base = `${url.replace(/\/$/, "")}/rest/v1/tenant_settings?select=tenant_id,key,value&key=like.${OFFICE_SECURITY_PREFIX}*&order=tenant_id.asc,key.asc`;
  for (let page = 0; page < MAX_PAGES; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${base}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`tenant_settings ${res.status}`);
      const batch = (await res.json()) as unknown;
      if (!Array.isArray(batch)) throw new Error("tenant_settings bozuk yanıt");
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) return snapshotFromRows(rows);
    } finally {
      clearTimeout(timer);
    }
  }
  // Sayfa sınırı aşıldı: eksik görüntü kısıtları sessizce düşürebilir → hata say (son başarılı görüntü kullanılır).
  throw new Error("tenant_settings sayfa sınırı");
}

export async function readOfficeSecuritySnapshot(deps: Deps = {}): Promise<Snapshot> {
  const nowMs = deps.nowMs ?? now();
  if (memo && nowMs - memo.at < memo.ttl) return memo.value;
  const url = deps.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = deps.key ?? resolveSupabaseAdminKey();
  const fallback = lastGood ?? new Map();
  if (!url || !key) {
    memo = { at: nowMs, ttl: FAIL_TTL_MS, value: fallback };
    return fallback;
  }
  if (!inflight) {
    inflight = load(url, key, deps.fetchImpl ?? fetch)
      .then((value) => {
        lastGood = value;
        memo = { at: nowMs, ttl: OK_TTL_MS, value };
        return value;
      })
      .catch(() => {
        memo = { at: nowMs, ttl: FAIL_TTL_MS, value: fallback };
        return fallback;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Ofisin politikası; belirlenmemişse null (proxy hiçbir dala girmez). */
export async function readOfficeSecurityPolicyCached(tenantId: string, deps: Deps = {}): Promise<OfficeSecurityPolicy | null> {
  if (!tenantId) return null;
  return (await readOfficeSecuritySnapshot(deps)).get(tenantId) ?? null;
}
