import type { ReactNode } from "react";
import Link from "next/link";
import { Gauge, HeartPulse, Lock, Smile, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow, type StatRowItem } from "@/components/ui/stat-row";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { now, shiftMonthKey, trMonthStartMsFromKey } from "@/lib/clock";
import { isSurveyModuleReady } from "@/lib/surveys/server";
import { pulseSummary, type StatAnswer } from "@/lib/surveys/logic";
import { PULSE_MIN_RESPONSES } from "@/lib/surveys/types";
import { loadPulseFormState, pulseEligibleRole, pulsePeriod } from "@/lib/surveys/pulse";
import { SurveyNav, SurveyNotReady } from "../survey-nav";
import { PulseForm, type PulseQuestionVM } from "./pulse-form";

const BASE = "/app/anketler/ic-anket";
const TREND_MONTHS = 6;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function monthLabel(key: string): string {
  const ms = trMonthStartMsFromKey(key);
  if (!Number.isFinite(ms)) return key;
  return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(ms);
}

/**
 * Ekip nabzı (danışman iç anketi). Ekip üyesi bu ayın formunu doldurur (anonim, ayda bir). Yönetici (ofis geneli rol +
 * anket görüntüleme) yalnız TOPLU sonucu görür ve yalnız en az PULSE_MIN_RESPONSES cevap varsa; bireysel cevap, tarih
 * veya kişi bilgisi gösterilmez. Dönem filtresi URL'dedir (`?donem=YYYY-MM`).
 */
export default async function AdvisorPulsePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireModulePage("surveys", "/app/anketler");
  const sp = await searchParams;
  const supabase = await createClient();
  const tenantId = ctx.tenantId ?? "";

  const header = (
    <PageHeader
      eyebrow="Anketler"
      title="Ekip nabzı"
      description="Ayda bir, ofis içi memnuniyet ve ihtiyaç anketi. Cevaplar anonimdir; yönetim yalnız toplu sonucu görür."
    />
  );
  if (!(await isSurveyModuleReady(supabase))) {
    return (
      <div className="space-y-5">
        {header}
        <SurveyNav current="ic-anket" />
        <SurveyNotReady />
      </div>
    );
  }

  const nowMs = now();
  const current = pulsePeriod(nowMs);
  const eligible = pulseEligibleRole(ctx.role);
  const isManager = hasOfficeWideDataScope(ctx.role) && effectiveHasPermission(ctx.perms, "surveys", "view");
  const formState = eligible ? await loadPulseFormState(supabase, tenantId, ctx.userId, nowMs) : null;

  const requested = one(sp.donem);
  const periods: string[] = [];
  for (let i = 0; i < TREND_MONTHS; i++) periods.push(shiftMonthKey(current, -i) ?? current);
  const period = periods.includes(requested) ? requested : current;

  let managerView: ReactNode = null;
  if (isManager) {
    const oldest = periods[periods.length - 1] ?? current;
    const fromIso = new Date(trMonthStartMsFromKey(oldest)).toISOString();
    const [{ data: taskRows }, { data: headcountRows }, { data: pulseTemplates }] = await Promise.all([
      supabase
        .from("survey_tasks")
        .select("id, score, event_summary")
        .eq("event_type", "advisor_pulse")
        .eq("status", "completed")
        .gte("event_at", fromIso)
        .limit(5000),
      supabase.from("profiles").select("role").eq("tenant_id", tenantId).eq("is_active", true).limit(1000),
      supabase.from("survey_templates").select("id").eq("tenant_id", tenantId).eq("event_type", "advisor_pulse"),
    ]);
    // Dönem, satırın özetinden ("Ekip nabzı YYYY-MM") okunur: cevap satırında kişi/zaman bilgisi bilerek yoktur.
    const byPeriod = new Map<string, { id: string; score: number | null }[]>();
    for (const r of (taskRows ?? []) as { id: string; score: number | null; event_summary: string | null }[]) {
      const m = /(\d{4}-\d{2})$/.exec(String(r.event_summary ?? ""));
      if (!m) continue;
      byPeriod.set(m[1]!, [...(byPeriod.get(m[1]!) ?? []), { id: String(r.id), score: r.score === null ? null : Number(r.score) }]);
    }
    const headcount = ((headcountRows ?? []) as { role: string }[]).filter((p) => pulseEligibleRole(String(p.role))).length;
    const selected = byPeriod.get(period) ?? [];

    let reasonAnswers: StatAnswer[] = [];
    let comments: string[] = [];
    if (selected.length >= PULSE_MIN_RESPONSES) {
      const templateIds = ((pulseTemplates ?? []) as { id: string }[]).map((t) => String(t.id));
      const { data: textQs } = templateIds.length
        ? await supabase.from("survey_questions").select("id").in("template_id", templateIds).eq("kind", "text")
        : { data: [] as { id: string }[] };
      const textIds = new Set(((textQs ?? []) as { id: string }[]).map((q) => String(q.id)));
      const { data: answerRows } = await supabase
        .from("survey_answers")
        .select("task_id, question_id, tag, value_text")
        .in("task_id", selected.map((s) => s.id))
        .limit(5000);
      const rows = (answerRows ?? []) as { task_id: string; question_id: string | null; tag: string | null; value_text: string | null }[];
      reasonAnswers = rows.filter((a) => a.tag === "reason").map((a) => ({ task_id: String(a.task_id), tag: a.tag, value_text: a.value_text }));
      comments = rows.filter((a) => a.question_id && textIds.has(String(a.question_id)) && a.value_text).map((a) => String(a.value_text));
    }
    const summary = pulseSummary(selected, reasonAnswers, comments);
    const participation = headcount > 0 ? Math.round((selected.length / headcount) * 100) : null;
    const link = (p: string) => `${BASE}?donem=${p}`;

    const stats: StatRowItem[] = [
      { label: "Cevap", value: selected.length, href: `${link(period)}#sonuc`, icon: <Users />, hint: monthLabel(period) },
      { label: "Katılım", value: participation === null ? "—" : `%${participation}`, href: `${link(period)}#sonuc`, icon: <HeartPulse />, hint: `${headcount} kişilik ekip` },
      {
        label: "Ekip NPS",
        value: summary.visible ? String(summary.stats.nps) : "—",
        href: `${link(period)}#sonuc`,
        icon: <Gauge />,
        hint: summary.visible ? `${summary.stats.promoters} destekleyen · ${summary.stats.detractors} kötüleyen` : `en az ${PULSE_MIN_RESPONSES} cevap gerekir`,
      },
      {
        label: "Memnuniyet (CSAT)",
        value: summary.visible ? `%${summary.stats.csat}` : "—",
        href: `${link(period)}#sonuc`,
        icon: <Smile />,
        hint: "7-10 veren oranı",
      },
    ];

    managerView = (
      <>
        <StatRow items={stats} label="Ekip nabzı özeti" />
        <section id="sonuc" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display font-bold text-ink-950">{monthLabel(period)} sonucu</h2>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {periods.map((p) => (
                <Link
                  key={p}
                  href={link(p)}
                  aria-current={p === period ? "page" : undefined}
                  className={`focus-ring rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                    p === period ? "border-brand-600 bg-brand-600 text-white" : "border-line text-text-muted hover:border-brand-400"
                  }`}
                >
                  {monthLabel(p)} · {(byPeriod.get(p) ?? []).length}
                </Link>
              ))}
            </div>
          </div>
          {!summary.visible ? (
            <div className="mt-4">
              <EmptyState
                icon={Lock}
                title={selected.length === 0 ? "Bu dönem cevap yok" : "Sonuç anonimlik için gizli"}
                description={`Kimsenin cevabı tahmin edilemesin diye en az ${PULSE_MIN_RESPONSES} cevap toplanmadan puan, neden ve yorum gösterilmez. Şu an ${selected.length} cevap var.`}
              />
            </div>
          ) : (
            <div className="mt-4 grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-bold text-ink-950">En çok dile getirilen ihtiyaçlar</h3>
                {summary.reasons.length === 0 ? (
                  <p className="mt-2 text-sm text-text-muted">İhtiyaç sorusu cevaplanmamış.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {summary.reasons.map((r) => (
                      <li key={r.reason} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-ink-950">{r.reason}</span>
                        <span className="shrink-0 font-bold tabular-nums">{r.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-text-muted">Ortalama ana puan: {summary.stats.avg.toLocaleString("tr-TR")} / 10</p>
              </div>
              <div>
                <h3 className="text-sm font-bold text-ink-950">Öneriler (anonim, alfabetik)</h3>
                {summary.comments.length === 0 ? (
                  <p className="mt-2 text-sm text-text-muted">Yazılı öneri yok.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {summary.comments.map((c, i) => (
                      <li key={i} className="rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2 text-sm text-text">
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      </>
    );
  }

  const questions: PulseQuestionVM[] =
    formState?.state === "open" ? formState.questions.map((q) => ({ id: q.id, kind: q.kind, label: q.label, options: q.options, required: q.required })) : [];

  return (
    <div className="space-y-5">
      {header}
      <SurveyNav current="ic-anket" />

      {eligible ? (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="font-display font-bold text-ink-950">Bu ayın anketi · {monthLabel(current)}</h2>
          <div className="mt-3">
            {formState?.state === "open" ? (
              <PulseForm questions={questions} />
            ) : formState?.state === "answered" ? (
              <Alert tone="success" title="Bu ayın anketini cevapladınız">
                Teşekkürler. Bir sonraki anket gelecek ay açılır.
              </Alert>
            ) : (
              <p className="text-sm text-text-muted">Ekip nabzı ofisinizde şu an kapalı. Ofis yönetimi Tetikleyiciler sekmesinden açabilir.</p>
            )}
          </div>
        </section>
      ) : null}

      {managerView ?? (
        !eligible ? (
          <EmptyState
            icon={HeartPulse}
            title="Ekip nabzı ekibiniz içindir"
            description="Sonuçları ofis geneli yetkili yöneticiler toplu olarak görür."
            action={{ href: "/app/anketler", label: "Anket sonuçlarına dön" }}
          />
        ) : null
      )}
    </div>
  );
}
