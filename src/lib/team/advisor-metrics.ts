/**
 * Danışman metrikleri — TEK VERİ KAYNAĞI.
 *
 * Danışman KPI, Ekip Ligi (karne sayıları), Kıyas, Kazanç, Hedefler, Danışman 360 / Performansım
 * ve Ofis Panosu (TV) aynı sayıyı AYNI yerden okur; sayfalar kendi sorgusunu yazmaz.
 *
 * TANIMLAR (belge MODUL_ENVANTERI_360 çakışma #5/#8, sahip kararı):
 *  - GELİR = DANIŞMANIN KOMİSYON PAYI (advisor-share.ts), TAHSİL EDİLMİŞ (paid/collected), komisyon
 *    kaydının oluştuğu döneme göre. Bekleyen (tahsil edilmemiş) pay ayrı alandır (`pendingRevenue`).
 *  - Ofis geneli toplam ayrıca "Ofis komisyonu (brüt)" etiketiyle verilir (`office.commissionGrossCollected`);
 *    danışman gelirlerinin toplamı DEĞİLDİR (ofis payı ve dış paylar dahildir).
 *  - Anlaşma = kabul edilen teklif (offers.created_by, dönemde oluşan); Dönüşüm = anlaşma / teklif.
 *  - Randevu = dönemde planlanan, iptal edilmemiş. Çağrı = handled_by. Müşteri = atanmış, silinmemiş
 *    (toplam; dönemden bağımsız). Yeni müşteri = dönemde açılan.
 *  - Ay/gün sınırları Türkiye takvimine göre ([başlangıç, bitiş) kapalı-açık aralık).
 *
 * NEDEN `advisor_kpis` RPC'si KULLANILMIYOR: RPC yalnız `p_month_start` alır ve açık uçludur (`>=`;
 * geçmiş ay için sonraki ayları da sayar), randevuda iptalleri de sayar (360 sayfası saymaz) ve `revenue`
 * kolonu BRÜT komisyondur (danışman payı değil). Migration yazmak bu görevin kapsamı dışında olduğundan
 * aynı toplamlar burada kodda, kapalı aralıkla ve pay tanımıyla hesaplanır. RPC'ye dokunulmadı; başka
 * çağıranı kalmadıysa Faz 2'de kaldırılabilir.
 *
 * KAZANÇ GİZLİLİĞİ (`earnings_all`): yetkisiz rolde başkasının komisyon satırı sunucudan HİÇ çekilmez
 * (yalnız kendi anlaşmasının satırları ve kendi `profile_id` payı olan satırlar); başkasının geliri `null`
 * döner. Ofis komisyonu (brüt) yalnız `earnings_all` ile hesaplanır.
 * KAPSAM: ofis geneli rol (`hasOfficeWideDataScope`) tüm ekibi, diğerleri yalnız kendini görür.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { TR_OFFSET_MS, trParts } from "@/lib/clock";
import { loadSampleKpiScope, type SampleKpiScope } from "@/lib/sample-scope";
import type { EffectivePermissions } from "@/lib/permissions-effective";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { OPEN_DEMAND_STATUSES, untrackedCustomerIds } from "@/lib/team/advisor-360";
import {
  findAmbiguousNames,
  isPaid,
  summarizeAdvisorEarning,
  type ShareOptions,
  type ShareRow,
} from "@/lib/team/advisor-share";
import { conversionPct, targetProgressPct } from "@/lib/team/scorecard";
import { computeTargetActuals, targetPeriodRange, type TargetLike } from "@/lib/team/target-actuals";

export const METRIC_ROLES = ["owner", "gm", "branch_manager", "team_lead", "advisor"] as const;
export const LIVE_PROPERTY_STATUSES = ["live", "Yayında"];

const PROFILE_LIMIT = 200;
const SCAN_LIMIT = 10_000;
const COMMISSION_LIMIT = 5_000;
const HEAD_COUNT_MAX_ADVISORS = 80;

/* -------------------------------------------------------------------------- */
/* Dönem yardımcıları (TR takvimi)                                             */
/* -------------------------------------------------------------------------- */

export type MetricsPeriod = {
  /** Dahil. */
  startIso: string;
  /** Hariç. */
  endIso: string;
  /** Hedefler için ay anahtarı "YYYY-MM-01" (dönem başlangıcının TR tarihi). */
  startDateKey: string;
};

/** Türkiye takvimine göre ay (month0: 0 tabanlı; taşmalar Date.UTC ile normalize edilir). */
export function trMonthPeriod(year: number, month0: number): MetricsPeriod {
  const start = Date.UTC(year, month0, 1) - TR_OFFSET_MS;
  const end = Date.UTC(year, month0 + 1, 1) - TR_OFFSET_MS;
  const p = trParts(start);
  return {
    startIso: new Date(start).toISOString(),
    endIso: new Date(end).toISOString(),
    startDateKey: `${p.year}-${String(p.month + 1).padStart(2, "0")}-01`,
  };
}

/** `nowMs`'in içinde bulunduğu TR ayı (offset: -1 önceki ay). */
export function currentMonthPeriod(nowMs: number, offset = 0): MetricsPeriod {
  const p = trParts(nowMs);
  return trMonthPeriod(p.year, p.month + offset);
}

/** TR takvim yılı [1 Ocak, ertesi 1 Ocak). */
export function trYearPeriod(year: number): MetricsPeriod {
  const start = Date.UTC(year, 0, 1) - TR_OFFSET_MS;
  const end = Date.UTC(year + 1, 0, 1) - TR_OFFSET_MS;
  return {
    startIso: new Date(start).toISOString(),
    endIso: new Date(end).toISOString(),
    startDateKey: `${year}-01-01`,
  };
}

/* -------------------------------------------------------------------------- */
/* Tipler                                                                      */
/* -------------------------------------------------------------------------- */

export type MetricsViewer = { userId: string; role: string; perms: EffectivePermissions };

export type AdvisorMetricRow = {
  id: string;
  fullName: string;
  role: string;
  branchId: string | null;
  /** Atanmış, silinmemiş müşteri (toplam, dönemden bağımsız). */
  customerCount: number;
  /** Dönemde açılan müşteri. */
  newCustomerCount: number;
  /** Yayındaki portföy (toplam). */
  activePropertyCount: number;
  callCount: number;
  appointCount: number;
  offerCount: number;
  /** Kabul edilen teklif. */
  dealCount: number;
  /** Anlaşma / teklif (yüzde); teklif yoksa null. */
  conversionPct: number | null;
  /** Tahsil edilmiş danışman payı. `null` = bu izleyici göremez (earnings_all yok, başkası). */
  revenue: number | null;
  /** Tahsil edilmemiş (tahmini) danışman payı; görünürlük `revenue` ile aynı. */
  pendingRevenue: number | null;
  /** Payı olan komisyon kaydı sayısı; görünürlük `revenue` ile aynı. */
  commissionCount: number | null;
  /** Dönem ayına ait aylık danışman hedefi (yoksa null; yalnız `withTargets`). */
  target: { deals: number; revenue: number } | null;
  /** Hedef gerçekleşme (%); hedef yoksa null. Gelir yetkisizse yalnız anlaşma oranı. */
  targetPct: number | null;
  /** Aktif talep / gecikmiş görev / takipsiz talep (yalnız `withLeadSignals`; tavana dayanırsa null). */
  activeDemandCount: number | null;
  overdueTaskCount: number | null;
  untrackedDemandCount: number | null;
};

export type AdvisorMetricsResult = {
  period: MetricsPeriod;
  scope: "office" | "self";
  /** Görünen kişi sayısı / toplam (profil tavanı için). */
  rows: AdvisorMetricRow[];
  profileTotal: number | null;
  /** Temel sorgulardan biri hata verdi: sayılara güvenilmez. */
  failed: boolean;
  /** Örnek veri rakamlara karışıyorsa "Örnek veri dahil" etiketi (aksi halde null). */
  sampleLabel: string | null;
  /** Tarama tavanına dayanıldı: sayılar eksik olabilir. */
  partial: boolean;
  seeAllEarnings: boolean;
  totals: {
    customerCount: number;
    callCount: number;
    appointCount: number;
    offerCount: number;
    dealCount: number;
    conversionPct: number | null;
    /** Görünen danışman gelirlerinin toplamı (`null` yetkisizse ve kendi satırı yoksa). */
    revenue: number | null;
  };
  office: {
    /** Ofis komisyonu (brüt): tahsil edilmiş brüt komisyon toplamı. Yalnız earnings_all. */
    commissionGrossCollected: number | null;
    /** Tahsil edilmemiş brüt komisyon (earnings_all). */
    commissionGrossPending: number | null;
  };
};

export type LoadAdvisorMetricsOptions = {
  viewer: MetricsViewer;
  tenantId: string | null;
  period: MetricsPeriod;
  /** Yalnız bu kişiler (360 / Performansım). Ofis geneli kapsam yoksa yine yalnız kendisi. */
  subjectIds?: readonly string[];
  /** Aylık hedefleri ekle (dönem ayının `targets` satırı). */
  withTargets?: boolean;
  /** Aktif talep / gecikmiş görev / takipsiz talep ekle. */
  withLeadSignals?: boolean;
  /** Gecikme için "şimdi" (saflık: dışarıdan). */
  nowMs: number;
  /** Pasif kişileri de listele (varsayılan: yalnız aktifler; `subjectIds` verilirse aktiflik aranmaz). */
  includeInactive?: boolean;
  /** Örnek veri KPI kapsamı. Verilmezse `loadSampleKpiScope` ile yüklenir (tek karar noktası: lib/sample-scope). */
  sample?: SampleKpiScope;
};

/* -------------------------------------------------------------------------- */
/* Komisyon satırları (tek okuma yolu)                                         */
/* -------------------------------------------------------------------------- */

export type CommissionFetchOptions = {
  tenantId: string | null;
  viewerId: string;
  seeAll: boolean;
  startIso?: string;
  endIso?: string;
  limit?: number;
  /** Verilirse örnek (is_sample) komisyonlar kapsama göre dışlanır; verilmezse süzülmez (cüzdan/hakediş gerçek kayıttır). */
  sample?: SampleKpiScope;
  /** `deal:deals(...)` içindeki alanlar; `assigned_to` MUTLAKA bulunmalı. */
  dealSelect?: string;
  /** Satırdaki ek kolonlar. */
  extraColumns?: string;
};

type Builder = {
  eq: (c: string, v: unknown) => Builder;
  gte: (c: string, v: unknown) => Builder;
  lt: (c: string, v: unknown) => Builder;
  order: (c: string, o: { ascending: boolean }) => Builder;
  limit: (n: number) => Builder;
  contains: (c: string, v: unknown) => Builder;
  then: PromiseLike<{ data: unknown; error: unknown }>["then"];
};

/**
 * Komisyon satırlarını okur. `seeAll` (earnings_all) yoksa başkasının satırı HİÇ çekilmez:
 * yalnız kendi anlaşmasına (deal.assigned_to) ait satırlar ve `splits` içinde kendi `profile_id`si
 * bulunan satırlar. En yeni önce; tavan aşılırsa `partial`.
 */
export async function fetchCommissionRows<T extends ShareRow & { created_at: string; id?: string }>(
  supabase: SupabaseClient,
  opts: CommissionFetchOptions,
): Promise<{ rows: T[]; error: boolean; partial: boolean }> {
  const limit = opts.limit ?? COMMISSION_LIMIT;
  const dealSelect = opts.dealSelect ?? "assigned_to";
  const cols = `id, gross_amount, status, splits, created_at${opts.extraColumns ? `, ${opts.extraColumns}` : ""}`;

  const base = (inner: boolean): Builder => {
    let q = supabase
      .from("commissions")
      .select(`${cols}, deal:deals!commissions_deal_id_fkey${inner ? "!inner" : ""}(${dealSelect})`) as unknown as Builder;
    if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);
    if (opts.sample) q = opts.sample.apply(q);
    if (opts.startIso) q = q.gte("created_at", opts.startIso);
    if (opts.endIso) q = q.lt("created_at", opts.endIso);
    return q.order("created_at", { ascending: false }).limit(limit);
  };

  if (opts.seeAll) {
    const res = (await base(false)) as unknown as { data: T[] | null; error: unknown };
    const rows = res.data ?? [];
    return { rows, error: Boolean(res.error), partial: rows.length >= limit };
  }

  const [mine, bySplit] = (await Promise.all([
    base(true).eq("deal.assigned_to", opts.viewerId),
    base(false).contains("splits", [{ profile_id: opts.viewerId }]),
  ])) as unknown as { data: T[] | null; error: unknown }[];
  const merged = new Map<string, T>();
  let anon = 0;
  for (const r of [...(mine.data ?? []), ...(bySplit.data ?? [])]) {
    merged.set(r.id ?? `row-${anon++}`, r);
  }
  const rows = [...merged.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return {
    rows,
    error: Boolean(mine.error),
    partial: (mine.data?.length ?? 0) >= limit || (bySplit.data?.length ?? 0) >= limit,
  };
}

/** Bir kişinin belirli aralıktaki kazancı — Kazanç sayfası ve metrikler AYNI işlevi kullanır. */
export function earningInRange<T extends ShareRow & { created_at: string }>(
  rows: readonly T[],
  range: { startIso: string; endIso: string },
  fullName: string | null,
  userId: string,
  opts: ShareOptions = {},
) {
  const s = Date.parse(range.startIso);
  const e = Date.parse(range.endIso);
  return summarizeAdvisorEarning(
    rows.filter((r) => {
      const t = Date.parse(r.created_at);
      return t >= s && t < e;
    }),
    fullName,
    userId,
    opts,
  );
}

/** Ofis komisyonu (brüt): aralıktaki tahsil edilmiş / bekleyen brüt toplam. */
export function officeGross(
  rows: readonly (Pick<ShareRow, "gross_amount" | "status"> & { created_at: string })[],
  range: { startIso: string; endIso: string },
): { collected: number; pending: number } {
  const s = Date.parse(range.startIso);
  const e = Date.parse(range.endIso);
  let collected = 0;
  let pending = 0;
  for (const r of rows) {
    const t = Date.parse(r.created_at);
    if (t < s || t >= e) continue;
    const g = Number(r.gross_amount) || 0;
    if (isPaid(r.status)) collected += g;
    else pending += g;
  }
  return { collected, pending };
}

/* -------------------------------------------------------------------------- */
/* Saf birleştirme                                                             */
/* -------------------------------------------------------------------------- */

export type MetricsProfile = { id: string; full_name: string; role: string; branch_id: string | null };
export type MetricsCommission = ShareRow & { created_at: string };

export type MetricsFacts = {
  profiles: MetricsProfile[];
  customerTotals: ReadonlyMap<string, number>;
  newCustomerOwners: readonly string[];
  liveProperties: ReadonlyMap<string, number>;
  callHandlers: readonly string[];
  appointmentOwners: readonly string[];
  offers: readonly { created_by: string | null; status: string }[];
  commissions: readonly MetricsCommission[];
  targets: readonly { profile_id: string | null; target_deals: number | string; target_revenue: number | string }[];
  leadSignals: {
    demands: readonly { customer_id: string | null; owner: string | null }[];
    tasks: readonly { assigned_to: string; customer_id: string | null; due_at: string | null }[];
    partial: boolean;
  } | null;
};

function tally(ids: readonly (string | null)[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of ids) if (id) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

/**
 * Ham gerçeklerden satırları üretir. SAF: sayfalar arası tutarlılık ve gizlilik testleri buradadır.
 * `canSeeRevenueOf(id)` gelir görünürlüğünü verir; görünmeyen kişinin komisyon hesabı hiç yapılmaz.
 */
export function buildAdvisorMetrics(
  facts: MetricsFacts,
  ctx: {
    period: MetricsPeriod;
    seeAllEarnings: boolean;
    viewerId: string;
    nowMs: number;
  },
): Pick<AdvisorMetricsResult, "rows" | "totals" | "office"> {
  const { period, seeAllEarnings, viewerId, nowMs } = ctx;
  const canSee = (id: string) => seeAllEarnings || id === viewerId;
  const calls = tally(facts.callHandlers);
  const appts = tally(facts.appointmentOwners);
  const offersBy = new Map<string, { offers: number; deals: number }>();
  for (const o of facts.offers) {
    if (!o.created_by) continue;
    const cur = offersBy.get(o.created_by) ?? { offers: 0, deals: 0 };
    cur.offers += 1;
    if (o.status === "accepted") cur.deals += 1;
    offersBy.set(o.created_by, cur);
  }
  const newCust = tally(facts.newCustomerOwners);
  const ambiguousNames = findAmbiguousNames(facts.profiles.map((p) => p.full_name));
  const targetByProfile = new Map<string, { deals: number; revenue: number }>();
  for (const t of facts.targets) {
    if (t.profile_id) {
      targetByProfile.set(t.profile_id, { deals: Number(t.target_deals) || 0, revenue: Number(t.target_revenue) || 0 });
    }
  }

  // Aktif talep / gecikmiş görev / takipsiz talep (tek tarama, kişi bazında)
  const lead = facts.leadSignals;
  const demandsBy = new Map<string, (string | null)[]>();
  const tasksBy = new Map<string, { customer_id: string | null; due_at: string | null }[]>();
  if (lead) {
    for (const d of lead.demands) {
      if (!d.owner) continue;
      const list = demandsBy.get(d.owner) ?? [];
      list.push(d.customer_id);
      demandsBy.set(d.owner, list);
    }
    for (const t of lead.tasks) {
      const list = tasksBy.get(t.assigned_to) ?? [];
      list.push(t);
      tasksBy.set(t.assigned_to, list);
    }
  }

  const rows: AdvisorMetricRow[] = facts.profiles.map((p) => {
    const o = offersBy.get(p.id) ?? { offers: 0, deals: 0 };
    const visible = canSee(p.id);
    const earning = visible
      ? summarizeAdvisorEarning(facts.commissions, p.full_name, p.id, { ambiguousNames })
      : null;
    const target = targetByProfile.get(p.id) ?? null;
    const demands = demandsBy.get(p.id) ?? [];
    const tasks = tasksBy.get(p.id) ?? [];
    const leadOk = lead !== null && !lead.partial;
    return {
      id: p.id,
      fullName: p.full_name,
      role: p.role,
      branchId: p.branch_id,
      customerCount: facts.customerTotals.get(p.id) ?? 0,
      newCustomerCount: newCust.get(p.id) ?? 0,
      activePropertyCount: facts.liveProperties.get(p.id) ?? 0,
      callCount: calls.get(p.id) ?? 0,
      appointCount: appts.get(p.id) ?? 0,
      offerCount: o.offers,
      dealCount: o.deals,
      conversionPct: conversionPct(o.deals, o.offers),
      revenue: earning ? earning.collected : null,
      pendingRevenue: earning ? earning.pending : null,
      commissionCount: earning ? earning.count : null,
      target,
      targetPct: targetProgressPct(target, { deals: o.deals, revenue: earning?.collected ?? 0 }, visible),
      activeDemandCount: leadOk ? demands.length : null,
      overdueTaskCount: leadOk ? tasks.filter((t) => t.due_at && Date.parse(t.due_at) < nowMs).length : null,
      untrackedDemandCount: leadOk ? untrackedCustomerIds(demands, tasks.map((t) => t.customer_id)).length : null,
    };
  });

  const sum = (pick: (r: AdvisorMetricRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const offerTotal = sum((r) => r.offerCount);
  const dealTotal = sum((r) => r.dealCount);
  const anyRevenue = rows.some((r) => r.revenue !== null);
  const gross = seeAllEarnings ? officeGross(facts.commissions, period) : null;

  return {
    rows,
    totals: {
      customerCount: sum((r) => r.customerCount),
      callCount: sum((r) => r.callCount),
      appointCount: sum((r) => r.appointCount),
      offerCount: offerTotal,
      dealCount: dealTotal,
      conversionPct: conversionPct(dealTotal, offerTotal),
      revenue: anyRevenue ? sum((r) => r.revenue ?? 0) : null,
    },
    office: {
      commissionGrossCollected: gross ? gross.collected : null,
      commissionGrossPending: gross ? gross.pending : null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Yükleyici                                                                   */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;
// PostgREST oluşturucusunun zincirleme genel tipi burada gereksiz karmaşık; sonuçlar aşağıda açıkça daraltılır.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;
const asRows = (res: { data: unknown } | null | undefined): Row[] =>
  res && Array.isArray(res.data) ? (res.data as Row[]) : [];

export async function loadAdvisorMetrics(
  supabase: SupabaseClient,
  opts: LoadAdvisorMetricsOptions,
): Promise<AdvisorMetricsResult> {
  const { viewer, tenantId, period, nowMs } = opts;
  const sample = opts.sample ?? (await loadSampleKpiScope(supabase, tenantId));
  const officeWide = hasOfficeWideDataScope(viewer.role);
  const seeAllEarnings = canSeeAllEarnings(viewer.perms);
  const scope: "office" | "self" = officeWide ? "office" : "self";

  const subjects = opts.subjectIds?.length
    ? [...new Set(officeWide ? opts.subjectIds : opts.subjectIds.filter((id) => id === viewer.userId))]
    : null;
  const selfIds = !officeWide ? [viewer.userId] : null;
  const wanted = subjects ?? selfIds; // null = tüm ekip

  // ── Profiller ───────────────────────────────────────────────────────────
  let pq = supabase
    .from("profiles")
    .select("id, full_name, role, branch_id", { count: "exact" })
    .order("full_name")
    .limit(PROFILE_LIMIT);
  if (wanted) pq = pq.in("id", wanted);
  else pq = pq.in("role", [...METRIC_ROLES]);
  if (!wanted && !opts.includeInactive) pq = pq.eq("is_active", true);
  const profilesRes = await pq;
  const profiles = (profilesRes.data ?? []) as MetricsProfile[];
  const ids = profiles.map((p) => p.id);
  const idSet = new Set(ids);

  const single = ids.length === 1 ? ids[0] : null;
  const scan = (q: Q, col: string): Q => (single ? q.eq(col, single) : q);
  const tq = (q: Q): Q => (tenantId ? q.eq("tenant_id", tenantId) : q);
  /** Tenant + örnek veri kapsamı (is_sample taşıyan tablolar için). */
  const tsq = (q: Q): Q => sample.apply(tq(q));
  let failed = Boolean(profilesRes.error);
  let partial = false;
  const noteScan = (rows: unknown[]) => {
    if (rows.length >= SCAN_LIMIT) partial = true;
  };

  // Kişi başına sayım: küçük ekipte head count (satır taşımaz), büyükte tek tarama.
  const countPerAdvisor = async (table: string, col: string, refine: (q: Q) => Q): Promise<Map<string, number>> => {
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    if (ids.length <= HEAD_COUNT_MAX_ADVISORS) {
      const counts = await Promise.all(
        ids.map(async (id) => {
          const r = await refine(tsq(supabase.from(table).select("id", { count: "exact", head: true }))).eq(col, id);
          if (r.error) failed = true;
          return [id, r.count ?? 0] as const;
        }),
      );
      for (const [id, n] of counts) if (n > 0) out.set(id, n);
      return out;
    }
    const r = await refine(tsq(supabase.from(table).select(col))).not(col, "is", null).limit(SCAN_LIMIT);
    if (r.error) failed = true;
    const data = (r.data ?? []) as Row[];
    noteScan(data);
    for (const row of data) {
      const id = row[col] as string | null;
      if (id && idSet.has(id)) out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  };

  const monthKey = period.startDateKey;
  const commissionPromise = ids.length
    ? fetchCommissionRows<MetricsCommission>(supabase, {
        tenantId,
        viewerId: viewer.userId,
        seeAll: seeAllEarnings,
        startIso: period.startIso,
        endIso: period.endIso,
        sample,
      })
    : Promise.resolve({ rows: [] as MetricsCommission[], error: false, partial: false });

  const [
    customerTotals,
    liveProperties,
    newCustRes,
    callRes,
    apptRes,
    offerRes,
    commissionRes,
    targetRes,
    demandRes,
    taskRes,
  ] = await Promise.all([
    countPerAdvisor("customers", "assigned_to", (q) => q.is("deleted_at", null)),
    countPerAdvisor("properties", "assigned_to", (q) => q.is("deleted_at", null).in("status", LIVE_PROPERTY_STATUSES)),
    ids.length
      ? scan(
          tsq(supabase.from("customers").select("assigned_to").is("deleted_at", null)).gte("created_at", period.startIso).lt("created_at", period.endIso).not("assigned_to", "is", null),
          "assigned_to",
        ).limit(SCAN_LIMIT)
      : null,
    ids.length
      ? scan(
          tsq(supabase.from("calls").select("handled_by")).gte("started_at", period.startIso).lt("started_at", period.endIso).not("handled_by", "is", null),
          "handled_by",
        ).limit(SCAN_LIMIT)
      : null,
    ids.length
      ? scan(
          tsq(supabase.from("appointments").select("assigned_to")).neq("status", "cancelled").gte("scheduled_at", period.startIso).lt("scheduled_at", period.endIso).not("assigned_to", "is", null),
          "assigned_to",
        ).limit(SCAN_LIMIT)
      : null,
    ids.length
      ? scan(
          tsq(supabase.from("offers").select("created_by, status")).gte("created_at", period.startIso).lt("created_at", period.endIso).not("created_by", "is", null),
          "created_by",
        ).limit(SCAN_LIMIT)
      : null,
    commissionPromise,
    opts.withTargets && ids.length
      ? tq(supabase.from("targets").select("profile_id, target_deals, target_revenue")).eq("period", "monthly").eq("period_start", monthKey).not("profile_id", "is", null)
      : null,
    opts.withLeadSignals && ids.length
      ? scan(
          tsq(
            supabase
              .from("customer_demands")
              .select("customer_id, customer:customers!customer_demands_customer_id_fkey!inner(assigned_to)")
              .in("status", [...OPEN_DEMAND_STATUSES]),
          ),
          "customer.assigned_to",
        )
          .not("customer.assigned_to", "is", null)
          .limit(SCAN_LIMIT)
      : null,
    opts.withLeadSignals && ids.length
      ? scan(tsq(supabase.from("tasks").select("assigned_to, customer_id, due_at").eq("status", "open")), "assigned_to")
          .not("assigned_to", "is", null)
          .limit(SCAN_LIMIT)
      : null,
  ]);

  for (const r of [newCustRes, callRes, apptRes, offerRes, targetRes, demandRes, taskRes]) {
    if (r && (r as { error?: unknown }).error) failed = true;
  }
  if (commissionRes.error) failed = true;
  if (commissionRes.partial) partial = true;

  const onlyKnown = (rows: Row[], col: string) => rows.map((r) => r[col] as string | null).filter((id): id is string => !!id && idSet.has(id));
  const newCustomerOwners = onlyKnown(asRows(newCustRes), "assigned_to");
  const callHandlers = onlyKnown(asRows(callRes), "handled_by");
  const appointmentOwners = onlyKnown(asRows(apptRes), "assigned_to");
  const offerRows = asRows(offerRes).filter((r) => idSet.has(String(r.created_by))) as {
    created_by: string | null;
    status: string;
  }[];
  for (const r of [newCustRes, callRes, apptRes, offerRes, demandRes, taskRes]) noteScan(asRows(r));

  let leadSignals: MetricsFacts["leadSignals"] = null;
  if (opts.withLeadSignals) {
    const demandRows = asRows(demandRes) as unknown as {
      customer_id: string | null;
      customer: { assigned_to: string | null } | { assigned_to: string | null }[] | null;
    }[];
    const taskRows = asRows(taskRes) as unknown as { assigned_to: string; customer_id: string | null; due_at: string | null }[];
    leadSignals = {
      demands: demandRows.map((d) => ({
        customer_id: d.customer_id,
        owner: (Array.isArray(d.customer) ? d.customer[0] : d.customer)?.assigned_to ?? null,
      })),
      tasks: taskRows,
      partial: Boolean(
        (demandRes as { error?: unknown } | null)?.error ||
          (taskRes as { error?: unknown } | null)?.error ||
          demandRows.length >= SCAN_LIMIT ||
          taskRows.length >= SCAN_LIMIT,
      ),
    };
  }

  const built = buildAdvisorMetrics(
    {
      profiles,
      customerTotals,
      newCustomerOwners,
      liveProperties,
      callHandlers,
      appointmentOwners,
      offers: offerRows,
      commissions: commissionRes.rows,
      targets: (asRows(targetRes) as unknown as MetricsFacts["targets"]) ?? [],
      leadSignals,
    },
    { period, seeAllEarnings, viewerId: viewer.userId, nowMs },
  );

  return {
    period,
    scope,
    ...built,
    profileTotal: profilesRes.count ?? null,
    failed,
    sampleLabel: sample.label,
    partial,
    seeAllEarnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Hedef gerçekleşmesi (Hedefler sayfası, Performansım / Hedef sekmesi)        */
/* -------------------------------------------------------------------------- */

/**
 * Hedeflerin gerçekleşmesi: anlaşma = kabul edilen teklif, kişi geliri = tahsil edilmiş danışman payı,
 * ofis geneli hedef = Ofis komisyonu (brüt). Aynı dönem için `loadAdvisorMetrics` ile birebir aynı tanım.
 * Görünürlük: ofis geneli hedefin geliri yalnız earnings_all ile; kişi hedefinde kendi geliri her zaman,
 * başkasınınki yalnız earnings_all ile hesaplanır (`revenueVisible=false` ise gelir 0 döner, UI gizler).
 */
export async function loadTargetActualsLive(
  supabase: SupabaseClient,
  opts: {
    viewer: MetricsViewer;
    tenantId: string | null;
    targets: readonly TargetLike[];
    names: ReadonlyMap<string, string>;
    /** Örnek veri KPI kapsamı; verilmezse yüklenir. */
    sample?: SampleKpiScope;
  },
): Promise<Map<string, { deals: number; revenue: number; revenueVisible: boolean }>> {
  const { viewer, tenantId, targets, names } = opts;
  const sample = opts.sample ?? (await loadSampleKpiScope(supabase, tenantId));
  const out = new Map<string, { deals: number; revenue: number; revenueVisible: boolean }>();
  if (targets.length === 0) return out;
  const seeAll = canSeeAllEarnings(viewer.perms);
  const ranges = targets.map((t) => targetPeriodRange(t.period_start, t.period));
  const startIso = new Date(Math.min(...ranges.map((r) => r.start))).toISOString();
  const endIso = new Date(Math.max(...ranges.map((r) => r.end))).toISOString();

  let oq = sample
    .apply(supabase.from("offers").select("created_by, created_at"))
    .eq("status", "accepted")
    .gte("created_at", startIso)
    .lt("created_at", endIso);
  if (tenantId) oq = oq.eq("tenant_id", tenantId);
  const [offerRes, comm] = await Promise.all([
    oq.limit(SCAN_LIMIT),
    fetchCommissionRows<MetricsCommission>(supabase, { tenantId, viewerId: viewer.userId, seeAll, startIso, endIso, sample }),
  ]);

  const ambiguousNames = findAmbiguousNames([...names.values()]);
  const actuals = computeTargetActuals(
    targets,
    (offerRes.data ?? []) as { created_by: string | null; created_at: string }[],
    comm.rows,
    names,
    { ambiguousNames },
  );
  for (const t of targets) {
    const a = actuals.get(t.id) ?? { deals: 0, revenue: 0 };
    const visible = t.profile_id ? seeAll || t.profile_id === viewer.userId : seeAll;
    out.set(t.id, { deals: a.deals, revenue: visible ? a.revenue : 0, revenueVisible: visible });
  }
  return out;
}
