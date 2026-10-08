import { CheckCircle2, Circle, CircleDot, ClipboardList, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { now, toTrLocalInput } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { buildDealProcess, isMissingDealProcessTable, type DealProcessRow, type DealProcessStatus } from "@/lib/deal-process";
import { Progress } from "@/components/ui/progress";
import { DealProcessStepForm } from "./deal-process-step-form";

const STATUS_STYLE: Record<DealProcessStatus, { label: string; chip: string }> = {
  done: { label: "Tamamlandı", chip: "bg-mint-500/12 text-mint-700" },
  overdue: { label: "Gecikti", chip: "bg-danger-500/10 text-danger-600" },
  current: { label: "Sırada", chip: "bg-brand-600/10 text-brand-700" },
  upcoming: { label: "Bekliyor", chip: "bg-canvas text-text-muted" },
};

/**
 * Tapu süreci adım takibi (satış anlaşması): 8 adım, ilerleme çubuğu, tarih/sorumlu/not. Müşteri portalı aynı hesabı
 * (`buildDealProcess` -> `toPortalSteps`) salt-okunur gösterir. Tablo yoksa bölüm "etkin değil" der.
 */
export async function DealProcessSection({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const [stepsRes, membersRes, deedRes] = await Promise.all([
    supabase.from("deal_process_steps").select("step_key, done_at, planned_at, assigned_to, note").eq("deal_id", dealId),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name", { ascending: true }).limit(200),
    // GÖS kartındaki tapu randevusu (kolon yoksa hata yutulur -> yedek tarih yok).
    supabase.from("deals").select("title_deed_appointment_at").eq("id", dealId).maybeSingle(),
  ]);

  if (isMissingDealProcessTable(stepsRes.error)) {
    return (
      <section className="surface-card rounded-[var(--radius-panel)] p-5" aria-labelledby="deal-process-baslik">
        <h2 id="deal-process-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
          <ClipboardList className="h-4 w-4 text-brand-600" aria-hidden /> Tapu süreci
        </h2>
        <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-3 text-sm text-text-muted">
          Adım takibi henüz etkin değil (veritabanı güncellemesi bekleniyor).
        </p>
      </section>
    );
  }

  const rows: DealProcessRow[] = (stepsRes.data ?? []).map((r) => ({
    stepKey: String(r.step_key),
    doneAt: (r.done_at as string | null) ?? null,
    plannedAt: (r.planned_at as string | null) ?? null,
    assignedTo: (r.assigned_to as string | null) ?? null,
    note: (r.note as string | null) ?? null,
  }));
  const members = (membersRes.data ?? []).map((m) => ({ id: String(m.id), name: String(m.full_name ?? "Kullanıcı") }));
  const nameById = new Map(members.map((m) => [m.id, m.name]));
  const titleDeedAt = deedRes.error ? null : ((deedRes.data as { title_deed_appointment_at?: string | null } | null)?.title_deed_appointment_at ?? null);
  const view = buildDealProcess(rows, now(), titleDeedAt);

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5" aria-labelledby="deal-process-baslik">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="deal-process-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
          <ClipboardList className="h-4 w-4 text-brand-600" aria-hidden /> Tapu süreci
        </h2>
        <span className="numeric text-sm font-bold text-ink-950">
          {view.doneCount}/{view.total} adım · %{view.percent}
        </span>
      </div>
      <p className="mt-1 text-xs text-text-muted">
        Alıcı ve satıcı müşteri portalında yalnız adım adı, durum ve tarihi görür; not ve sorumlu kişi yalnız ofis içindir.
      </p>
      <Progress className="mt-3" value={view.percent} label="Tapu süreci ilerlemesi" tone={view.overdueCount > 0 ? "warning" : view.complete ? "success" : "accent"} />
      {view.overdueCount > 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-danger-600">
          <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> {view.overdueCount} adımın planlanan tarihi geçti.
        </p>
      ) : null}

      <ol className="mt-4 space-y-2">
        {view.steps.map((s, i) => {
          const st = STATUS_STYLE[s.status];
          const Icon = s.status === "done" ? CheckCircle2 : s.status === "upcoming" ? Circle : CircleDot;
          return (
            <li key={s.key} className="rounded-[var(--radius-card)] border border-line px-3 py-2.5">
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                  <Icon className={`h-4 w-4 shrink-0 ${s.status === "done" ? "text-mint-600" : s.status === "overdue" ? "text-danger-500" : s.status === "current" ? "text-brand-600" : "text-text-faint"}`} aria-hidden />
                  <span className="text-sm font-semibold text-ink-950">
                    {i + 1}. {s.label}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${st.chip}`}>{st.label}</span>
                  <span className="ml-auto flex flex-wrap items-center gap-x-3 text-xs text-text-muted">
                    {s.doneAt ? <span>Tamamlanma: {formatDateTimeTr(s.doneAt)}</span> : s.plannedAt ? <span>Plan: {formatDateTimeTr(s.plannedAt)}</span> : null}
                    {s.assignedTo && nameById.get(s.assignedTo) ? <span>Sorumlu: {nameById.get(s.assignedTo)}</span> : null}
                  </span>
                </summary>
                <p className="mt-2 text-xs text-text-muted">{s.hint}</p>
                {s.note ? <p className="mt-1 text-xs text-ink-700">Not: {s.note}</p> : null}
                {canEdit ? (
                  <DealProcessStepForm
                    dealId={dealId}
                    stepKey={s.key}
                    plannedLocal={s.plannedAt ? toTrLocalInput(s.plannedAt) : ""}
                    assignedTo={s.assignedTo ?? ""}
                    note={s.note ?? ""}
                    done={s.status === "done"}
                    members={members}
                  />
                ) : null}
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
