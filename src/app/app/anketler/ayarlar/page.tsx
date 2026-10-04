import { Info } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { roleLabel } from "@/lib/role-labels";
import { isSurveyModuleReady, ensureSurveyDefaults, loadOpenLoad, loadSurveySettings } from "@/lib/surveys/server";
import {
  AUDIENCE_LABELS,
  DEFAULT_DELAY_DAYS,
  DEFAULT_MAX_ATTEMPTS,
  EVENT_DESCRIPTIONS,
  EVENT_LABELS,
  SURVEY_EVENT_TYPES,
  isSurveyAudience,
  isSurveyEventType,
  type SurveyEventType,
} from "@/lib/surveys/types";
import { SurveyNav, SurveyNotReady } from "../survey-nav";
import { AssigneeToggle, AssignmentForm, DistributeButton, TriggerForm } from "../settings-forms";
import { TemplateEditor, type TemplateQuestionVM } from "../template-editor";

/**
 * Anket ayarları: tetikleyiciler (tek tek aç/kapa, bekleme günü, en çok deneme), anketör ataması (rol değil, görev),
 * dağıtım modu ve şablonlar. Düzenleme `surveys` modülünde SİLME düzeyi izin ister (varsayılan ofis sahibi ve genel müdür);
 * diğerleri salt okunur görür.
 */
export default async function SurveySettingsPage() {
  const ctx = await requireModulePage("surveys", "/app/anketler");
  const supabase = await createClient();
  const tenantId = ctx.tenantId ?? "";

  const header = (
    <PageHeader
      eyebrow="Anketler"
      title="Tetikleyiciler ve şablonlar"
      description="Hangi olaylarda anket yapılacağını, kimin arayacağını ve neleri soracağınızı buradan belirleyin."
    />
  );
  if (!(await isSurveyModuleReady(supabase))) {
    return (
      <div className="space-y-5">
        {header}
        <SurveyNav current="ayarlar" />
        <SurveyNotReady />
      </div>
    );
  }

  const canConfigure = effectiveHasPermission(ctx.perms, "surveys", "delete");
  if (canConfigure) await ensureSurveyDefaults(supabase, tenantId);

  const [settings, load, { data: triggerRows }, { data: assigneeRows }, { data: profiles }, { data: templates }, { data: questions }] = await Promise.all([
    loadSurveySettings(supabase, tenantId),
    loadOpenLoad(supabase, tenantId),
    supabase.from("survey_triggers").select("event_type, enabled, delay_days, max_attempts").eq("tenant_id", tenantId),
    supabase.from("survey_assignees").select("user_id").eq("tenant_id", tenantId),
    supabase.from("profiles").select("id, full_name, role").eq("tenant_id", tenantId).eq("is_active", true).order("full_name").limit(500),
    supabase.from("survey_templates").select("id, event_type, audience, name, active").eq("tenant_id", tenantId).order("event_type"),
    supabase.from("survey_questions").select("id, template_id, kind, label, options, required, tag, position").eq("tenant_id", tenantId).order("position", { ascending: true }),
  ]);

  const trigger = new Map<string, { enabled: boolean; delay: number; attempts: number }>();
  for (const t of triggerRows ?? []) trigger.set(String(t.event_type), { enabled: t.enabled === true, delay: Number(t.delay_days), attempts: Number(t.max_attempts) });
  const assigneeSet = new Set((assigneeRows ?? []).map((a) => String(a.user_id)));
  const people = (profiles ?? []).map((p) => ({ id: String(p.id), name: String(p.full_name ?? "Kullanıcı"), role: roleLabel(String(p.role)) }));
  const assigneeOptions = people.filter((p) => assigneeSet.has(p.id)).map((p) => ({ id: p.id, name: p.name }));

  const qByTpl = new Map<string, TemplateQuestionVM[]>();
  for (const q of questions ?? []) {
    const id = String(q.template_id);
    qByTpl.set(id, [
      ...(qByTpl.get(id) ?? []),
      {
        id: String(q.id),
        kind: q.kind as TemplateQuestionVM["kind"],
        label: String(q.label),
        options: Array.isArray(q.options) ? (q.options as unknown[]).map(String) : [],
        required: q.required === true,
        tag: q.tag === "primary" || q.tag === "reason" ? q.tag : null,
      },
    ]);
  }

  const orderedTemplates = [...(templates ?? [])]
    .filter((t) => isSurveyEventType(t.event_type) && isSurveyAudience(t.audience))
    .sort((a, b) => SURVEY_EVENT_TYPES.indexOf(a.event_type as SurveyEventType) - SURVEY_EVENT_TYPES.indexOf(b.event_type as SurveyEventType));

  return (
    <div className="space-y-6">
      {header}
      <SurveyNav current="ayarlar" />
      {!canConfigure ? (
        <Alert tone="info" title="Salt okunur görünüm">
          Tetikleyicileri, anketörleri ve şablonları yalnızca ofis sahibi ve genel müdür değiştirebilir.
        </Alert>
      ) : null}

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <h2 className="font-display font-bold text-ink-950">Tetikleyiciler</h2>
        <p className="mt-1 flex items-start gap-1.5 text-xs text-text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Her olay için ayrı açılır. Bir tetikleyici açıldığında yalnız bundan sonraki olaylar için anket üretilir. Aynı olay için ikinci anket oluşmaz.
          Talep kapanışında kapanış zamanı tutulmadığından yalnız tetikleyici açıldıktan sonra oluşturulup kapanan talepler alınır.
        </p>
        <ul className="mt-4 grid gap-3">
          {SURVEY_EVENT_TYPES.map((event) => {
            const t = trigger.get(event);
            return (
              <TriggerForm
                key={event}
                event={event}
                label={EVENT_LABELS[event]}
                description={EVENT_DESCRIPTIONS[event]}
                enabled={t?.enabled ?? false}
                delayDays={t?.delay ?? DEFAULT_DELAY_DAYS}
                maxAttempts={t?.attempts ?? DEFAULT_MAX_ATTEMPTS}
                readOnly={!canConfigure}
              />
            );
          })}
        </ul>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <h2 className="font-display font-bold text-ink-950">Anketörler ve dağıtım</h2>
        <p className="mt-1 text-xs text-text-muted">
          Anketör bir rol değil, atanabilir bir görevdir: seçtiğiniz kullanıcılar kendi rollerini koruyarak anketör kuyruğunu çalıştırır.
        </p>
        <ul className="mt-3 divide-y divide-line">
          {people.map((p) => (
            <AssigneeToggle key={p.id} userId={p.id} name={p.name} role={p.role} isAssignee={assigneeSet.has(p.id)} openTasks={load.get(p.id) ?? 0} readOnly={!canConfigure} />
          ))}
        </ul>
        <div className="mt-5 border-t border-line pt-4">
          <AssignmentForm initial={settings} assignees={assigneeOptions} readOnly={!canConfigure} />
        </div>
        {canConfigure ? (
          <div className="mt-4">
            <DistributeButton />
          </div>
        ) : null}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <h2 className="font-display font-bold text-ink-950">Şablonlar</h2>
        <p className="mt-1 text-xs text-text-muted">
          Telefonla doldurma ve bağlı anket linki aynı şablonu kullanır. Olay türüne göre hazır Türkçe şablonlar gelir; düzenleyebilirsiniz.
        </p>
        <div className="mt-4 grid gap-3">
          {orderedTemplates.map((t) => (
            <details key={String(t.id)} className="group rounded-[var(--radius-card)] border border-line bg-canvas/40 p-4">
              <summary className="focus-ring flex cursor-pointer flex-wrap items-center gap-2 rounded-[var(--radius-control)] text-sm font-semibold text-ink-950">
                <span>{String(t.name)}</span>
                <span className="text-xs font-normal text-text-muted">
                  {EVENT_LABELS[t.event_type as SurveyEventType]} · {AUDIENCE_LABELS[t.audience as keyof typeof AUDIENCE_LABELS]}
                  {t.active ? "" : " · pasif"}
                </span>
              </summary>
              <div className="mt-4">
                <TemplateEditor
                  templateId={String(t.id)}
                  initialName={String(t.name)}
                  initialActive={t.active === true}
                  initialQuestions={qByTpl.get(String(t.id)) ?? []}
                  readOnly={!canConfigure}
                />
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
