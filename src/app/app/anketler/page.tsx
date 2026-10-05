import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Gauge, Headphones, MessageSquareQuote, SearchX, Star, TrendingDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow, type StatRowItem } from "@/components/ui/stat-row";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buildHref, mergeParams, type ParamRecord } from "@/lib/ui/filter-params";
import { formatDateTr } from "@/lib/format";
import { now } from "@/lib/clock";
import { isSurveyModuleReady, loadSurveySettings } from "@/lib/surveys/server";
import {
  averageScore,
  breakdownByAgent,
  breakdownByEvent,
  isOverdue,
  isLowScore,
  reasonDistribution,
  responseRate,
  type StatTask,
} from "@/lib/surveys/logic";
import {
  EVENT_LABELS,
  SURVEY_EVENT_TYPES,
  STATUS_LABELS,
  isSurveyEventType,
  isSurveyStatus,
  type SurveyTaskStatus,
} from "@/lib/surveys/types";
import { SurveyNav, SurveyNotReady } from "./survey-nav";

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
  customer_id: string | null;
  property_id: string | null;
  contact_name: string | null;
  event_summary: string | null;
  completed_at: string | null;
  created_at: string;
  answered_via: string | null;
  due_at: string;
  next_attempt_at: string | null;
  customer: { id: string; full_name: string | null } | { id: string; full_name: string | null }[] | null;
};

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return (Array.isArray(v) ? v[0] : v) ?? null;
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
 * Anket sonuçları: cevaplama oranı, ortalama puan, olay türü kırılımı, neden dağılımı ve danışman bazlı ortalama.
 * Her sayı filtrelenmiş listeye gider. Danışmanlar yalnız kendi (ya da kendilerine atanan) anketlerini görür;
 * danışman kırılımı yalnız ofis geneli kapsamlı rollere gösterilir. Yeterli veri yokken açık boş durum.
 */
export default async function SurveyResultsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireModulePage("surveys", "/app/anketler");
  const sp = await searchParams;
  const supabase = await createClient();

  const header = (
    <PageHeader
      eyebrow="Anketler"
      title="Anket sonuçları"
      description="Yayından kalkan, uzayan ve işlem gören işlemlerde müşterilere sorulan anketlerin sonuçları. Her sayı ilgili listeye gider."
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

  let taskQuery = supabase
    .from("survey_tasks")
    .select(
      "id, event_type, status, score, agent_id, assigned_to, customer_id, property_id, contact_name, event_summary, completed_at, created_at, answered_via, due_at, next_attempt_at, customer:customers!survey_tasks_customer_id_fkey(id, full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(2000);
  if (!officeWide) taskQuery = taskQuery.or(`agent_id.eq.${ctx.userId},assigned_to.eq.${ctx.userId}`);

  const [{ data: taskData }, { data: reasonData }, { data: profiles }] = await Promise.all([
    taskQuery,
    supabase.from("survey_answers").select("task_id, tag, value_text").eq("tag", "reason").limit(8000),
    supabase.from("profiles").select("id, full_name").limit(500),
  ]);
  const tasks = (taskData ?? []) as unknown as TaskRow[];
  const taskIdSet = new Set(tasks.map((t) => t.id));
  const reasonAnswers = (reasonData ?? []).filter((a) => taskIdSet.has(String(a.task_id))).map((a) => ({
    task_id: String(a.task_id),
    tag: a.tag as string | null,
    value_text: a.value_text as string | null,
  }));
  const agentName = new Map((profiles ?? []).map((p) => [String(p.id), String(p.full_name ?? "Danışman")]));

  const nowMs = now();
  const pending = tasks.filter((t) => t.status === "pending");
  const overdue = pending.filter((t) => isOverdue(t, nowMs, settings.overdue_hours));
  const low = tasks.filter((t) => t.status === "completed" && isLowScore(t.score, settings.low_score_max));
  const rate = responseRate(tasks);
  const avg = averageScore(tasks);
  const byEvent = breakdownByEvent(tasks);
  const reasons = reasonDistribution(reasonAnswers);
  const byAgent = officeWide ? breakdownByAgent(tasks).filter((a) => a.completed > 0 || a.total > 0) : [];

  /* ------------------------------------------------------------- filtreler */
  const params: ParamRecord = {
    olay: one(sp.olay),
    durum: one(sp.durum),
    puan: one(sp.puan),
    neden: one(sp.neden),
    danisman: one(sp.danisman),
    page: one(sp.page),
  };
  const olay = isSurveyEventType(params.olay) ? params.olay : "";
  const durum = typeof params.durum === "string" ? DURUM_PARAM[params.durum] : undefined;
  const puan = params.puan === "dusuk" ? "dusuk" : "";
  const neden = typeof params.neden === "string" ? params.neden : "";
  const danisman = typeof params.danisman === "string" ? params.danisman : "";
  const reasonTaskIds = neden ? new Set(reasonAnswers.filter((a) => a.value_text === neden).map((a) => a.task_id)) : null;

  const filtered = tasks.filter((t) => {
    if (olay && t.event_type !== olay) return false;
    if (durum === "kapanan" ? !["completed", "refused", "unreachable"].includes(t.status) : durum && t.status !== durum) return false;
    if (puan === "dusuk" && !(t.status === "completed" && isLowScore(t.score, settings.low_score_max))) return false;
    if (reasonTaskIds && !reasonTaskIds.has(t.id)) return false;
    if (danisman && (t.agent_id ?? "") !== (danisman === "atanmamis" ? "" : danisman)) return false;
    return true;
  });
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const answerMap = new Map<string, { label: string; value: string }[]>();
  if (rows.length > 0) {
    const { data: answers } = await supabase
      .from("survey_answers")
      .select("task_id, question_label, value_num, value_text, created_at")
      .in("task_id", rows.map((r) => r.id))
      .order("created_at", { ascending: true });
    for (const a of answers ?? []) {
      const id = String(a.task_id);
      const value = a.value_text ? String(a.value_text) : a.value_num !== null ? String(a.value_num) : "";
      answerMap.set(id, [...(answerMap.get(id) ?? []), { label: String(a.question_label), value }]);
    }
  }

  const link = (patch: ParamRecord) => buildHref(BASE, mergeParams(params, patch));
  const chips: { label: string; clear: string }[] = [];
  if (olay) chips.push({ label: EVENT_LABELS[olay], clear: link({ olay: "" }) });
  if (durum) chips.push({ label: durum === "kapanan" ? "Kapanan" : STATUS_LABELS[durum], clear: link({ durum: "" }) });
  if (puan) chips.push({ label: `Düşük puan (${settings.low_score_max} ve altı)`, clear: link({ puan: "" }) });
  if (neden) chips.push({ label: `Neden: ${neden}`, clear: link({ neden: "" }) });
  if (danisman) chips.push({ label: danisman === "atanmamis" ? "Danışmansız" : `Danışman: ${agentName.get(danisman) ?? "Danışman"}`, clear: link({ danisman: "" }) });

  const stats: StatRowItem[] = [
    { label: "Toplam görev", value: tasks.length, href: BASE, icon: <Gauge />, hint: "tüm anketler" },
    { label: "Bekleyen", value: pending.length, href: "/app/anketler/kuyruk?durum=bekleyen", icon: <Clock />, hint: "kuyrukta" },
    { label: "Geciken", value: overdue.length, href: "/app/anketler/kuyruk?durum=geciken", icon: <AlertTriangle />, attention: true, hint: `${settings.overdue_hours} saat+` },
    { label: "Cevaplama oranı", value: rate === null ? "—" : `%${rate}`, href: link({ durum: "kapanan", olay: "", puan: "", neden: "", danisman: "" }), icon: <CheckCircle2 />, hint: "kapanan görevler içinde" },
    { label: "Ortalama puan", value: avg === null ? "—" : avg.toLocaleString("tr-TR"), href: link({ durum: "tamamlandi", olay: "", puan: "", neden: "", danisman: "" }), icon: <Star />, hint: "1-10 ölçeği" },
    { label: "Düşük puan", value: low.length, href: link({ puan: "dusuk", olay: "", durum: "", neden: "", danisman: "" }), icon: <TrendingDown />, attention: true, hint: "geri arama önerisi" },
  ];

  const lostCount = byEvent.filter((b) => b.event === "deal_lost" || b.event === "demand_lost").reduce((n, b) => n + b.total, 0);

  return (
    <div className="space-y-5">
      {header}
      <SurveyNav current="sonuclar" />
      <StatRow items={stats} label="Anket özeti" />

      {tasks.length === 0 ? (
        <EmptyState
          icon={MessageSquareQuote}
          title="Henüz anket görevi yok"
          description="Tetikleyicileri açtığınızda yayından kalkan, uzayan veya işlem gören her olay için anketör kuyruğuna görev düşer. Veri oluşana kadar puan ve oran gösterilmez."
          action={{ href: "/app/anketler/ayarlar", label: "Tetikleyicileri aç" }}
        />
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="font-display font-bold text-ink-950">Olay türüne göre</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                      <th className="py-2 pr-3">Olay</th>
                      <th className="py-2 pr-3 text-right">Görev</th>
                      <th className="py-2 pr-3 text-right">Cevap</th>
                      <th className="py-2 pr-3 text-right">Oran</th>
                      <th className="py-2 text-right">Ort.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byEvent.map((b) => (
                      <tr key={b.event} className="border-b border-line/60 last:border-0">
                        <td className="py-2.5 pr-3 font-semibold text-ink-950">
                          <Link href={link({ olay: b.event })} className="focus-ring rounded-[var(--radius-control)] underline-offset-2 hover:underline">
                            {EVENT_LABELS[b.event]}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{b.total}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{b.completed}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{b.rate === null ? "—" : `%${b.rate}`}</td>
                        <td className="py-2.5 text-right tabular-nums">{b.avg === null ? "—" : b.avg.toLocaleString("tr-TR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="font-display font-bold text-ink-950">En çok görülen nedenler</h2>
              {reasons.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-muted">
                  Henüz neden cevabı yok. Anketörler neden sorusunu cevapladıkça dağılım burada oluşur.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {reasons.slice(0, 8).map((r) => {
                    const max = reasons[0]?.count ?? 1;
                    return (
                      <li key={r.reason}>
                        <Link href={link({ neden: r.reason })} className="focus-ring block rounded-[var(--radius-control)] p-1.5 hover:bg-surface-hover">
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
                <Link href={link({ olay: "deal_lost" })} className="focus-ring rounded-[var(--radius-control)] font-semibold text-brand-700 underline-offset-2 hover:underline">
                  Kayıp anketleri ({lostCount})
                </Link>
              </div>
            </section>
          </div>

          {officeWide ? (
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="font-display font-bold text-ink-950">Danışman bazlı ortalama</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                      <th className="py-2 pr-3">Danışman</th>
                      <th className="py-2 pr-3 text-right">Görev</th>
                      <th className="py-2 pr-3 text-right">Cevap</th>
                      <th className="py-2 text-right">Ort. puan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byAgent.map((a) => (
                      <tr key={a.agentId ?? "yok"} className="border-b border-line/60 last:border-0">
                        <td className="py-2.5 pr-3 font-semibold text-ink-950">
                          <Link href={link({ danisman: a.agentId ?? "atanmamis" })} className="focus-ring rounded-[var(--radius-control)] underline-offset-2 hover:underline">
                            {a.agentId ? (agentName.get(a.agentId) ?? "Danışman") : "Danışmansız"}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{a.total}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{a.completed}</td>
                        <td className="py-2.5 text-right tabular-nums">{a.avg === null ? "—" : a.avg.toLocaleString("tr-TR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section id="liste" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display font-bold text-ink-950">Anket listesi</h2>
              <span className="text-xs text-text-muted">{filtered.length} kayıt</span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                {SURVEY_EVENT_TYPES.map((e) => (
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
                  title="Bu filtreyle anket bulunamadı"
                  description="Filtreleri kaldırarak tüm anketleri görebilirsiniz."
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
                            {t.event_summary ? ` · ${t.event_summary}` : ""}
                            {t.agent_id ? ` · ${agentName.get(t.agent_id) ?? "Danışman"}` : ""}
                          </p>
                        </div>
                        <Badge variant={STATUS_TONE[status]} size="sm">
                          {STATUS_LABELS[status]}
                        </Badge>
                        <span className="text-xs text-text-faint">
                          {t.completed_at ? formatDateTr(t.completed_at, { dateStyle: "medium" }) : formatDateTr(t.created_at, { dateStyle: "medium" })}
                          {t.answered_via === "link" ? " · bağlantıyla" : t.answered_via === "phone" ? " · telefonla" : ""}
                        </span>
                      </div>
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
                  <Link href={link({ page: String(current - 1) })} className="focus-ring rounded-[var(--radius-control)] font-semibold text-brand-700">
                    ← Önceki
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-text-muted">
                  Sayfa {current} / {pageCount}
                </span>
                {current < pageCount ? (
                  <Link href={link({ page: String(current + 1) })} className="focus-ring rounded-[var(--radius-control)] font-semibold text-brand-700">
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
