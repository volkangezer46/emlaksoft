import Link from "next/link";
import { Headphones, Lock, PartyPopper } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow, type StatRowItem } from "@/components/ui/stat-row";
import { EmptyState } from "@/components/ui/empty-state";
import { buildHref, mergeParams, type ParamRecord } from "@/lib/ui/filter-params";
import { formatDateTimeTr } from "@/lib/format";
import { formatPhoneDisplay, toTelHref } from "@/lib/phone";
import { now } from "@/lib/clock";
import { isDueNow, isOverdue, isScheduled } from "@/lib/surveys/logic";
import { isSurveyModuleReady, loadAssigneeIds, loadSurveySettings } from "@/lib/surveys/server";
import { EVENT_LABELS, OUTCOME_LABELS, STATUS_LABELS, isSurveyEventType, isSurveyStatus, type SurveyOutcome } from "@/lib/surveys/types";
import { SurveyNav, SurveyNotReady } from "../survey-nav";
import { QueueTaskCard, type AssigneeOption, type QueueQuestionVM, type QueueTaskVM } from "../queue-task-card";

const BASE = "/app/anketler/kuyruk";

type Rel<T> = T | T[] | null;
function firstOf<T>(v: Rel<T> | undefined): T | null {
  if (!v) return null;
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

type Row = {
  id: string;
  event_type: string;
  audience: string;
  event_summary: string | null;
  status: string;
  due_at: string;
  next_attempt_at: string | null;
  attempts: number;
  max_attempts: number;
  assigned_to: string | null;
  agent_id: string | null;
  customer_id: string | null;
  property_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  template_id: string | null;
  last_outcome: string | null;
  customer: Rel<{ id: string; full_name: string | null; phone: string | null }>;
};

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * Anketör kuyruğu. Anketör yalnız kendisine atanan görevleri görür; yönetici (ofis geneli rol + düzenleme izni)
 * hepsini görür, atar ve iptal eder. Her satırda müşteri adı, telefon (biçimli), olay özeti, danışman ve şablon vardır.
 */
export default async function SurveyQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireModulePage("surveys", "/app/anketler");
  const sp = await searchParams;
  const supabase = await createClient();

  const header = (
    <PageHeader
      eyebrow="Anketler"
      title="Anketör kuyruğu"
      description="Vadesi gelen anket görevleri. Müşteriyi arayın, soruları cevaplatın; ulaşılamazsa görev otomatik yeniden planlanır."
    />
  );

  if (!(await isSurveyModuleReady(supabase))) {
    return (
      <div className="space-y-5">
        {header}
        <SurveyNav current="kuyruk" />
        <SurveyNotReady />
      </div>
    );
  }

  const tenantId = ctx.tenantId ?? "";
  const canManage = effectiveHasPermission(ctx.perms, "surveys", "edit") && hasOfficeWideDataScope(ctx.role);
  const canConfigure = effectiveHasPermission(ctx.perms, "surveys", "delete");
  const { data: me } = await supabase.from("survey_assignees").select("user_id").eq("tenant_id", tenantId).eq("user_id", ctx.userId).maybeSingle();
  const isSurveyor = Boolean(me);

  if (!canManage && !isSurveyor) {
    return (
      <div className="space-y-5">
        {header}
        <SurveyNav current="kuyruk" />
        <EmptyState
          icon={Lock}
          title="Bu kuyruk anketörler içindir"
          description={
            canConfigure
              ? "Ayarlar bölümünden bir veya daha fazla kullanıcıyı anketör olarak atayın."
              : "Anketör olarak atanmadığınız için aranacak görev yok. Ofis sahibi sizi anketör olarak atayabilir. Sonuçları Sonuçlar sekmesinden görebilirsiniz."
          }
          action={canConfigure ? { href: "/app/anketler/ayarlar", label: "Anketör ata" } : { href: "/app/anketler", label: "Sonuçlara git" }}
        />
      </div>
    );
  }

  const params: ParamRecord = { durum: one(sp.durum), anketor: one(sp.anketor) };
  const durum = typeof params.durum === "string" && params.durum ? params.durum : "bekleyen";
  const anketor = canManage && typeof params.anketor === "string" ? params.anketor : "";

  const settings = await loadSurveySettings(supabase, tenantId);
  const select =
    "id, event_type, audience, event_summary, status, due_at, next_attempt_at, attempts, max_attempts, assigned_to, agent_id, customer_id, property_id, contact_name, contact_phone, template_id, last_outcome, customer:customers!survey_tasks_customer_id_fkey(id, full_name, phone)";

  const closedView = durum === "kapali";
  // Ekip nabzı (anonim iç anket) kuyruğa girmez.
  let q = supabase.from("survey_tasks").select(select).neq("event_type", "advisor_pulse");
  q = closedView ? q.neq("status", "pending").order("completed_at", { ascending: false, nullsFirst: false }).limit(60) : q.eq("status", "pending").order("due_at", { ascending: true }).limit(1000);
  if (!canManage) q = q.eq("assigned_to", ctx.userId);
  else if (anketor === "atanmamis") q = q.is("assigned_to", null);
  else if (anketor) q = q.eq("assigned_to", anketor);
  const { data: rowData } = await q;
  const rows = (rowData ?? []) as unknown as Row[];

  const nowMs = now();
  const dueRows = rows.filter((r) => isDueNow(r, nowMs));
  const overdueRows = rows.filter((r) => isOverdue(r, nowMs, settings.overdue_hours));
  const scheduledRows = rows.filter((r) => isScheduled(r, nowMs));
  const unassigned = rows.filter((r) => r.assigned_to === null);

  let shown: Row[] = rows;
  if (durum === "simdi") shown = dueRows;
  else if (durum === "geciken") shown = overdueRows;
  else if (durum === "zamanlanmis") shown = scheduledRows;
  else if (durum === "atanmamis") shown = unassigned;

  // Şablonlar + sorular + isimler (görünen satırlar için)
  const templateIds = [...new Set(shown.map((r) => r.template_id).filter((v): v is string => Boolean(v)))];
  const shownIds = shown.slice(0, 300).map((r) => r.id);
  const [{ data: templates }, { data: questions }, { data: profiles }, assigneeIds, { data: sentRows }] = await Promise.all([
    templateIds.length ? supabase.from("survey_templates").select("id, name").in("id", templateIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    templateIds.length
      ? supabase.from("survey_questions").select("id, template_id, kind, label, options, required, position").in("template_id", templateIds).order("position", { ascending: true })
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabase.from("profiles").select("id, full_name").limit(500),
    canManage ? loadAssigneeIds(supabase, tenantId) : Promise.resolve([] as string[]),
    // Otomatik gönderim izi (PB49; sütun yoksa hata = boş, kuyruk etkilenmez).
    shownIds.length
      ? supabase.from("survey_tasks").select("id, sent_via").in("id", shownIds).not("sent_via", "is", null)
      : Promise.resolve({ data: [] as { id: string; sent_via: string }[] }),
  ]);
  const sentVia = new Map(((sentRows ?? []) as { id: string; sent_via: string }[]).map((s) => [String(s.id), String(s.sent_via)]));
  const nameOf = new Map((profiles ?? []).map((p) => [String(p.id), String(p.full_name ?? "Kullanıcı")]));
  const tplName = new Map((templates ?? []).map((t) => [String(t.id), String(t.name)]));
  const qByTpl = new Map<string, QueueQuestionVM[]>();
  for (const x of (questions ?? []) as Record<string, unknown>[]) {
    const id = String(x.template_id);
    qByTpl.set(id, [
      ...(qByTpl.get(id) ?? []),
      {
        id: String(x.id),
        kind: x.kind as QueueQuestionVM["kind"],
        label: String(x.label),
        options: Array.isArray(x.options) ? (x.options as unknown[]).map(String) : [],
        required: x.required === true,
      },
    ]);
  }
  const assigneeOptions: AssigneeOption[] = assigneeIds.map((id) => ({ id, name: nameOf.get(id) ?? "Anketör" }));

  const vms: QueueTaskVM[] = shown.map((r) => {
    const cust = firstOf(r.customer);
    const phone = cust?.phone ?? r.contact_phone ?? "";
    const name = cust?.full_name ?? r.contact_name ?? "Kişi bilgisi yok";
    const status = isSurveyStatus(r.status) ? r.status : "pending";
    const effective = r.next_attempt_at ?? r.due_at;
    return {
      id: r.id,
      name,
      phoneDisplay: formatPhoneDisplay(phone),
      telHref: toTelHref(phone),
      hasCustomer: Boolean(cust),
      href: cust?.id ? `/app/musteriler/${cust.id}` : r.property_id ? `/app/portfoyler/${r.property_id}` : null,
      eventLabel: isSurveyEventType(r.event_type) ? EVENT_LABELS[r.event_type] : r.event_type,
      summary: r.event_summary ?? "",
      advisor: r.agent_id ? (nameOf.get(r.agent_id) ?? null) : null,
      templateName: r.template_id ? (tplName.get(r.template_id) ?? null) : null,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      dueLabel: `${r.next_attempt_at ? "Yeniden arama" : "Vade"}: ${formatDateTimeTr(effective)}`,
      overdue: isOverdue(r, nowMs, settings.overdue_hours),
      scheduled: isScheduled(r, nowMs),
      status,
      statusLabel: STATUS_LABELS[status],
      assignedTo: r.assigned_to,
      assigneeName: r.assigned_to ? (nameOf.get(r.assigned_to) ?? null) : null,
      lastOutcomeLabel: r.last_outcome && r.last_outcome in OUTCOME_LABELS ? OUTCOME_LABELS[r.last_outcome as SurveyOutcome] : null,
      sentLabel: sentVia.get(r.id) === "sms" ? "SMS ile gönderildi" : sentVia.get(r.id) === "whatsapp" ? "WhatsApp ile gönderildi" : null,
      questions: r.template_id ? (qByTpl.get(r.template_id) ?? []) : [],
    };
  });

  const link = (patch: ParamRecord) => buildHref(BASE, mergeParams(params, patch));
  const tabs: { key: string; label: string; count: number | null; hidden?: boolean }[] = [
    { key: "bekleyen", label: "Tüm bekleyenler", count: closedView ? null : rows.length },
    { key: "simdi", label: "Şimdi aranacak", count: closedView ? null : dueRows.length },
    { key: "geciken", label: "Geciken", count: closedView ? null : overdueRows.length },
    { key: "zamanlanmis", label: "Zamanlanmış", count: closedView ? null : scheduledRows.length },
    { key: "atanmamis", label: "Atanmamış", count: closedView ? null : unassigned.length, hidden: !canManage },
    { key: "kapali", label: "Kapananlar", count: null },
  ];

  const stats: StatRowItem[] = [
    { label: "Şimdi aranacak", value: dueRows.length, href: link({ durum: "simdi" }), hint: "vadesi gelmiş" },
    { label: "Geciken", value: overdueRows.length, href: link({ durum: "geciken" }), attention: true, hint: `${settings.overdue_hours} saat+` },
    { label: "Zamanlanmış", value: scheduledRows.length, href: link({ durum: "zamanlanmis" }), hint: "ileri tarihli" },
  ];
  if (canManage) stats.push({ label: "Atanmamış", value: unassigned.length, href: link({ durum: "atanmamis" }), attention: true, hint: "anketör bekliyor" });

  return (
    <div className="space-y-5">
      {header}
      <SurveyNav current="kuyruk" />
      {!closedView ? <StatRow items={stats} label="Kuyruk özeti" /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {tabs
          .filter((t) => !t.hidden)
          .map((t) => (
            <Link
              key={t.key}
              href={link({ durum: t.key })}
              aria-current={durum === t.key ? "page" : undefined}
              className={`focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
                durum === t.key ? "border-brand-600 bg-brand-600 text-white" : "border-line text-text-muted hover:border-brand-400"
              }`}
            >
              {t.label}
              {t.count !== null ? <span className="tabular-nums opacity-80">{t.count}</span> : null}
            </Link>
          ))}
        {canManage && assigneeOptions.length > 0 ? (
          <form method="get" action={BASE} className="ml-auto flex items-center gap-2">
            <input type="hidden" name="durum" value={durum} />
            <label className="text-xs font-semibold text-text-muted" htmlFor="anketor-filtre">
              Anketör
            </label>
            <select id="anketor-filtre" name="anketor" defaultValue={anketor} className="min-h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm">
              <option value="">Tümü</option>
              <option value="atanmamis">Atanmamış</option>
              {assigneeOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button type="submit" className="focus-ring press min-h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-xs font-semibold">
              Süz
            </button>
          </form>
        ) : null}
      </div>

      {vms.length === 0 ? (
        <EmptyState
          icon={durum === "kapali" ? Headphones : PartyPopper}
          tone="mint"
          title={durum === "kapali" ? "Kapanan görev yok" : "Bu görünümde bekleyen görev yok"}
          description={
            durum === "kapali"
              ? "Tamamlanan, reddedilen veya ulaşılamayan anket görevleri burada listelenir."
              : "Yeni görevler olaylar gerçekleştikçe (ve tetikleyiciler açıksa) kuyruğa düşer. Tetikleyicileri ayarlardan yönetebilirsiniz."
          }
          action={canConfigure ? { href: "/app/anketler/ayarlar", label: "Tetikleyicileri yönet" } : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {vms.map((vm) => (
            <QueueTaskCard key={vm.id} task={vm} canManage={canManage} assignees={assigneeOptions} />
          ))}
        </ul>
      )}
    </div>
  );
}
