import type { SupabaseClient } from "@supabase/supabase-js";
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
 */

/** Puan/rozet hesabına giren rollerin listesi — call_center/accounting ligde yarışmaz. */
export const LEAGUE_ROLES = ["advisor", "team_lead", "branch_manager", "gm", "owner"] as const;

/** Satır limiti — tek ofis/tek ay için fazlasıyla yeterli, kaçak sorguya karşı tavan. */
const ROW_LIMIT = 5000;

export type PeriodRange = {
  /** YYYY-MM */
  period: string;
  /** Dönem başı (dahil) ISO */
  startIso: string;
  /** Dönem sonu (HARİÇ) ISO — bir sonraki ayın 1'i */
  endIso: string;
  /** Türkçe etiket, ör. "Temmuz 2026" */
  label: string;
};

/**
 * "YYYY-MM" → kapalı-açık aralık [ay başı, sonraki ay başı).
 *
 * UTC sınırları bilinçli: sunucu (Vercel) UTC çalışır ve snapshot cron'u da
 * UTC saatinde tetiklenir; ay sınırını yerel saate bırakmak dönemin son
 * gününde 3 saatlik kaymaya yol açardı.
 */
export function periodRange(period: string): PeriodRange {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const year = m ? Number(m[1]) : NaN;
  const month = m ? Number(m[2]) : NaN;
  const valid = m !== null && month >= 1 && month <= 12;
  const y = valid ? year : new Date().getUTCFullYear();
  const mo = valid ? month : new Date().getUTCMonth() + 1;

  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(y, mo, 1));
  return {
    period: `${y}-${String(mo).padStart(2, "0")}`,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    label: new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" }).format(start),
  };
}

/** Verilen tarihten (varsayılan: şimdi) dönem anahtarı. */
export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Bir önceki dönem anahtarı ("2026-01" → "2025-12"). */
export function previousPeriod(period: string): string {
  const { startIso } = periodRange(period);
  const d = new Date(startIso);
  return periodOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));
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
};

type Row = Record<string, unknown>;

/** `select` sonucundan güvenli dizi çıkarımı — hata durumunda boş dizi. */
function rowsOf(res: { data: unknown; error: unknown } | null | undefined): Row[] {
  if (!res || res.error || !Array.isArray(res.data)) return [];
  return res.data as Row[];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Bir dönemin tüm lig verisini tek seferde toplar.
 *
 * PUAN KAYNAKLARI (SCORE_RULES ile birebir):
 *  - deal_won          → deals: stage='won', updated_at aralıkta, assigned_to
 *  - property_new      → properties: created_at aralıkta, silinmemiş, assigned_to
 *  - appointment_done  → appointments: status='completed', scheduled_at aralıkta
 *  - task_done         → tasks: status='done', completed_at aralıkta
 *  - nps_promoter      → surveys: status='answered', score>=9, answered_at aralıkta
 *  - leak_sla_response → listing_closures: created_at aralıkta ve
 *    `sla_warning_sent_at IS NULL`. Yorum: kayıp-kaçak kapanışı danışman
 *    tarafından kaydedilmiş ve proaktif SLA uyarısının (7 gün) HİÇ ateşlenmesi
 *    gerekmemiş — yani SLA penceresi içinde yanıt verilmiş demektir.
 *
 * `stage='won'` için `updated_at` kullanılıyor: `deals` tablosunda "kazanıldığı
 * an" kolonu yok; aşama değiştiğinde updated_at güncelleniyor. Bu, kazanıldıktan
 * sonra düzenlenen anlaşmanın dönemini kaydırabilir — bilinçli kabul edilen
 * yaklaşım (alternatifi yeni kolon + backfill migration'ı).
 */
export async function loadLeagueData(
  client: SupabaseClient,
  opts: {
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
  },
): Promise<LeagueData> {
  const range = periodRange(opts.period);
  const { startIso, endIso } = range;
  const tenantId = opts.tenantId;

  // Seri penceresi: 400 gün geriye — "Maratoncu" (30 gün) için fazlasıyla
  // yeterli, tek danışman için satır sayısı yönetilebilir kalır.
  const streakSince = new Date(Date.parse(`${opts.todayIso.slice(0, 10)}T00:00:00.000Z`) - 400 * 86_400_000).toISOString();

  const [
    profilesRes,
    dealsRes,
    propsRes,
    apptRes,
    tasksRes,
    surveysRes,
    closuresRes,
    dealsAllRes,
    propsAllRes,
    networkRes,
    streakDealsRes,
    streakApptRes,
    streakTasksRes,
    streakPropsRes,
  ] = await Promise.all([
    client.from("profiles").select("id, full_name, role, branch_id")
      .eq("tenant_id", tenantId).eq("is_active", true).limit(200),

    // ── Dönem içi puan kaynakları ────────────────────────────────────────
    client.from("deals").select("assigned_to, updated_at").eq("tenant_id", tenantId).eq("stage", "won")
      .gte("updated_at", startIso).lt("updated_at", endIso).not("assigned_to", "is", null).limit(ROW_LIMIT),
    client.from("properties").select("assigned_to, created_at").eq("tenant_id", tenantId).is("deleted_at", null)
      .gte("created_at", startIso).lt("created_at", endIso).not("assigned_to", "is", null).limit(ROW_LIMIT),
    client.from("appointments").select("assigned_to, scheduled_at").eq("tenant_id", tenantId).eq("status", "completed")
      .gte("scheduled_at", startIso).lt("scheduled_at", endIso).not("assigned_to", "is", null).limit(ROW_LIMIT),
    client.from("tasks").select("assigned_to, completed_at").eq("tenant_id", tenantId).eq("status", "done")
      .gte("completed_at", startIso).lt("completed_at", endIso).not("assigned_to", "is", null).limit(ROW_LIMIT),
    client.from("surveys").select("agent_id, answered_at, score").eq("tenant_id", tenantId).eq("status", "answered")
      .gte("score", 9).gte("answered_at", startIso).lt("answered_at", endIso).not("agent_id", "is", null).limit(ROW_LIMIT),
    client.from("listing_closures").select("created_by, created_at").eq("tenant_id", tenantId).is("sla_warning_sent_at", null)
      .gte("created_at", startIso).lt("created_at", endIso).not("created_by", "is", null).limit(ROW_LIMIT),

    // ── Ömür boyu rozet sayaçları ────────────────────────────────────────
    client.from("deals").select("assigned_to").eq("tenant_id", tenantId).eq("stage", "won")
      .not("assigned_to", "is", null).limit(ROW_LIMIT),
    client.from("properties").select("assigned_to").eq("tenant_id", tenantId).is("deleted_at", null)
      .not("assigned_to", "is", null).limit(ROW_LIMIT),
    client.from("network_listings").select("created_by").eq("tenant_id", tenantId)
      .not("created_by", "is", null).limit(ROW_LIMIT),

    // ── Seri (streak) pencereleri: yalnız tarih kolonları ────────────────
    client.from("deals").select("assigned_to, updated_at").eq("tenant_id", tenantId).eq("stage", "won")
      .gte("updated_at", streakSince).not("assigned_to", "is", null).limit(ROW_LIMIT),
    client.from("appointments").select("assigned_to, scheduled_at").eq("tenant_id", tenantId).eq("status", "completed")
      .gte("scheduled_at", streakSince).not("assigned_to", "is", null).limit(ROW_LIMIT),
    client.from("tasks").select("assigned_to, completed_at").eq("tenant_id", tenantId).eq("status", "done")
      .gte("completed_at", streakSince).not("assigned_to", "is", null).limit(ROW_LIMIT),
    client.from("properties").select("assigned_to, created_at").eq("tenant_id", tenantId).is("deleted_at", null)
      .gte("created_at", streakSince).not("assigned_to", "is", null).limit(ROW_LIMIT),
  ]);

  // ── Yarışan danışman listesi ────────────────────────────────────────────
  const agents: LeagueAgent[] = rowsOf(profilesRes)
    .filter((p) => LEAGUE_ROLES.includes(String(p.role) as (typeof LEAGUE_ROLES)[number]))
    .filter((p) => (opts.branchId ? str(p.branch_id) === opts.branchId : true))
    .map((p) => ({
      id: String(p.id),
      fullName: String(p.full_name ?? "—"),
      role: String(p.role ?? "advisor"),
      branchId: str(p.branch_id),
    }));
  const agentIds = new Set(agents.map((a) => a.id));

  // ── Aktivite satırları → saf hesap katmanının beklediği şekil ───────────
  const activity: ActivityRow[] = [];
  const push = (rows: Row[], staffKey: string, atKey: string, kind: ActivityRow["kind"]) => {
    for (const r of rows) {
      const staffId = str(r[staffKey]);
      if (!staffId || !agentIds.has(staffId)) continue;
      activity.push({ staffId, kind, at: String(r[atKey] ?? "") });
    }
  };
  push(rowsOf(dealsRes), "assigned_to", "updated_at", "deal_won");
  push(rowsOf(propsRes), "assigned_to", "created_at", "property_new");
  push(rowsOf(apptRes), "assigned_to", "scheduled_at", "appointment_done");
  push(rowsOf(tasksRes), "assigned_to", "completed_at", "task_done");
  push(rowsOf(surveysRes), "agent_id", "answered_at", "nps_promoter");
  push(rowsOf(closuresRes), "created_by", "created_at", "leak_sla_response");

  const scores = computeAgentScores(activity);
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
  collectDays(rowsOf(streakDealsRes), "assigned_to", "updated_at");
  collectDays(rowsOf(streakApptRes), "assigned_to", "scheduled_at");
  collectDays(rowsOf(streakTasksRes), "assigned_to", "completed_at");
  collectDays(rowsOf(streakPropsRes), "assigned_to", "created_at");

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
  const dealsAll = countBy(rowsOf(dealsAllRes), "assigned_to");
  const propsAll = countBy(rowsOf(propsAllRes), "assigned_to");
  const networkAll = countBy(rowsOf(networkRes), "created_by");

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
        dealCountAllTime: dealsAll.get(r.staffId) ?? 0,
        propertyCountAllTime: propsAll.get(r.staffId) ?? 0,
        networkShareCount: networkAll.get(r.staffId) ?? 0,
        // İlk yanıt süresi ölçümü henüz tek bir kaynakta tutulmuyor
        // (çağrı/mesaj/talep ayrı akışlar). Ölçemediğimiz için null
        // bırakıyoruz — "Hız Ustası" rozeti sahte veriyle dağıtılmaz.
        avgFirstResponseMin: null,
        streakDays: streakById.get(r.staffId) ?? 0,
        rank: r.rank,
        score: r.total,
      }),
    );
  }

  return { range, agents, ranked, statsById, streakById };
}
