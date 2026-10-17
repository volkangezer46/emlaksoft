import { createClient } from "@/lib/supabase/server";
import { DAY_MS, TR_OFFSET_MS, now, trParts } from "@/lib/clock";
import type { AppModule } from "@/lib/permissions";
import type { NavCounts } from "@/lib/app-shell/nav-count-meta";
import { getRequestSampleScope } from "@/lib/cache/request";
import { officeOverdueTasksCountQuery } from "@/lib/nav-badges";

/**
 * Yan menü AKIŞLI SAYAÇLARI — sayaç kuralı (sahip kararı 2026-10-16): KIRMIZI = gecikmiş, TURUNCU = karar bekliyor,
 * GRİ = bilgi; bir satırın sayacı yalnız o satırın adının söylediği şeyi sayar (Teklifler onay saymaz, Müşteriler toplam
 * kayıt göstermez). Bu dosya kabuğu bekletmeyen sayımlardır; geciken görev ve bekleyen onay ise kabuk RPC'sinden (nav-badges)
 * gelir.
 *
 *  - `alerts` (kırmızı): geciken kira tahsilatı (Mülk yönetimi; yalnız ofis görünümü) ve `officeTasks` ise ofis geneli
 *    geciken görev (ana ekran Dikkat listesinin ofis kalemiyle aynı küme + örnek veri kapsamı; kişisel rozet o zaman düşer,
 *    bkz. `navBadgesForHomeScope`). Ana Sayfa acil sayacı = kırmızı rozetler + bu sayaçlar = Dikkat'in acil kalemleri.
 *  - `counts` (gri): bugünkü randevu (Ajanda; danışmanda kendi randevusu), atanmayı bekleyen ilan (İlanlar & Portal ›
 *    Portföy dağıtımı; yalnız ofis görünümü).
 *  - `dots`: Sahibinden takibi eşitleme noktası (son yeni ilan 3 günden eskiyse uyarı).
 *
 * Yalnız `head` sayımları (satır taşınmaz), RLS'li istemciyle; layout sözü (promise) başlatır, satır kendi Suspense
 * sınırında `use()` ile okur (ilk HTML ve TTFB etkilenmez). Süreç içi 60 sn önbellek (ofis + kullanıcı anahtarlı). Hata →
 * o sayaç yok (sahte sıfır yok).
 */
export type { NavCounts } from "@/lib/app-shell/nav-count-meta";

const EMPTY: NavCounts = { counts: {}, alerts: {}, dots: {} };
const TTL_MS = 60_000;
const MAX_ENTRIES = 500;
const memo = new Map<string, { at: number; value: Promise<NavCounts> }>();

type Input = {
  tenantId: string | null;
  userId: string | null;
  accessible: readonly AppModule[];
  mine: boolean;
  /** Ana Sayfa kapsamı "Ofis geneli" (`homeUrgentScope`): geciken görev ofis geneli sayılır. */
  officeTasks?: boolean;
};

export function loadNavCounts(input: Input): Promise<NavCounts> {
  if (!input.tenantId || !input.userId) return Promise.resolve(EMPTY);
  const key = `${input.tenantId}:${input.userId}:${input.mine ? "ben" : "ofis"}:${input.officeTasks ? "g-ofis" : "g-ben"}:${[...input.accessible].sort().join(",")}`;
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

type Q = PromiseLike<{ count: number | null; error: unknown }>;

async function compute({ tenantId, userId, accessible, mine, officeTasks }: Input): Promise<NavCounts> {
  const supabase = await createClient();
  const has = (m: AppModule) => accessible.includes(m);
  const [dayStart, dayEnd] = trDayBounds(now());
  const info: [string, Q][] = [];
  const late: [string, Q][] = [];
  if (has("appointments")) {
    let q = supabase.from("appointments").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId!).gte("scheduled_at", dayStart).lt("scheduled_at", dayEnd).neq("status", "cancelled");
    if (mine) q = q.eq("assigned_to", userId!);
    info.push(["/app/randevular", q]);
  }
  if (!mine && has("properties")) {
    info.push(["/app/ilan-havuzu", supabase.from("listing_pool_entries").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId!).eq("status", "pending")]);
  }
  if (officeTasks && has("tasks")) {
    // Örnek veri kapsamı ana ekranla aynı karar (istek içi önbellekli); diğer sayımları bekletmez.
    late.push(["/app/gorevler", getRequestSampleScope(tenantId).then((sample) => sample.apply(officeOverdueTasksCountQuery(supabase, tenantId!, dayStart)))]);
  }
  if (!mine && has("rentals")) {
    late.push(["/app/kiralama", supabase.from("rent_charges").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId!).eq("status", "overdue")]);
  }
  const fsboP = has("prospecting")
    ? supabase.from("fsbo_leads").select("first_seen_at").eq("tenant_id", tenantId!).order("first_seen_at", { ascending: false }).limit(1).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const [infoRes, lateRes, fsbo] = await Promise.all([Promise.all(info.map(([, q]) => q)), Promise.all(late.map(([, q]) => q)), fsboP]);
  const collect = (jobs: [string, Q][], results: Awaited<Q>[]) => {
    const out: Record<string, number> = {};
    results.forEach((r, i) => {
      if (!r.error && typeof r.count === "number" && r.count > 0) out[jobs[i]![0]] = r.count;
    });
    return out;
  };
  const dots: Record<string, "ok" | "warn"> = {};
  const seen = (fsbo.data as { first_seen_at?: string | null } | null)?.first_seen_at;
  if (!fsbo.error && seen) dots["/app/portfoy-avi"] = now() - Date.parse(seen) <= 3 * DAY_MS ? "ok" : "warn";
  return { counts: collect(info, infoRes), alerts: collect(late, lateRes), dots };
}
