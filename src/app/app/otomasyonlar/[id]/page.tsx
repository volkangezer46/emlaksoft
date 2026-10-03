import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Play, Pause, Zap, Filter, Bolt, Activity, History, Pencil } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { AutomationToggleButton } from "../automation-actions";
import { AutomationWizard, type WizardInitial } from "../automation-wizard";
import { TRIGGER_LABELS, ACTION_LABELS, STATUS_LABELS, TRIGGER_CONFIG_LABELS, CONDITION_OP_LABELS } from "../labels";

function dateTime(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

type LogRow = {
  id: string;
  entity_type: string | null;
  entity_id: string | null;
  actions_taken: { type?: string; result?: string; detail?: string }[] | null;
  result: string;
  error_msg: string | null;
  created_at: string;
};

const LOG_ENTITY_LABELS: Record<string, string> = {
  customer:    "Müşteri",
  demand:      "Talep",
  property:    "Portföy",
  offer:       "Teklif",
  deal:        "Anlaşma",
  appointment: "Randevu",
};

/** Log satırındaki entity'ye tıklanınca gidilecek hedef (sıfır çıkmaz metrik). */
function logEntityHref(entityType: string | null, entityId: string | null): string {
  switch (entityType) {
    case "customer":    return entityId ? `/app/musteriler/${entityId}` : "/app/musteriler";
    case "property":    return entityId ? `/app/portfoyler/${entityId}` : "/app/portfoyler";
    case "demand":      return "/app/talepler";
    case "offer":       return "/app/teklifler";
    case "deal":        return "/app/anlasmalar";
    case "appointment": return "/app/randevular";
    default:            return "/app/otomasyonlar";
  }
}

const RESULT_BADGES: Record<string, { label: string; className: string }> = {
  ok:    { label: "Çalıştı", className: "bg-mint-50 text-mint-700" },
  skip:  { label: "Atlandı", className: "bg-zinc-100 text-text-muted" },
  error: { label: "Hata",    className: "bg-danger-500/10 text-danger-600" },
};

export default async function AutomationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms } = await requireModulePage("settings", "/app/otomasyonlar");
  const canEdit = (perms.settings ?? []).includes("edit");
  const { id } = await params;
  const supabase = await createClient();

  const { data: rule } = await supabase
    .from("automations")
    .select("id, name, description, trigger_type, trigger_config, conditions, actions, status, run_count, last_run_at, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (!rule) notFound();

  // Çalışma geçmişi (son 50) + düzenleme sihirbazı için ekip listesi
  const [{ data: logData }, { data: staffData }] = await Promise.all([
    supabase
      .from("automation_logs")
      .select("id, entity_type, entity_id, actions_taken, result, error_msg, created_at")
      .eq("automation_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    canEdit
      ? supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);
  const logs = (logData ?? []) as LogRow[];
  const staff = (staffData ?? []) as { id: string; full_name: string }[];

  const actions = Array.isArray(rule.actions) ? rule.actions : [];
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
  const triggerConfig = (rule.trigger_config ?? {}) as Record<string, unknown>;
  const isActive = rule.status === "active";

  return (
    <div className="space-y-6">
      <Link href="/app/otomasyonlar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Otomasyonlar
      </Link>

      <PageHeader
        eyebrow="Otomasyon kuralı"
        title={rule.name}
        description={rule.description ?? undefined}
        icon={
          <span className={`grid h-11 w-11 place-items-center rounded-[var(--radius-card)] ${isActive ? "bg-mint-500/12 text-mint-700" : "bg-surface-2 text-text-muted"}`}>
            {isActive ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
          </span>
        }
        meta={
          <>
            <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-bold text-text">{STATUS_LABELS[rule.status] ?? rule.status}</span>
            <a href="#calisma-gecmisi" className="focus-ring rounded-[var(--radius-control)] text-xs text-text-muted underline-offset-2 transition hover:text-brand-700 hover:underline">
              {rule.run_count} kez çalıştı
            </a>
          </>
        }
        actions={
          <>
            {canEdit ? (
              <AutomationWizard
                staff={staff}
                initial={{
                  id: rule.id,
                  name: rule.name,
                  description: rule.description,
                  trigger_type: rule.trigger_type,
                  trigger_config: (rule.trigger_config ?? {}) as WizardInitial["trigger_config"],
                  conditions: (Array.isArray(rule.conditions) ? rule.conditions : []) as WizardInitial["conditions"],
                  actions: (Array.isArray(rule.actions) ? rule.actions : []) as WizardInitial["actions"],
                }}
                trigger={
                  <button
                    type="button"
                    className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2 text-xs font-bold text-text transition hover:bg-surface-2"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Düzenle
                  </button>
                }
              />
            ) : null}
            {canEdit ? <AutomationToggleButton id={rule.id} status={rule.status} /> : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Tetikleyici */}
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><Bolt className="h-4 w-4 text-amber-500" /> Tetikleyici</h2>
          <p className="rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold text-ink-950">
            {TRIGGER_LABELS[rule.trigger_type] ?? rule.trigger_type}
          </p>
          {Object.keys(triggerConfig).length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-text-muted">
              {Object.entries(triggerConfig).map(([k, v]) => (
                <li key={k} className="flex justify-between rounded-[var(--radius-control)] bg-canvas px-2.5 py-1.5">
                  <span>{TRIGGER_CONFIG_LABELS[k] ?? k}</span><span className="font-semibold text-ink-950">{String(v)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* Koşullar */}
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><Filter className="h-4 w-4 text-brand-600" /> Koşullar</h2>
          {conditions.length === 0 ? (
            <p className="text-sm text-text-muted">Koşul yok — tetiklenince her zaman çalışır.</p>
          ) : (
            <ul className="space-y-1.5">
              {conditions.map((c: Record<string, unknown>, i: number) => (
                <li key={i} className="rounded-[var(--radius-control)] bg-canvas px-2.5 py-1.5 text-xs text-ink-950">
                  {String(c.field ?? "")} {CONDITION_OP_LABELS[String(c.op ?? "")] ?? String(c.op ?? "")} <span className="font-semibold">{String(c.value ?? "")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Aksiyonlar */}
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950"><Zap className="h-4 w-4 text-mint-600" /> Aksiyonlar</h2>
          {actions.length === 0 ? (
            <p className="text-sm text-text-muted">Aksiyon tanımlanmamış.</p>
          ) : (
            <ul className="space-y-1.5">
              {actions.map((a: Record<string, unknown>, i: number) => (
                <li key={i} className="flex items-center gap-2 rounded-[var(--radius-control)] bg-mint-500/8 px-2.5 py-2 text-sm font-medium text-mint-700">
                  <Zap className="h-3.5 w-3.5" /> {ACTION_LABELS[String(a.type)] ?? String(a.type)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Çalışma geçmişi — automation_logs son 50 kayıt */}
      <section id="calisma-gecmisi" className="scroll-mt-6 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
            <History className="h-4 w-4 text-brand-600" /> Çalışma geçmişi
          </h2>
          <span className="text-xs text-text-faint">Son {logs.length} kayıt</span>
        </div>

        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <History className="h-10 w-10 text-text-faint" />
            <p className="mt-3 font-semibold text-ink-950">Henüz çalışma kaydı yok</p>
            <p className="mt-1 max-w-sm text-sm text-text-muted">
              Kural tetiklendiğinde her çalışma burada tarih, ilgili kayıt ve sonucuyla listelenir.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {logs.map((log) => {
              const badge = RESULT_BADGES[log.result] ?? RESULT_BADGES.skip;
              const taken = Array.isArray(log.actions_taken) ? log.actions_taken : [];
              const detail = log.result === "error" && log.error_msg
                ? log.error_msg
                : taken
                    .map((a) => {
                      const label = ACTION_LABELS[String(a.type ?? "")] ?? String(a.type ?? "");
                      return a.detail ? `${label} (${a.detail})` : label;
                    })
                    .filter(Boolean)
                    .join(", ");
              return (
                <div key={log.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${badge.className}`}>
                    {badge.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink-950">
                      <Link
                        href={logEntityHref(log.entity_type, log.entity_id)}
                        className="focus-ring rounded-[var(--radius-control)] font-semibold hover:text-brand-600 hover:underline"
                      >
                        {LOG_ENTITY_LABELS[log.entity_type ?? ""] ?? "Kayıt"}
                        {log.entity_id ? ` · ${String(log.entity_id).slice(0, 8)}` : ""}
                      </Link>
                    </p>
                    {detail ? <p className="truncate text-xs text-text-muted">{detail}</p> : null}
                  </div>
                  <span className="shrink-0 text-xs text-text-faint">{dateTime(log.created_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm text-text-muted shadow-[var(--shadow-xs)]">
        <span className="flex items-center gap-1.5"><Activity className="h-4 w-4 text-brand-600" /> Son çalışma: <strong className="text-ink-950">{dateTime(rule.last_run_at)}</strong></span>
        <span>Oluşturuldu: {dateTime(rule.created_at)}</span>
        {canEdit ? <Link href="/app/otomasyonlar" className="ml-auto text-xs font-semibold text-brand-600 hover:underline">Kuralları yönet →</Link> : null}
      </section>
    </div>
  );
}
