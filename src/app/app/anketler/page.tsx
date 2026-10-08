import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import Link from "@/components/ui/smart-link";
import { AlertTriangle, CheckCircle2, Clock, Gauge, Headphones, MessageSquareQuote, SearchX, Smile, TrendingDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow, type StatRowItem } from "@/components/ui/stat-row";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buildHref, mergeParams, type ParamRecord } from "@/lib/ui/filter-params";
import { formatDateTr } from "@/lib/format";
import { now, trMonthKey, trMonthStartMsFromKey } from "@/lib/clock";
import { isSurveyModuleReady, loadSurveySettings } from "@/lib/surveys/server";
import {
  breakdownByAgent,
  breakdownByAudienceGroup,
  breakdownByEventAudience,
  customerScores,
  isOverdue,
  isLowScore,
  monthlyTrend,
  reasonDistribution,
  responseRate,
  scoreStats,
  type ScoreStats,
  type StatTask,
} from "@/lib/surveys/logic";
import {
  AUDIENCE_GROUPS,
  AUDIENCE_LABELS,
  EVENT_LABELS,
  SURVEY_EVENT_TYPES,
  STATUS_LABELS,
  isSurveyAudience,
  isSurveyEventType,
  isSurveyStatus,
  type SurveyTaskStatus,
} from "@/lib/surveys/types";
import { SurveyNav, SurveyNotReady } from "./survey-nav";
import { LowScoreCloseForm } from "./low-score-close-form";

const PAGE_SIZE = 20;
const BASE = "/app/anketler";

/** URL değeri (Türkçe, sade) -> veritabanı durumu. */
const DURUM_PARAM: Record<string, SurveyTaskStatus | "kapanan"> = {
  bekleyen: "pending",
  tamamlandi: "completed",
  reddetti: "refused",
  ulasilamadi: "unreachable",
  iptal: "cancelled",
  kapanan: "kapanan",
};

const STATUS_TONE: Record<SurveyTaskStatus, BadgeVariant> = {
  pending: "warning",
  completed: "success",
  refused: "danger",
  unreachable: "neutral",
  cancelled: "outline",
};

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

type TaskRow = StatTask & {
  deal_id: string | null;
  customer_id: string | null;
  property_id: string | null;
  contact_name: string | null;
  event_summary: string | null;
  completed_at: string | null;
  created_at: string;
  answered_via: string | null;
  due_at: string;
  next_attempt_at: string | null;
  low_score_handled: boolean | null;
  customer: { id: string; full_name: string | null } | { id: string; full_name: string | null }[] | null;
};

type FollowRow = {
  id: string;
  followup_task_id: string | null;
  escalation_level: number | null;
  low_score_note: string | null;
  low_score_handled_at: string | null;
  low_score_handled_by: string | null;
};

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

function npsText(s: ScoreStats | null): string {
  return s === null ? "—" : String(s.nps);
}
function npsTone(s: ScoreStats | null): string {
  if (!s) return "text-text-faint";
  return s.nps >= 30 ? "text-[color:var(--viz-pos)]" : s.nps >= 0 ? "text-amber-600" : "text-danger-500";
}

function monthLabel(key: string): string {
  const ms = trMonthStartMsFromKey(key);
  if (!Number.isFinite(ms)) return key;
  return new Intl.DateTimeFormat("tr-TR", { month: "short", year: "2-digit", timeZone: "Europe/Istanbul" }).format(ms);
}

function ScoreChip({ score, low }: { score: number | null; low: boolean }) {
  if (score === null) return <span className="text-xs text-text-faint">Puan yok</span>;
  return (
    <span
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-sm font-extrabold tabular-nums ${
        low ? "bg-danger-500/10 text-danger-500" : score <= 8 ? "bg-amber-500/12 text-amber-600" : "bg-mint-500/12 text-mint-600"
      }`}
    >
      {score}
    </span>
  );
}

/**
 * Anket sonuçları (tek ölçek 0-10): NPS (9-10 destekleyen, 0-6 kötüleyen), CSAT (7-10 oranı), cevaplama oranı;
 * kitle grubu, olay × kitle ve danışman kırılımı (danışman puanı dahil), 6 aylık trend ve düşük puan takibi
 * (açık takipler aksiyon notuyla kapatılır, kapananlar kapanış raporunda). Her sayı filtrelenmiş listeye gider.
 * Danışmanlar yalnız kendi (ya da kendilerine atanan) anketlerini görür; danışman kırılımı yalnız ofis geneli rollerde.
 * Ekip nabzı (anonim iç anket) bu sayfaya karışmaz: kendi sekmesi.
 */
export default async function SurveyResultsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireModulePage("surveys", "/app/anketler");
  const sp = await searchParams;
  const supabase = await createClient();

  const header = (
    <PageHeader
      eyebrow="Anketler"
      title="Anket sonuçları"
      description="Kapanış, yetki, gösterim, kira ve kayıp olaylarında sorulan anketler. 0-10 ölçeği; her sayı ilgili listeye gider."
    />
  );

  if (!(await isSurveyModuleReady(supabase))) {
    return (
      <div className="space-y-5">
        {header}
        <SurveyNav current="sonuclar" />
        <SurveyNotReady />
      </div>
    );
  }

  const officeWide = hasOfficeWideDataScope(ctx.role);
  const settings = await loadSurveySettings(supabase, ctx.tenantId ?? "");

  // PostgREST max_rows (1000) sınırı: gösterilen sayılar gerçek olsun diye sayfalı okunur (fetchAllRows).
  const taskPage = (from: number, to: number) => {
    let q = supabase
      .from("survey_tasks")
      .select(
        "id, event_type, audience, status, score, agent_id, assigned_to, deal_id, customer_id, property_id, contact_name, event_summary, completed_at, created_at, answered_via, due_at, next_attempt_at, low_score_handled, customer:customers!survey_tasks_customer_id_fkey(id, full_name)",
      )
      .neq("event_type", "advisor_pulse")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
    if (!officeWide) q = q.or(`agent_id.eq.${ctx.userId},assigned_to.eq.${ctx.userId}`);
    return q.range(from, to);
  };

  const [taskRes, answerRes, { data: profiles }] = await Promise.all([
    fetchAllRows(taskPage),
    fetchAllRows((from, to) =>
      supabase
        .from("survey_answers")
        .select("task_id, tag, value_text, value_num")
        .in("tag", ["reason", "advisor"])
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase.from("profiles").select("id, full_name").limit(500),
  ]);
  assertQueryBatchSucceeded([taskRes, answerRes], ["survey-tasks", "survey-answers"], "Anketler");
  const taskData = taskRes.data;
  const answerData = answerRes.data;
  const tasks = (taskData ?? []) as unknown as TaskRow[];
  const taskIdSet = new Set(tasks.map((t) => t.id));
  const visibleAnswers = (answerData ?? []).filter((a) => taskIdSet.has(String(a.task_id)));
  const reasonAnswers = visibleAnswers
    .filter((a) => a.tag === "reason")
    .map((a) => ({ task_id: String(a.task_id), tag: a.tag as string | null, value_text: a.value_text as string | null }));
  const advisorScoreByTask = new Map<string, number>();
  for (const a of visibleAnswers) if (a.tag === "advisor" && a.value_num !== null) advisorScoreByTask.set(String(a.task_id), Number(a.value_num));
  const agentName = new Map((profiles ?? []).map((p) => [String(p.id), String(p.full_name ?? "Danışman")]));

  const nowMs = now();
  const pending = tasks.filter((t) => t.status === "pending");
  const overdue = pending.filter((t) => isOverdue(t, nowMs, settings.overdue_hours));
  const lowAll = tasks.filter((t) => t.status === "completed" && isLowScore(t.score, settings.low_score_max));
  const lowOpen = lowAll.filter((t) => t.low_score_handled !== true);
  const lowClosed = lowAll.filter((t) => t.low_score_handled === true);
  const rate = responseRate(tasks);
  const overall = scoreStats(customerScores(tasks));
  const groups = breakdownByAudienceGroup(tasks);
  const eventAudience = breakdownByEventAudience(tasks);
  const trend = monthlyTrend(tasks, nowMs, 6);
  const reasons = reasonDistribution(reasonAnswers);
  const byAgent = officeWide ? breakdownByAgent(tasks).filter((a) => a.total > 0) : [];

  /* ------------------------------------------------------------- filtreler */
  const params: ParamRecord = {
    olay: one(sp.olay),
    kitle: one(sp.kitle),
    muhatap: one(sp.muhatap),
    durum: one(sp.durum),
    puan: one(sp.puan),
    neden: one(sp.neden),
    danisman: one(sp.danisman),
    ay: one(sp.ay),
    takip: one(sp.takip),
    page: one(sp.page),
  };
  const olay = isSurveyEventType(params.olay) ? params.olay : "";
  const group = AUDIENCE_GROUPS.find((g) => g.id === params.kitle) ?? null;
  const muhatap = isSurveyAudience(params.muhatap) ? params.muhatap : "";
  const durum = typeof params.durum === "string" ? DURUM_PARAM[params.durum] : undefined;
  const puan = params.puan === "dusuk" ? "dusuk" : params.puan === "destekleyen" ? "destekleyen" : "";
  const neden = typeof params.neden === "string" ? params.neden : "";
  const danisman = typeof params.danisman === "string" ? params.danisman : "";
  const ay = typeof params.ay === "string" && /^\d{4}-\d{2}$/.test(params.ay) ? params.ay : "";
  const takip = params.takip === "acik" || params.takip === "kapanan" ? params.takip : "";
  const reasonTaskIds = neden ? new Set(reasonAnswers.filter((a) => a.value_text === neden).map((a) => a.task_id)) : null;

  const filtered = tasks.filter((t) => {
    if (olay && t.event_type !== olay) return false;
    if (group && !(group.audiences as readonly string[]).includes(String(t.audience ?? ""))) return false;
    if (muhatap && t.audience !== muhatap) return false;
    if (durum === "kapanan" ? !["completed", "refused", "unreachable"].includes(t.status) : durum && t.status !== durum) return false;
    if (puan === "dusuk" && !(t.status === "completed" && isLowScore(t.score, settings.low_score_max))) return false;
    if (puan === "destekleyen" && !(t.status === "completed" && t.score !== null && t.score >= 9)) return false;
    if (reasonTaskIds && !reasonTaskIds.has(t.id)) return false;
    if (danisman && (t.agent_id ?? "") !== (danisman === "atanmamis" ? "" : danisman)) return false;
    if (ay && !(t.completed_at && trMonthKey(Date.parse(t.completed_at)) === ay)) return false;
    if (takip === "acik" && !(t.status === "completed" && isLowScore(t.score, settings.low_score_max) && t.low_score_handled !== true)) return false;
    if (takip === "kapanan" && !(t.status === "completed" && isLowScore(t.score, settings.low_score_max) && t.low_score_handled === true)) return false;
    return true;
  });
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const answerMap = new Map<string, { label: string; value: string }[]>();
  const followMap = new Map<string, FollowRow>();
  const lowIdsOnPage = rows.filter((r) => r.status === "completed" && isLowScore(r.score, settings.low_score_max)).map((r) => r.id);
  if (rows.length > 0) {
    const [{ data: answers }, { data: follow }] = await Promise.all([
      supabase
        .from("survey_answers")
        .select("task_id, question_label, value_num, value_text, created_at")
        .in("task_id", rows.map((r) => r.id))
        .order("created_at", { ascending: true }),
      // Düşük puan zinciri sütunları (PB49): sütun yoksa hata = boş, sayfa eski haliyle çalışır.
      lowIdsOnPage.length
        ? supabase
            .from("survey_tasks")
            .select("id, followup_task_id, escalation_level, low_score_note, low_score_handled_at, low_score_handled_by")
            .in("id", lowIdsOnPage)
        : Promise.resolve({ data: [] as FollowRow[] }),
    ]);
    for (const a of answers ?? []) {
      const id = String(a.task_id);
      const value = a.value_text ? String(a.value_text) : a.value_num !== null ? String(a.value_num) : "";
      answerMap.set(id, [...(answerMap.get(id) ?? []), { label: String(a.question_label), value }]);
    }
    for (const f of (follow ?? []) as FollowRow[]) followMap.set(String(f.id), f);
  }

  const link = (patch: ParamRecord) => buildHref(BASE, mergeParams(params, { page: "", ...patch }));
  const clearAll = { olay: "", kitle: "", muhatap: "", durum: "", puan: "", neden: "", danisman: "", ay: "", takip: "" };
  const chips: { label: string; clear: string }[] = [];
  if (olay) chips.push({ label: EVENT_LABELS[olay], clear: link({ olay: "" }) });
  if (group) chips.push({ label: `Kitle: ${group.label}`, clear: link({ kitle: "" }) });
  if (muhatap) chips.push({ label: AUDIENCE_LABELS[muhatap], clear: link({ muhatap: "" }) });
  if (durum) chips.push({ label: durum === "kapanan" ? "Kapanan" : STATUS_LABELS[durum], clear: link({ durum: "" }) });
  if (puan) chips.push({ label: puan === "dusuk" ? `Düşük puan (${settings.low_score_max} ve altı)` : "Destekleyen (9-10)", clear: link({ puan: "" }) });
  if (neden) chips.push({ label: `Neden: ${neden}`, clear: link({ neden: "" }) });
  if (danisman) chips.push({ label: danisman === "atanmamis" ? "Danışmansız" : `Danışman: ${agentName.get(danisman) ?? "Danışman"}`, clear: link({ danisman: "" }) });
  if (ay) chips.push({ label: `Ay: ${monthLabel(ay)}`, clear: link({ ay: "" }) });
  if (takip) chips.push({ label: takip === "acik" ? "Açık düşük puan takibi" : "Kapanan takipler", clear: link({ takip: "" }) });

  const stats: StatRowItem[] = [
    { label: "Bekleyen", value: pending.length, href: "/app/anketler/kuyruk?durum=bekleyen", icon: <Clock />, hint: "kuyrukta" },
    { label: "Geciken", value: overdue.length, href: "/app/anketler/kuyruk?durum=geciken", icon: <AlertTriangle />, attention: true, hint: `${settings.overdue_hours} saat+` },
    { label: "Cevaplama oranı", value: rate === null ? "—" : `%${rate}`, href: link({ ...clearAll, durum: "kapanan" }), icon: <CheckCircle2 />, hint: "kapanan görevler içinde" },
    {
      label: "NPS",
      value: npsText(overall),
      href: link({ ...clearAll, durum: "tamamlandi" }) + "#kitle",
      icon: <Gauge />,
      hint: overall ? `${overall.promoters} destekleyen · ${overall.detractors} kötüleyen` : "0-10 ölçeği, veri yok",
    },
    { label: "Memnuniyet (CSAT)", value: overall ? `%${overall.csat}` : "—", href: link({ ...clearAll, durum: "tamamlandi" }), icon: <Smile />, hint: "7-10 veren oranı" },
    { label: "Açık düşük puan", value: lowOpen.length, href: link({ ...clearAll, takip: "acik" }) + "#liste", icon: <TrendingDown />, attention: true, hint: "aksiyon notu bekliyor" },
  ];

  const lostCount = eventAudience.filter((b) => b.event === "deal_lost" || b.event === "demand_lost").reduce((n, b) => n + b.total, 0);

  return (
    <div className="space-y-5">
      {header}
      <SurveyNav current="sonuclar" />
      <StatRow items={stats} label="Anket özeti" />

      {tasks.length === 0 ? (
        <EmptyState
          icon={MessageSquareQuote}
          title="Henüz anket görevi yok"
          description="Tetikleyicileri açtığınızda seçtiğiniz olay ve kitlelerde anketör kuyruğuna görev düşer. Veri oluşana kadar NPS ve oran gösterilmez."
          action={{ href: "/app/anketler/ayarlar", label: "Tetikleyicileri aç" }}
        />
      ) : (
        <>
          <section id="kitle" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="font-display font-bold text-ink-950">Kitle bazlı NPS ve memnuniyet</h2>
            <p className="mt-1 text-xs text-text-muted">NPS = %destekleyen (9-10) − %kötüleyen (0-6). CSAT = 7-10 veren oranı. Satıcı/malik cevapları dahildir.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {groups.map((g) => (
                <Link
                  key={g.id}
                  href={link({ ...clearAll, kitle: g.id }) + "#liste"}
                  className="focus-ring press lift block rounded-[var(--radius-card)] border border-line bg-canvas/40 p-4 transition hover:border-border-interactive"
                >
                  <span className="text-xs font-semibold text-text-muted">{g.label}</span>
                  <span className={`numeric mt-1 block font-display text-xl font-extrabold ${npsTone(g.stats)}`}>{npsText(g.stats)}</span>
                  <span className="block text-xs text-text-faint">
                    {g.stats ? `${g.stats.n} cevap · CSAT %${g.stats.csat} · ort. ${g.stats.avg.toLocaleString("tr-TR")}` : `${g.total} görev · cevap yok`}
                  </span>
                </Link>
              ))}
            </div>
            <div className="mt-4">
              <h3 className="text-sm font-bold text-ink-950">Son 6 ay</h3>
              <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {trend.map((p) => (
                  <li key={p.month}>
                    <Link
                      href={link({ ...clearAll, ay: p.month, durum: "tamamlandi" }) + "#liste"}
                      className="focus-ring block rounded-[var(--radius-control)] border border-line px-2 py-2 text-center hover:border-brand-400"
                    >
                      <span className="block text-xs text-text-muted">{monthLabel(p.month)}</span>
                      <span className={`block font-display text-base font-extrabold tabular-nums ${npsTone(p.stats)}`}>{npsText(p.stats)}</span>
                      <span className="block text-xs text-text-faint">{p.stats ? `${p.stats.n} cevap` : "veri yok"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="font-display font-bold text-ink-950">Olay × kitle</h2>
              <div className="mt-3 overflow-x-auto">
                <Table className="w-full text-sm">
                  <THead>
                    <TR className="border-b border-line text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                      <TH className="py-2 pr-3">Olay / kitle</TH>
                      <TH className="py-2 pr-3 text-right">Görev</TH>
                      <TH className="py-2 pr-3 text-right">Cevap</TH>
                      <TH className="py-2 pr-3 text-right">NPS</TH>
                      <TH className="py-2 text-right">Ort.</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {eventAudience.map((b) => (
                      <TR key={`${b.event}:${b.audience}`} className="border-b border-line/60 last:border-0">
                        <TD className="py-2.5 pr-3 font-semibold text-ink-950">
                          <Link href={link({ ...clearAll, olay: b.event, muhatap: b.audience }) + "#liste"} className="focus-ring rounded-[var(--radius-control)] underline-offset-2 hover:underline">
                            {EVENT_LABELS[b.event]}
                          </Link>
                          <span className="block text-xs font-normal text-text-muted">{AUDIENCE_LABELS[b.audience]}</span>
                        </TD>
                        <TD className="py-2.5 pr-3 text-right tabular-nums">{b.total}</TD>
                        <TD className="py-2.5 pr-3 text-right tabular-nums">{b.completed}</TD>
                        <TD className={`py-2.5 pr-3 text-right font-bold tabular-nums ${npsTone(b.stats)}`}>{npsText(b.stats)}</TD>
                        <TD className="py-2.5 text-right tabular-nums">{b.stats ? b.stats.avg.toLocaleString("tr-TR") : "—"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </section>

            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="font-display font-bold text-ink-950">En çok görülen nedenler</h2>
              {reasons.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-muted">
                  Henüz neden cevabı yok. Neden sorusu cevaplandıkça dağılım burada oluşur.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {reasons.slice(0, 8).map((r) => {
                    const max = reasons[0]?.count ?? 1;
                    return (
                      <li key={r.reason}>
                        <Link href={link({ neden: r.reason }) + "#liste"} className="focus-ring block rounded-[var(--radius-control)] p-1.5 hover:bg-surface-hover">
                          <span className="flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate font-medium text-ink-950">{r.reason}</span>
                            <span className="shrink-0 font-bold tabular-nums text-text">{r.count}</span>
                          </span>
                          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-canvas">
                            <span className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.max(6, Math.round((r.count / max) * 100))}%` }} />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3 text-xs">
                <Link href="/app/kayip-satis" className="focus-ring rounded-[var(--radius-control)] font-semibold text-brand-700 underline-offset-2 hover:underline">
                  Kayıp satış nedenleri
                </Link>
                <span className="text-text-faint">·</span>
                <Link href="/app/kayip-kacak" className="focus-ring rounded-[var(--radius-control)] font-semibold text-brand-700 underline-offset-2 hover:underline">
                  Kaçan komisyonlar
                </Link>
                <span className="text-text-faint">·</span>
                <Link href={link({ ...clearAll, kitle: "kayip" }) + "#liste"} className="focus-ring rounded-[var(--radius-control)] font-semibold text-brand-700 underline-offset-2 hover:underline">
                  Kayıp anketleri ({lostCount})
                </Link>
              </div>
            </section>
          </div>

          {officeWide ? (
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="font-display font-bold text-ink-950">Danışman bazlı</h2>
              <p className="mt-1 text-xs text-text-muted">NPS ilgili danışmanın işlemlerindeki ana puandan, danışman puanı “Danışman puanı” sorusundan hesaplanır.</p>
              <div className="mt-3 overflow-x-auto">
                <Table className="w-full text-sm">
                  <THead>
                    <TR className="border-b border-line text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                      <TH className="py-2 pr-3">Danışman</TH>
                      <TH className="py-2 pr-3 text-right">Görev</TH>
                      <TH className="py-2 pr-3 text-right">Cevap</TH>
                      <TH className="py-2 pr-3 text-right">NPS</TH>
                      <TH className="py-2 pr-3 text-right">CSAT</TH>
                      <TH className="py-2 text-right">Danışman puanı</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {byAgent.map((a) => {
                      const mine = tasks.filter((t) => (t.agent_id ?? null) === a.agentId);
                      const s = scoreStats(customerScores(mine));
                      const adv = scoreStats(mine.map((t) => advisorScoreByTask.get(t.id)).filter((v): v is number => v !== undefined));
                      return (
                        <TR key={a.agentId ?? "yok"} className="border-b border-line/60 last:border-0">
                          <TD className="py-2.5 pr-3 font-semibold text-ink-950">
                            <Link href={link({ ...clearAll, danisman: a.agentId ?? "atanmamis" }) + "#liste"} className="focus-ring rounded-[var(--radius-control)] underline-offset-2 hover:underline">
                              {a.agentId ? (agentName.get(a.agentId) ?? "Danışman") : "Danışmansız"}
                            </Link>
                          </TD>
                          <TD className="py-2.5 pr-3 text-right tabular-nums">{a.total}</TD>
                          <TD className="py-2.5 pr-3 text-right tabular-nums">{a.completed}</TD>
                          <TD className={`py-2.5 pr-3 text-right font-bold tabular-nums ${npsTone(s)}`}>{npsText(s)}</TD>
                          <TD className="py-2.5 pr-3 text-right tabular-nums">{s ? `%${s.csat}` : "—"}</TD>
                          <TD className="py-2.5 text-right tabular-nums">{adv ? `${adv.avg.toLocaleString("tr-TR")} (${adv.n})` : "—"}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
            </section>
          ) : null}

          <section id="liste" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display font-bold text-ink-950">Anket listesi</h2>
              <span className="text-xs text-text-muted">{filtered.length} kayıt</span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                <Link
                  href={link({ takip: takip === "acik" ? "" : "acik" })}
                  className={`focus-ring rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                    takip === "acik" ? "border-danger-500 bg-danger-500 text-white" : "border-line text-text-muted hover:border-danger-500/60"
                  }`}
                >
                  Açık düşük puan ({lowOpen.length})
                </Link>
                <Link
                  href={link({ takip: takip === "kapanan" ? "" : "kapanan" })}
                  className={`focus-ring rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                    takip === "kapanan" ? "border-brand-600 bg-brand-600 text-white" : "border-line text-text-muted hover:border-brand-400"
                  }`}
                >
                  Kapanış raporu ({lowClosed.length})
                </Link>
                {SURVEY_EVENT_TYPES.filter((e) => e !== "advisor_pulse").map((e) => (
                  <Link
                    key={e}
                    href={link({ olay: olay === e ? "" : e })}
                    className={`focus-ring rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                      olay === e ? "border-brand-600 bg-brand-600 text-white" : "border-line text-text-muted hover:border-brand-400"
                    }`}
                  >
                    {EVENT_LABELS[e]}
                  </Link>
                ))}
              </div>
            </div>
            {chips.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {chips.map((c) => (
                  <Link key={c.label} href={c.clear} className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-semibold text-brand-700">
                    {c.label} <span aria-hidden="true">×</span>
                    <span className="sr-only">filtreyi kaldır</span>
                  </Link>
                ))}
                <Link href={BASE} className="focus-ring text-xs font-semibold text-text-muted underline-offset-2 hover:underline">
                  Tümünü temizle
                </Link>
              </div>
            ) : null}

            {rows.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon={SearchX}
                  title={takip === "acik" ? "Açık düşük puan takibi yok" : "Bu filtreyle anket bulunamadı"}
                  description={takip === "acik" ? "Tüm düşük puanlar aksiyon notuyla kapatılmış." : "Filtreleri kaldırarak tüm anketleri görebilirsiniz."}
                  action={{ href: BASE, label: "Filtreleri temizle" }}
                />
              </div>
            ) : (
              <ul className="mt-4 divide-y divide-line">
                {rows.map((t) => {
                  const cust = firstOf(t.customer);
                  const name = cust?.full_name ?? t.contact_name ?? "Kişi bilgisi yok";
                  const href = cust?.id ? `/app/musteriler/${cust.id}` : t.property_id ? `/app/portfoyler/${t.property_id}` : null;
                  const answers = answerMap.get(t.id) ?? [];
                  const lowRow = t.status === "completed" && isLowScore(t.score, settings.low_score_max);
                  const follow = followMap.get(t.id);
                  const status = (isSurveyStatus(t.status) ? t.status : "pending") as SurveyTaskStatus;
                  return (
                    <li key={t.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <ScoreChip score={t.score} low={lowRow} />
                        <div className="min-w-0 flex-1">
                          {href ? (
                            <Link href={href} className="focus-ring rounded-[var(--radius-control)] text-sm font-semibold text-ink-950 underline-offset-2 hover:underline">
                              {name}
                            </Link>
                          ) : (
                            <span className="text-sm font-semibold text-ink-950">{name}</span>
                          )}
                          <p className="text-xs text-text-muted">
                            {isSurveyEventType(t.event_type) ? EVENT_LABELS[t.event_type] : t.event_type}
                            {isSurveyAudience(t.audience) ? ` · ${AUDIENCE_LABELS[t.audience]}` : ""}
                            {t.event_summary ? ` · ${t.event_summary}` : ""}
                            {t.agent_id ? ` · ${agentName.get(t.agent_id) ?? "Danışman"}` : ""}
                          </p>
                        </div>
                        {lowRow ? (
                          t.low_score_handled ? (
                            <Badge variant="success" size="sm">Takip kapandı</Badge>
                          ) : (
                            <Badge variant="danger" size="sm">
                              {follow?.escalation_level === 2 ? "Ofis sahibine iletildi" : follow?.escalation_level === 1 ? "Takım liderine iletildi" : "Takip açık"}
                            </Badge>
                          )
                        ) : null}
                        <Badge variant={STATUS_TONE[status]} size="sm">
                          {STATUS_LABELS[status]}
                        </Badge>
                        <span className="text-xs text-text-faint">
                          {t.completed_at ? formatDateTr(t.completed_at, { dateStyle: "medium" }) : formatDateTr(t.created_at, { dateStyle: "medium" })}
                          {t.answered_via === "link" ? " · bağlantıyla" : t.answered_via === "phone" ? " · telefonla" : ""}
                        </span>
                      </div>
                      {lowRow && t.low_score_handled && follow?.low_score_note ? (
                        <p className="mt-2 rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2 pl-11 text-xs text-text">
                          <span className="font-semibold text-ink-950">Aksiyon notu: </span>
                          {follow.low_score_note}
                          <span className="text-text-faint">
                            {follow.low_score_handled_by ? ` · ${agentName.get(follow.low_score_handled_by) ?? "Kullanıcı"}` : ""}
                            {follow.low_score_handled_at ? ` · ${formatDateTr(follow.low_score_handled_at, { dateStyle: "medium" })}` : ""}
                          </span>
                        </p>
                      ) : null}
                      {lowRow && !t.low_score_handled ? (
                        <div className="mt-2 pl-11">
                          <LowScoreCloseForm taskId={t.id} />
                        </div>
                      ) : null}
                      {answers.length > 0 ? (
                        <details className="mt-2 pl-11">
                          <summary className="focus-ring cursor-pointer text-xs font-semibold text-brand-700">Cevapları gör ({answers.length})</summary>
                          <dl className="mt-2 grid gap-1.5 text-xs">
                            {answers.map((a, i) => (
                              <div key={i} className="grid gap-0.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                                <dt className="text-text-muted">{a.label}</dt>
                                <dd className="font-medium text-ink-950">{a.value || "—"}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {pageCount > 1 ? (
              <nav aria-label="Sayfalama" className="mt-4 flex items-center justify-between text-sm">
                {current > 1 ? (
                  <Link href={buildHref(BASE, mergeParams(params, { page: String(current - 1) }))} className="focus-ring rounded-[var(--radius-control)] font-semibold text-brand-700">
                    ← Önceki
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-text-muted">
                  Sayfa {current} / {pageCount}
                </span>
                {current < pageCount ? (
                  <Link href={buildHref(BASE, mergeParams(params, { page: String(current + 1) }))} className="focus-ring rounded-[var(--radius-control)] font-semibold text-brand-700">
                    Sonraki →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </section>
        </>
      )}

      <p className="flex items-center gap-2 text-xs text-text-muted">
        <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
        Aramaları anketör kuyruğundan yapabilirsiniz.
        <Link href="/app/anketler/kuyruk" className="focus-ring rounded-[var(--radius-control)] font-semibold text-brand-700 underline-offset-2 hover:underline">
          Kuyruğa git
        </Link>
      </p>
    </div>
  );
}
