import type { SupabaseClient } from "@supabase/supabase-js";
import { getSampleScope, sampleValues } from "@/lib/sample-scope";
import { now } from "@/lib/clock";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { loadLeadResponses, type LeadResponsesResult } from "@/lib/response-time/load";
import {
  computeAgentScores,
  computeStreak,
  emptyAgentScore,
  emptyAgentStats,
  rankAgentScores,
  type ActivityRow,
  type AgentScore,
  type AgentStats,
} from "@/lib/gamification";
import {
  currentLeaguePeriod,
  leaguePeriod,
  previousLeaguePeriod,
  type LeaguePeriod,
  type LeaguePeriodKind,
} from "@/lib/league/periods";
import { DEFAULT_LEAGUE_SETTINGS, resolveLeagueSettings, type LeagueSettings } from "@/lib/league/settings";

/**
 * Lig verisi toplayıcı — SUNUCU tarafı.
 *
 * NEDEN AYRI DOSYA: puan/rozet MANTIĞI `src/lib/gamification.ts` içinde saf
 * duruyor (test edilebilir, DB bilmez). Bu dosya ise o mantığa girdi üretir:
 * hangi tablodan hangi filtreyle satır çekileceği. İkisi ayrı çünkü
 * `/app/lig` sayfası ile `/api/cron/lig-snapshot` AYNI sorguyu kullanmalı —
 * aksi halde ekranda görülen skor ile arşivlenen skor sessizce ayrışır.
 *
 * İki farklı istemciyle çalışır:
 *  - Sayfa: RLS'li kullanıcı istemcisi (tenant filtresi zaten RLS'te; yine de
 *    `tenantId` verilirse ek eq uygulanır — zararsız, admin istemciyle ortak kod).
 *  - Cron: service role admin istemcisi (RLS yok → `tenantId` ZORUNLU).
 *
 * P12 (kazanç gizliliği): bu dosya HİÇBİR tutar/ciro/komisyon kolonu seçmez; lig yalnız puan ve adet bilir.
 */

/** Puan/rozet hesabına giren rollerin listesi — call_center/accounting ligde yarışmaz. */
export const LEAGUE_ROLES = ["advisor", "team_lead", "branch_manager", "gm", "owner"] as const;

export type PeriodRange = LeaguePeriod;

/**
 * "YYYY-MM" veya "YYYY-Www" → kapalı-açık aralık [başlangıç, sonraki dönem başı).
 * Sınırlar Türkiye takvimine göre; sayfa ve snapshot cron'u AYNI fonksiyonu kullanır.
 * Geçersiz anahtar içinde bulunulan aya düşer.
 */
export function periodRange(period: string): PeriodRange {
  return leaguePeriod(period, now());
}

/** Verilen tarihten (varsayılan: şimdi) dönem anahtarı. */
export function periodOf(date: Date, kind: LeaguePeriodKind = "month"): string {
  return currentLeaguePeriod(kind, date.getTime());
}

/** Bir önceki dönem anahtarı ("2026-01" → "2025-12", "2026-W01" → "2025-W52"). */
export function previousPeriod(period: string): string {
  return previousLeaguePeriod(period, now());
}

export type LeagueAgent = {
  id: string;
  fullName: string;
  role: string;
  branchId: string | null;
};

export type LeagueData = {
  range: PeriodRange;
  agents: LeagueAgent[];
  /** Puana göre sıralı, sıra numaralı skorlar (yalnız `agents` içindekiler) */
  ranked: Array<AgentScore & { rank: number }>;
  /** Danışman bazlı rozet değerlendirme girdisi */
  statsById: Map<string, AgentStats>;
  /** Danışman bazlı kesintisiz gün serisi */
  streakById: Map<string, number>;
  /** Dönemin ham aktivite satırları (meydan okuma / koçluk aynı kaynağı kullanır) */
  activity: ActivityRow[];
  /** Hesapta kullanılan ofis ayarı (kural puanları + tutar gösterimi) */
  settings: LeagueSettings;
  /** Örnek (demo) kayıtlar bu hesaba dahil mi */
  includeSample: boolean;
};

type Row = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Ofis lig ayarı. Tablo yoksa / okunamazsa / satır yoksa varsayılan kurallar (lig asla ayar yüzünden çökmez).
 */
export async function loadLeagueSettings(client: SupabaseClient, tenantId: string): Promise<LeagueSettings> {
  try {
    const { data, error } = await client
      .from("league_settings")
      .select("rules, show_amounts")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !data) return DEFAULT_LEAGUE_SETTINGS;
    return resolveLeagueSettings(data as { rules?: unknown; show_amounts?: unknown });
  } catch {
    return DEFAULT_LEAGUE_SETTINGS;
  }
}

/** Sayfalı okuma (PostgREST 1000 satır sınırı): hata = boş dizi (lig kısmi veriyle de açılır). */
type Builder = {
  eq: (c: string, v: unknown) => Builder;
  in: (c: string, v: readonly unknown[]) => Builder;
  is: (c: string, v: null) => Builder;
  not: (c: string, op: string, v: unknown) => Builder;
  neq: (c: string, v: unknown) => Builder;
  gte: (c: string, v: unknown) => Builder;
  lt: (c: string, v: unknown) => Builder;
  order: (c: string, o: { ascending: boolean }) => Builder;
  range: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
};

async function paged(
  client: SupabaseClient,
  table: string,
  columns: string,
  apply: (q: Builder) => Builder,
): Promise<Row[]> {
  const res = await fetchAllRows<Row>((from, to) =>
    apply(client.from(table).select(columns) as unknown as Builder)
      .order("id", { ascending: true })
      .range(from, to),
  );
  return res.error ? [] : res.data;
}

function sampleFlag(r: Row): boolean {
  return r.is_sample === true;
}

/**
 * Bir zaman aralığının tüm puan satırlarını toplar (lig + meydan okuma + koçluk TEK kaynak).
 *
 * PUAN KAYNAKLARI:
 *  - deal_won           → deals: stage='won', updated_at aralıkta, assigned_to
 *  - property_new       → properties: created_at aralıkta, silinmemiş, assigned_to
 *  - listing_authorized → aynı portföy satırı, authorization_type='exclusive' (bonus)
 *  - appointment_done   → appointments: status='completed', scheduled_at aralıkta, tür 'showing' DEĞİL
 *  - showing_done       → appointments: status='completed', tür 'showing'
 *  - task_done          → tasks: status='done', completed_at aralıkta
 *  - customer_new       → customers: created_at aralıkta, silinmemiş, kara listede değil, created_by (yoksa assigned_to)
 *  - offer_made         → offers: submitted_at aralıkta, taslak değil, created_by
 *  - fast_response      → Aday Hızı ölçümü (response-time/load): yeni müşteriye SLA içinde ilk dönüş, assigned_to
 *  - listing_confirmed  → portal_listings: status='live', last_confirmed_at aralıkta (ilan başına dönemde 1), portföy sahibi
 *  - nps_promoter       → surveys + survey_tasks (9-10)
 *  - leak_sla_response  → listing_closures: sla_warning_sent_at IS NULL
 *
 * Hile koruması: her satıra kaynak kayıt kimliği (`ref`) ve örnek bayrağı (`isSample`) taşınır;
 * hesap katmanı aynı kaydı iki kez saymaz, örnek veriyi (ofis eşiği geçince) dışlar. Silinen / geri alınan
 * kayıt zaten sorgu koşuluna uymadığı için puanı kendiliğinden düşer (puan her seferinde canlı kayıttan hesaplanır;
 * yalnız kapanan ay `agent_score_snapshots`'a mühürlenir).
 *
 * `stage='won'` için `updated_at`: `deals` tablosunda "kazanıldığı an" kolonu yok; aşama değiştiğinde updated_at
 * güncelleniyor (bilinçli kabul edilen yaklaşım).
 */
export async function loadLeagueActivity(
  client: SupabaseClient,
  opts: {
    tenantId: string;
    startIso: string;
    endIso: string;
    /** Küme ya da (profil okuması bitince çözülen) söz: sorgular beklemeden başlar, süzme için en sonda beklenir. */
    agentIds: ReadonlySet<string> | Promise<ReadonlySet<string>>;
    sampleVals: boolean[];
    nowMs: number;
    /** Önceden okunmuş Aday Hızı ölçümü (verilmezse burada okunur) */
    responses?: LeadResponsesResult | Promise<LeadResponsesResult>;
  },
): Promise<ActivityRow[]> {
  const { tenantId, startIso, endIso, sampleVals } = opts;
  const rangeOf = (q: Builder, col: string) => q.gte(col, startIso).lt(col, endIso);

  // Aday Hızı okuması diğer 10 sorguyla BİRLİKTE başlar (eskiden onlar bittikten sonra ardışık okunuyordu).
  const responsesP = opts.responses ?? loadLeadResponses(client, { tenantId, startIso, endIso, nowMs: opts.nowMs });
  const [deals, props, appts, tasks, surveys, surveyTasks, closures, customers, offers, listings] = await Promise.all([
    paged(client, "deals", "id, assigned_to, updated_at, is_sample", (q) =>
      rangeOf(q.eq("tenant_id", tenantId).in("is_sample", sampleVals).eq("stage", "won").not("assigned_to", "is", null), "updated_at")),
    paged(client, "properties", "id, assigned_to, created_at, authorization_type, is_sample", (q) =>
      rangeOf(q.eq("tenant_id", tenantId).in("is_sample", sampleVals).is("deleted_at", null).not("assigned_to", "is", null), "created_at")),
    paged(client, "appointments", "id, assigned_to, scheduled_at, appointment_type, is_sample", (q) =>
      rangeOf(q.eq("tenant_id", tenantId).in("is_sample", sampleVals).eq("status", "completed").not("assigned_to", "is", null), "scheduled_at")),
    paged(client, "tasks", "id, assigned_to, completed_at, is_sample", (q) =>
      rangeOf(q.eq("tenant_id", tenantId).in("is_sample", sampleVals).eq("status", "done").not("assigned_to", "is", null), "completed_at")),
    paged(client, "surveys", "id, agent_id, answered_at", (q) =>
      rangeOf(q.eq("tenant_id", tenantId).eq("status", "answered").gte("score", 9).not("agent_id", "is", null), "answered_at")),
    // Anket modülü destekleyenleri (9-10): satıcı/ev sahibi/malik kitleleri. Alıcı/kiracı cevabı `surveys`'e zaten
    // yansıtıldığı için burada SAYILMAZ (çift puan yok). Tablo yoksa hata = boş.
    paged(client, "survey_tasks", "id, agent_id, completed_at", (q) =>
      rangeOf(
        q.eq("tenant_id", tenantId).eq("status", "completed").in("audience", ["seller", "landlord", "owner"]).gte("score", 9).not("agent_id", "is", null),
        "completed_at",
      )),
    paged(client, "listing_closures", "id, created_by, created_at", (q) =>
      rangeOf(q.eq("tenant_id", tenantId).is("sla_warning_sent_at", null).not("created_by", "is", null), "created_at")),
    paged(client, "customers", "id, created_by, assigned_to, created_at, is_sample", (q) =>
      rangeOf(q.eq("tenant_id", tenantId).in("is_sample", sampleVals).is("deleted_at", null).eq("blacklist", false), "created_at")),
    paged(client, "offers", "id, created_by, submitted_at, is_sample", (q) =>
      rangeOf(q.eq("tenant_id", tenantId).in("is_sample", sampleVals).neq("status", "draft").not("created_by", "is", null), "submitted_at")),
    paged(
      client,
      "portal_listings",
      "id, last_confirmed_at, property:properties!portal_listings_property_id_fkey(assigned_to, is_sample)",
      (q) => rangeOf(q.eq("tenant_id", tenantId).eq("status", "live"), "last_confirmed_at"),
    ),
  ]);

  const agentIds = await opts.agentIds;
  const activity: ActivityRow[] = [];
  const push = (staffId: string | null, kind: ActivityRow["kind"], at: unknown, ref: unknown, isSample: boolean) => {
    if (!staffId || !agentIds.has(staffId)) return;
    const when = str(at);
    if (!when) return;
    activity.push({ staffId, kind, at: when, ref: str(ref) ?? undefined, isSample });
  };

  for (const r of deals) push(str(r.assigned_to), "deal_won", r.updated_at, r.id, sampleFlag(r));
  for (const r of props) {
    push(str(r.assigned_to), "property_new", r.created_at, r.id, sampleFlag(r));
    if (r.authorization_type === "exclusive") push(str(r.assigned_to), "listing_authorized", r.created_at, r.id, sampleFlag(r));
  }
  for (const r of appts) {
    const kind = r.appointment_type === "showing" ? "showing_done" : "appointment_done";
    push(str(r.assigned_to), kind, r.scheduled_at, r.id, sampleFlag(r));
  }
  for (const r of tasks) push(str(r.assigned_to), "task_done", r.completed_at, r.id, sampleFlag(r));
  for (const r of surveys) push(str(r.agent_id), "nps_promoter", r.answered_at, `s:${String(r.id)}`, false);
  for (const r of surveyTasks) push(str(r.agent_id), "nps_promoter", r.completed_at, `t:${String(r.id)}`, false);
  for (const r of closures) push(str(r.created_by), "leak_sla_response", r.created_at, r.id, false);
  for (const r of customers) push(str(r.created_by) ?? str(r.assigned_to), "customer_new", r.created_at, r.id, sampleFlag(r));
  for (const r of offers) push(str(r.created_by), "offer_made", r.submitted_at, r.id, sampleFlag(r));
  for (const r of listings) {
    const p = Array.isArray(r.property) ? (r.property[0] as Row | undefined) : (r.property as Row | null | undefined);
    if (!p) continue;
    const isSample = p.is_sample === true;
    if (isSample && !sampleVals.includes(true)) continue;
    push(str(p.assigned_to), "listing_confirmed", r.last_confirmed_at, r.id, isSample);
  }

  // Hızlı ilk dönüş: Aday Hızı ile AYNI ölçüm (tek okuma yolu). Örnek müşteri bayrağı yukarıdaki müşteri satırından gelir.
  const sampleByCustomer = new Map(customers.map((c) => [String(c.id), sampleFlag(c)]));
  const responses = await responsesP;
  for (const lr of responses.rows) {
    if (lr.status !== "hizli" || !lr.assignedTo || !lr.firstTouchAt) continue;
    // Ölçümün tanımladığı müşteri yukarıdaki sayfalı okumada yoksa (örnek dışlandı) puan verilmez.
    if (!sampleByCustomer.has(lr.customerId)) continue;
    push(lr.assignedTo, "fast_response", lr.createdAt, lr.customerId, sampleByCustomer.get(lr.customerId) ?? false);
  }

  return activity;
}

/**
 * Bir dönemin tüm lig verisini tek seferde toplar.
 */
export async function loadLeagueData(
  client: SupabaseClient,
  opts: {
    /** "YYYY-MM" veya "YYYY-Www" */
    period: string;
    /**
     * ZORUNLU. Admin (service role) istemcide RLS yok — tenant filtresi tek
     * izolasyon katmanı. RLS'li istemcide de açıkça yazılıyor: aynı kod iki
     * istemciyle çalışıyor, filtreyi "RLS nasılsa halleder" diye atlamak
     * cron tarafında sessiz bir kiracı sızıntısı olurdu.
     */
    tenantId: string;
    /** Verilirse yalnız bu şubenin danışmanları yarışır */
    branchId?: string | null;
    /** Seri hesabı için "bugün" (YYYY-MM-DD) — saflık gereği dışarıdan gelir */
    todayIso: string;
    /** Hızlı dönüş ölçümü için "şimdi"; verilmezse `clock.now()` */
    nowMs?: number;
    /** Önceden yüklenmiş ayar (verilmezse okunur) */
    settings?: LeagueSettings;
  },
): Promise<LeagueData> {
  const range = leaguePeriod(opts.period, opts.nowMs ?? now());
  const tenantId = opts.tenantId;
  const nowMs = opts.nowMs ?? now();

  // Demo kayıtlar yalnız ofiste gerçek kayıt eşiği altındayken lige girer (sample-scope). Ayar okuması ve örnek kapsamı
  // birbirinden bağımsız: birlikte başlar (eskiden art arda 2 tur).
  const [sampleScope, settings] = await Promise.all([
    getSampleScope(client, tenantId),
    opts.settings ? Promise.resolve(opts.settings) : loadLeagueSettings(client, tenantId),
  ]);
  const includeSample = sampleScope.include;
  const sampleVals = sampleValues(includeSample);

  // Seri penceresi: 400 gün geriye — "Maratoncu" (30 gün) için fazlasıyla yeterli.
  const streakSince = new Date(Date.parse(`${opts.todayIso.slice(0, 10)}T00:00:00.000Z`) - 400 * 86_400_000).toISOString();

  // Danışman listesi (profiller) yalnız SÜZME için gerekir; etkinlik/cevap sorguları ona bağlı değil. Hepsi tek turda başlar
  // (eskiden profiller -> cevap hızı -> etkinlik olarak 3 ardışık tur).
  const profilesP = paged(client, "profiles", "id, full_name, role, branch_id", (q) => q.eq("tenant_id", tenantId).eq("is_active", true));
  const agentIdsP = profilesP.then((ps) =>
    new Set(
      ps
        .filter((p) => LEAGUE_ROLES.includes(String(p.role) as (typeof LEAGUE_ROLES)[number]))
        .filter((p) => (opts.branchId ? str(p.branch_id) === opts.branchId : true))
        .map((p) => String(p.id)),
    ) as ReadonlySet<string>,
  );
  const responsesP = loadLeadResponses(client, { tenantId, startIso: range.startIso, endIso: range.endIso, nowMs });
  const activityP = loadLeagueActivity(client, {
    tenantId,
    startIso: range.startIso,
    endIso: range.endIso,
    agentIds: agentIdsP,
    sampleVals,
    nowMs,
    responses: responsesP,
  });

  const [profiles, dealsAll, propsAll, networkAll, streakDeals, streakAppts, streakTasks, streakProps, activity] = await Promise.all([
    profilesP,

    // ── Ömür boyu rozet sayaçları ────────────────────────────────────────
    paged(client, "deals", "id, assigned_to", (q) =>
      q.eq("tenant_id", tenantId).in("is_sample", sampleVals).eq("stage", "won").not("assigned_to", "is", null)),
    paged(client, "properties", "id, assigned_to", (q) =>
      q.eq("tenant_id", tenantId).in("is_sample", sampleVals).is("deleted_at", null).not("assigned_to", "is", null)),
    paged(client, "network_listings", "id, created_by", (q) => q.eq("tenant_id", tenantId).not("created_by", "is", null)),

    // ── Seri (streak) pencereleri: yalnız tarih kolonları ────────────────
    paged(client, "deals", "id, assigned_to, updated_at", (q) =>
      q.eq("tenant_id", tenantId).in("is_sample", sampleVals).eq("stage", "won").gte("updated_at", streakSince).not("assigned_to", "is", null)),
    paged(client, "appointments", "id, assigned_to, scheduled_at", (q) =>
      q.eq("tenant_id", tenantId).in("is_sample", sampleVals).eq("status", "completed").gte("scheduled_at", streakSince).not("assigned_to", "is", null)),
    paged(client, "tasks", "id, assigned_to, completed_at", (q) =>
      q.eq("tenant_id", tenantId).in("is_sample", sampleVals).eq("status", "done").gte("completed_at", streakSince).not("assigned_to", "is", null)),
    paged(client, "properties", "id, assigned_to, created_at", (q) =>
      q.eq("tenant_id", tenantId).in("is_sample", sampleVals).is("deleted_at", null).gte("created_at", streakSince).not("assigned_to", "is", null)),
    activityP,
  ]);
  const responses = await responsesP;

  // ── Yarışan danışman listesi ────────────────────────────────────────────
  const agents: LeagueAgent[] = profiles
    .filter((p) => LEAGUE_ROLES.includes(String(p.role) as (typeof LEAGUE_ROLES)[number]))
    .filter((p) => (opts.branchId ? str(p.branch_id) === opts.branchId : true))
    .map((p) => ({
      id: String(p.id),
      fullName: String(p.full_name ?? "—"),
      role: String(p.role ?? "advisor"),
      branchId: str(p.branch_id),
    }));
  const agentIds = new Set(agents.map((a) => a.id));

  const scores = computeAgentScores(activity, settings.ruleset, { includeSample });
  // Hiç aktivitesi olmayan danışman da tabloda 0 puanla görünmeli.
  const seen = new Set(scores.map((s) => s.staffId));
  const zeroFilled = [
    ...scores,
    ...agents.filter((a) => !seen.has(a.id)).map((a) => emptyAgentScore(a.id)),
  ].sort((a, b) => (b.total !== a.total ? b.total - a.total : a.staffId.localeCompare(b.staffId)));

  const ranked = rankAgentScores(zeroFilled);

  // ── Seri: kişi bazlı aktivite günleri ───────────────────────────────────
  const daysById = new Map<string, string[]>();
  const collectDays = (rows: Row[], staffKey: string, atKey: string) => {
    for (const r of rows) {
      const staffId = str(r[staffKey]);
      const at = str(r[atKey]);
      if (!staffId || !at || !agentIds.has(staffId)) continue;
      const list = daysById.get(staffId);
      if (list) list.push(at);
      else daysById.set(staffId, [at]);
    }
  };
  collectDays(streakDeals, "assigned_to", "updated_at");
  collectDays(streakAppts, "assigned_to", "scheduled_at");
  collectDays(streakTasks, "assigned_to", "completed_at");
  collectDays(streakProps, "assigned_to", "created_at");

  const streakById = new Map<string, number>();
  for (const a of agents) {
    streakById.set(a.id, computeStreak(daysById.get(a.id) ?? [], opts.todayIso));
  }

  // ── Ömür boyu sayaçlar ──────────────────────────────────────────────────
  const countBy = (rows: Row[], key: string) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const id = str(r[key]);
      if (!id || !agentIds.has(id)) continue;
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  };
  const dealsAllBy = countBy(dealsAll, "assigned_to");
  const propsAllBy = countBy(propsAll, "assigned_to");
  const networkAllBy = countBy(networkAll, "created_by");

  // Ortalama ilk yanıt süresi (çalışma dakikası): yalnız dönemde yanıtlanan yeni müşteriler; en az 3 ölçüm şart.
  const responseMinutes = averageFirstResponse(responses, agentIds);

  // ── Rozet girdisi ───────────────────────────────────────────────────────
  const statsById = new Map<string, AgentStats>();
  for (const r of ranked) {
    statsById.set(
      r.staffId,
      emptyAgentStats({
        dealCount: r.breakdown.deal_won.count,
        propertyCount: r.breakdown.property_new.count,
        appointmentCount: r.breakdown.appointment_done.count,
        taskCount: r.breakdown.task_done.count,
        npsPromoterCount: r.breakdown.nps_promoter.count,
        showingCount: r.breakdown.showing_done.count,
        authorizedCount: r.breakdown.listing_authorized.count,
        customerCount: r.breakdown.customer_new.count,
        offerCount: r.breakdown.offer_made.count,
        fastResponseCount: r.breakdown.fast_response.count,
        dealCountAllTime: dealsAllBy.get(r.staffId) ?? 0,
        propertyCountAllTime: propsAllBy.get(r.staffId) ?? 0,
        networkShareCount: networkAllBy.get(r.staffId) ?? 0,
        avgFirstResponseMin: responseMinutes.get(r.staffId) ?? null,
        streakDays: streakById.get(r.staffId) ?? 0,
        rank: r.rank,
        score: r.total,
      }),
    );
  }

  return { range, agents, ranked, statsById, streakById, activity, settings, includeSample };
}

/** Danışman başına ortalama ilk yanıt süresi (dk); ölçüm sayısı 3'ten azsa o kişi için değer yok (sahte hız rozeti yok). */
export function averageFirstResponse(res: LeadResponsesResult, agentIds: ReadonlySet<string>): Map<string, number> {
  const out = new Map<string, number>();
  const acc = new Map<string, { sum: number; n: number }>();
  for (const r of res.rows) {
    if (!r.responded || !r.assignedTo || !agentIds.has(r.assignedTo)) continue;
    const a = acc.get(r.assignedTo) ?? { sum: 0, n: 0 };
    a.sum += r.minutes;
    a.n += 1;
    acc.set(r.assignedTo, a);
  }
  for (const [id, a] of acc) if (a.n >= 3) out.set(id, a.sum / a.n);
  return out;
}
