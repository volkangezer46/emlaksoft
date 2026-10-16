import { createClient } from "@/lib/supabase/server";
import { DAY_MS, TR_OFFSET_MS, now, trParts } from "@/lib/clock";
import type { AppModule } from "@/lib/permissions";

/**
 * Yan menü SAYI ROZETLERİ (kurumsal referans v3): İlanlar (canlı portal ilanı), Müşteriler, Randevular (bugün), Görevler
 * (bana atanmış açık), Teklifler (yanıt bekleyen) ve "Sahibinden Takibi" eşitleme noktası. Yalnız `head` sayımları
 * (satır taşınmaz), RLS'li istemciyle; kabuk modelini BEKLETMEZ: layout sözü (promise) başlatır, yan menü satırı
 * rozeti kendi Suspense sınırında `use()` ile okur (ilk HTML ve TTFB etkilenmez). Süreç içi 60 sn önbellek (ofis +
 * kullanıcı anahtarlı): menüden gezinmede layout yeniden çizilse bile sorgu tekrarlanmaz. Hata → o rozet yok (sahte
 * sıfır yok).
 */
export type NavCounts = {
  /** Sayfa yolu → sayı (yalnız > 0 olanlar). */
  counts: Record<string, number>;
  /** Sayfa yolu → durum noktası (ör. sahibinden eşitlemesi taze: "ok", 3 günden eski: "warn"). */
  dots: Record<string, "ok" | "warn">;
};

const EMPTY: NavCounts = { counts: {}, dots: {} };
const TTL_MS = 60_000;
const MAX_ENTRIES = 500;
const memo = new Map<string, { at: number; value: Promise<NavCounts> }>();

type Input = { tenantId: string | null; userId: string | null; accessible: readonly AppModule[]; mine: boolean };

export function loadNavCounts(input: Input): Promise<NavCounts> {
  if (!input.tenantId || !input.userId) return Promise.resolve(EMPTY);
  const key = `${input.tenantId}:${input.userId}:${input.mine ? "ben" : "ofis"}:${[...input.accessible].sort().join(",")}`;
  const t = now();
  const hit = memo.get(key);
  if (hit && t - hit.at < TTL_MS) return hit.value;
  const value = compute(input).catch(() => EMPTY);
  if (memo.size >= MAX_ENTRIES) memo.delete(memo.keys().next().value as string);
  memo.set(key, { at: t, value });
  return value;
}

/** Türkiye gününün başlangıcı / sonu (ISO). */
function trDayBounds(nowMs: number): [string, string] {
  const p = trParts(nowMs);
  const start = Date.UTC(p.year, p.month, p.day) - TR_OFFSET_MS;
  return [new Date(start).toISOString(), new Date(start + DAY_MS).toISOString()];
}

async function compute({ tenantId, userId, accessible, mine }: Input): Promise<NavCounts> {
  const supabase = await createClient();
  const has = (m: AppModule) => accessible.includes(m);
  const [dayStart, dayEnd] = trDayBounds(now());
  type Q = PromiseLike<{ count: number | null; error: unknown }>;
  const jobs: [string, Q][] = [];
  if (has("portals")) jobs.push(["/app/ilan-kontrol", supabase.from("portal_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId!).eq("status", "live")]);
  if (has("customers")) {
    let q = supabase.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId!).is("deleted_at", null);
    if (mine) q = q.eq("assigned_to", userId!);
    jobs.push(["/app/musteriler", q]);
  }
  if (has("appointments")) {
    let q = supabase.from("appointments").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId!).gte("scheduled_at", dayStart).lt("scheduled_at", dayEnd).neq("status", "cancelled");
    if (mine) q = q.eq("assigned_to", userId!);
    jobs.push(["/app/randevular", q]);
  }
  if (has("tasks")) jobs.push(["/app/gorevler", supabase.from("tasks").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId!).eq("status", "open").eq("assigned_to", userId!)]);
  if (has("offers")) jobs.push(["/app/teklifler", supabase.from("offers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId!).in("status", ["submitted", "countered"])]);
  const fsboP = has("prospecting")
    ? supabase.from("fsbo_leads").select("first_seen_at").eq("tenant_id", tenantId!).order("first_seen_at", { ascending: false }).limit(1).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const [results, fsbo] = await Promise.all([Promise.all(jobs.map(([, q]) => q)), fsboP]);
  const counts: Record<string, number> = {};
  results.forEach((r, i) => {
    if (!r.error && typeof r.count === "number" && r.count > 0) counts[jobs[i]![0]] = r.count;
  });
  const dots: Record<string, "ok" | "warn"> = {};
  const seen = (fsbo.data as { first_seen_at?: string | null } | null)?.first_seen_at;
  if (!fsbo.error && seen) dots["/app/portfoy-avi"] = now() - Date.parse(seen) <= 3 * DAY_MS ? "ok" : "warn";
  return { counts, dots };
}
