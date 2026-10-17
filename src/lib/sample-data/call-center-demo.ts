import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS, trDayStartMs } from "@/lib/clock";

/**
 * DEMO OFİS — ÇAĞRI MERKEZİ GÜNÜ (F2). Genel demo ofisinde (slug demo-ofis) 22 aramanın hepsi Danışman'a atanmıştı ve en
 * yenisi 11 gün önceydi: "Çağrı merkezi" girişinde tüm KPI'lar 0, üç boş durum üst üste. Bu modül çağrı merkezi kişisine
 * SIFIRLAMA ANINA göre (bugün + dün) gelen / cevapsız / giden aramalar, bugün vadeli arama görevleri ve iki sıcak (ısı ≥ 70)
 * yeni müşteri yazar.
 *
 * İKİ çağıranı vardır: `scripts/seed-demo.ts` (tohum sonunda) ve `runDemoNightlyReset` (gece sıfırlamasından hemen sonra).
 * İDEMPOTENT: satır kimlikleri (kiracı + anahtar) deterministiktir; her çalıştırma önce aynı kimlikleri siler, sonra yeniden
 * yazar (gece sıfırlaması tabandan sonra eklenen müşteri/görevleri zaten siler; kimlikler çakışmaz). Yalnız demo-ofis'e
 * yazılır: çağıran slug'ı doğrular, burada ayrıca `tenants.slug` yeniden denetlenir. Gerçek kiracıya dokunulmaz.
 * Saf plan (`buildCallCenterDemoPlan`) DB'siz test edilir (rich-pack.test.ts).
 */

export const CALL_CENTER_DEMO_SLUG = "demo-ofis";

/** Kiracı + anahtardan deterministik UUID (v4 biçimli; md5 tabanlı). */
export function demoRowId(tenantId: string, key: string): string {
  const h = createHash("md5").update(`cagri-merkezi-demo:${tenantId}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

type Dict = Record<string, unknown>;

export type CallCenterDemoPlan = {
  customers: Dict[];
  demands: Dict[];
  feedback: Dict[];
  calls: Dict[];
  tasks: Dict[];
};

/**
 * Saf plan. `existingCustomerIds`: aramalara bağlanacak mevcut (tohum) müşteriler (en çok 3); `likedPropertyIds`: yeni
 * müşterilerin beğendiği yayındaki portföyler (en çok 2; ısı skorunda "Portal beğenisi"). Damgalar `nowMs`'e göre: bugünküler
 * günün başından önceye düşmez ve gelecekte değildir; dünküler mesai saatindedir. Görevler bugün vadeli.
 */
export function buildCallCenterDemoPlan(input: {
  tenantId: string;
  callCenterId: string;
  nowMs: number;
  existingCustomerIds: readonly string[];
  likedPropertyIds: readonly string[];
}): CallCenterDemoPlan {
  const { tenantId, callCenterId: cc, nowMs } = input;
  const id = (k: string) => demoRowId(tenantId, k);
  const dayStart = trDayStartMs(nowMs);
  const yStart = dayStart - DAY_MS;
  const today = (minutesAgo: number) => new Date(Math.min(nowMs - 60_000, Math.max(dayStart + 60_000, nowMs - minutesAgo * 60_000))).toISOString();
  const yesterday = (h: number, m: number) => new Date(yStart + (h * 60 + m) * 60_000).toISOString();
  const todayAt = (h: number, m: number) => new Date(dayStart + (h * 60 + m) * 60_000).toISOString();

  const fresh = [
    { key: "musteri-1", full_name: "Seda Karakaya", phone: "05323990101", source: "web_form", note: "Web formundan geldi; Kadıköy'de 3+1 satılık arıyor." },
    { key: "musteri-2", full_name: "Kaan Bilgin", phone: "05323990102", source: "telefon", note: "Gelen aramada kayıt açıldı; Ataşehir'de kiralık 2+1 bakıyor." },
  ];
  const createdAt = today(150);
  const customers = fresh.map((c) => ({
    id: id(c.key),
    tenant_id: tenantId,
    full_name: c.full_name,
    phone: c.phone,
    customer_types: ["Alıcı"],
    tags: [],
    source: c.source,
    lead_source: c.source,
    notes: c.note,
    assigned_to: cc,
    created_by: cc,
    created_at: createdAt,
    updated_at: createdAt,
  }));
  const demands = fresh.flatMap((c, i) => [
    { id: id(`${c.key}-talep-1`), tenant_id: tenantId, customer_id: id(c.key), transaction_type: i === 0 ? "Satılık" : "Kiralık", urgency: "yüksek", status: "new", criteria: {}, created_at: createdAt },
    { id: id(`${c.key}-talep-2`), tenant_id: tenantId, customer_id: id(c.key), transaction_type: i === 0 ? "Satılık" : "Kiralık", urgency: "orta", status: "active", criteria: {}, created_at: createdAt },
  ]);
  const feedback = fresh.flatMap((c) =>
    input.likedPropertyIds.slice(0, 2).map((pid, j) => ({
      id: id(`${c.key}-begeni-${j}`),
      tenant_id: tenantId,
      customer_id: id(c.key),
      property_id: pid,
      verdict: "liked",
      created_at: createdAt,
      updated_at: createdAt,
    })),
  );

  const ex = input.existingCustomerIds.slice(0, 3);
  const call = (key: string, direction: "inbound" | "outbound" | "missed", startedAt: string, customerId: string | null, phone: string, duration: number, disposition: string | null) => ({
    id: id(key),
    tenant_id: tenantId,
    customer_id: customerId,
    direction,
    phone,
    duration_sec: direction === "missed" ? 0 : duration,
    disposition: direction === "missed" ? null : disposition,
    handled_by: cc,
    started_at: startedAt,
    ended_at: direction === "missed" ? null : new Date(Date.parse(startedAt) + duration * 1000).toISOString(),
  });
  const calls = [
    call("arama-bugun-1", "inbound", today(15), id("musteri-1"), "05323990101", 210, "Bilgi verildi"),
    call("arama-bugun-2", "inbound", today(40), id("musteri-2"), "05323990102", 260, "Randevu alındı"),
    call("arama-bugun-3", "missed", today(55), ex[0] ?? null, "05323990103", 0, null),
    call("arama-bugun-4", "missed", today(70), null, "02164440101", 0, null),
    call("arama-bugun-5", "outbound", today(90), ex[1] ?? null, "05323990104", 130, "Geri aranacak"),
    call("arama-bugun-6", "inbound", today(110), ex[2] ?? null, "05323990105", 180, "Bilgi verildi"),
    call("arama-dun-1", "inbound", yesterday(10, 20), ex[0] ?? null, "05323990103", 240, "Bilgi verildi"),
    call("arama-dun-2", "missed", yesterday(13, 5), ex[1] ?? null, "05323990104", 0, null),
    call("arama-dun-3", "outbound", yesterday(16, 40), id("musteri-1"), "05323990101", 150, "Teklif iletildi"),
  ];
  const tasks = [
    { key: "gorev-1", title: "Seda Karakaya'yı geri ara: Kadıköy 3+1 seçenekleri", hour: 11, minute: 0, customer: id("musteri-1"), priority: "high" },
    { key: "gorev-2", title: "Cevapsız aramaya dönüş yap", hour: 14, minute: 0, customer: ex[0] ?? null, priority: "high" },
    { key: "gorev-3", title: "Kaan Bilgin'e kiralık 2+1 listesini gönder", hour: 16, minute: 30, customer: id("musteri-2"), priority: "normal" },
  ].map((t) => ({
    id: id(t.key),
    tenant_id: tenantId,
    title: t.title,
    kind: "call",
    priority: t.priority,
    status: "open",
    due_at: todayAt(t.hour, t.minute),
    assigned_to: cc,
    customer_id: t.customer,
    created_by: cc,
    created_at: createdAt,
  }));
  return { customers, demands, feedback, calls, tasks };
}

export type CallCenterDemoResult = { skipped?: string; written?: Record<string, number>; error?: string };

/** Planı demo-ofis'e yazar (önce aynı kimlikleri siler). `db` service_role istemcisidir (çağırandan gelir). */
export async function refreshCallCenterDemo(db: SupabaseClient, tenantId: string, nowMs: number): Promise<CallCenterDemoResult> {
  const tenant = await db.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
  if (tenant.error) return { error: `tenant: ${tenant.error.code ?? tenant.error.message}` };
  if ((tenant.data as { slug?: string } | null)?.slug !== CALL_CENTER_DEMO_SLUG) return { skipped: "not_demo_tenant" };
  const [cc, cust, props] = await Promise.all([
    db.from("profiles").select("id").eq("tenant_id", tenantId).eq("role", "call_center").eq("is_active", true).order("created_at", { ascending: true }).limit(1),
    db.from("customers").select("id").eq("tenant_id", tenantId).is("deleted_at", null).not("phone", "is", null).order("created_at", { ascending: true }).limit(3),
    db.from("properties").select("id").eq("tenant_id", tenantId).is("deleted_at", null).eq("status", "live").order("created_at", { ascending: true }).limit(2),
  ]);
  const ccId = (cc.data as { id: string }[] | null)?.[0]?.id;
  if (cc.error || !ccId) return { skipped: "no_call_center_profile" };
  const plan = buildCallCenterDemoPlan({
    tenantId,
    callCenterId: ccId,
    nowMs,
    existingCustomerIds: ((cust.data ?? []) as { id: string }[]).map((r) => r.id),
    likedPropertyIds: ((props.data ?? []) as { id: string }[]).map((r) => r.id),
  });
  const ids = (rows: Dict[]) => rows.map((r) => String(r.id));
  // Silme: önce çocuklar (arama NO ACTION FK), sonra müşteri. Ekleme: önce müşteri.
  for (const [table, rows] of [["calls", plan.calls], ["tasks", plan.tasks], ["portal_match_feedback", plan.feedback], ["customer_demands", plan.demands], ["customers", plan.customers]] as const) {
    if (rows.length === 0) continue;
    const del = await db.from(table).delete().eq("tenant_id", tenantId).in("id", ids(rows));
    if (del.error) return { error: `${table} silme: ${del.error.code ?? del.error.message}` };
  }
  const written: Record<string, number> = {};
  for (const [table, rows] of [["customers", plan.customers], ["customer_demands", plan.demands], ["portal_match_feedback", plan.feedback], ["calls", plan.calls], ["tasks", plan.tasks]] as const) {
    if (rows.length === 0) continue;
    const ins = await db.from(table).insert(rows as Dict[]);
    if (ins.error) return { error: `${table} ekleme: ${ins.error.code ?? ins.error.message}`, written };
    written[table] = rows.length;
  }
  return { written };
}
