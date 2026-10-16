import { notFound } from "next/navigation";
import { CalendarClock, CheckCircle2, ListOrdered, Pencil, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import Link from "@/components/ui/smart-link";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeTr, formatDateTr } from "@/lib/format";
import {
  cumulativeDays,
  ENROLLMENT_STATUS_LABELS,
  SEQUENCE_STEP_LABELS,
  STOP_REASON_LABELS,
  type SequenceStepType,
} from "@/lib/automation/sequence-rules";
import { skipReasonLabel } from "../../labels";
import { EnrollPanel, SequenceHeaderActions, StopEnrollmentButton } from "../sequence-actions";

export const metadata = { title: "Otomatik takip" };

type StepRow = { id: string; sort_order: number; delay_days: number; step_type: string; config: Record<string, unknown> };
type EnrollmentRow = {
  id: string;
  customer_id: string;
  status: string;
  next_step: number;
  next_due_at: string | null;
  enrolled_at: string;
  finished_at: string | null;
  stop_reason: string | null;
  last_result: { step?: number; type?: string; result?: string; detail?: string | null } | null;
  customer: { full_name: string | null } | { full_name: string | null }[] | null;
};

const FILTERS = [
  { label: "Devam eden", value: "" },
  { label: "Biten", value: "biten" },
] as const;

function stepSummary(s: StepRow): string {
  const c = s.config ?? {};
  switch (s.step_type) {
    case "sms":
      return String(c.text ?? "");
    case "whatsapp_template":
      return `Şablon: ${String(c.template_name ?? "")} · ${String(c.language ?? "")}`;
    case "email":
      return `Konu: ${String(c.subject ?? "")}`;
    case "task":
      return String(c.title ?? "");
    default:
      return "";
  }
}

function customerName(r: EnrollmentRow): string {
  const c = Array.isArray(r.customer) ? r.customer[0] : r.customer;
  return c?.full_name || "Müşteri";
}

export default async function DiziDetayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ durum?: string }>;
}) {
  const { perms } = await requireModulePage("settings", "/app/otomasyonlar");
  const canEdit = (perms.settings ?? []).includes("edit");
  const canEnroll = (perms.customers ?? []).includes("edit");
  const { id } = await params;
  const durum = ((await searchParams) ?? {}).durum ?? "";
  const supabase = await createClient();

  let enrollQ = supabase
    .from("message_sequence_enrollments")
    .select(
      "id, customer_id, status, next_step, next_due_at, enrolled_at, finished_at, stop_reason, last_result, customer:customers!message_sequence_enrollments_customer_tenant_fkey(full_name)",
    )
    .eq("sequence_id", id);
  enrollQ = durum === "biten"
    ? enrollQ.neq("status", "active").order("finished_at", { ascending: false })
    : enrollQ.eq("status", "active").order("next_due_at", { ascending: true });

  const [{ data: seq }, { data: stepData }, { data: enrollData }, { count: activeCount }, { count: doneCount }] = await Promise.all([
    supabase.from("message_sequences").select("id, name, description, is_active, stop_on_reply, daily_cap").eq("id", id).maybeSingle(),
    supabase.from("message_sequence_steps").select("id, sort_order, delay_days, step_type, config").eq("sequence_id", id).order("sort_order"),
    enrollQ.limit(100),
    supabase.from("message_sequence_enrollments").select("id", { count: "exact", head: true }).eq("sequence_id", id).eq("status", "active"),
    supabase.from("message_sequence_enrollments").select("id", { count: "exact", head: true }).eq("sequence_id", id).neq("status", "active"),
  ]);
  if (!seq) notFound();

  const steps = (stepData ?? []) as StepRow[];
  const enrollments = (enrollData ?? []) as EnrollmentRow[];
  const dayOf = cumulativeDays(steps.map((s) => s.delay_days));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Otomatik takip"
        title={String(seq.name)}
        description={(seq.description as string | null) ?? undefined}
        breadcrumbs={[{ label: "Otomatik takip mesajları", href: "/app/otomasyonlar/diziler" }, { label: String(seq.name) }]}
        meta={
          <>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${seq.is_active ? "bg-mint-50 text-mint-700" : "bg-surface-sunken text-text-muted"}`}>
              {seq.is_active ? "Açık" : "Duraklatıldı"}
            </span>
            <span className="text-xs text-text-muted">
              {seq.stop_on_reply ? "Yanıt gelince durur" : "Yanıt gelse de sürer"} · günde en çok {Number(seq.daily_cap)} adım
            </span>
          </>
        }
        actions={
          canEdit ? (
            <>
              <ButtonLink href={`/app/otomasyonlar/diziler/${id}/duzenle`} variant="outline" size="sm" icon={Pencil}>
                Düzenle
              </ButtonLink>
              <SequenceHeaderActions id={id} active={Boolean(seq.is_active)} />
            </>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Adım zaman çizelgesi */}
        <section aria-labelledby="dizi-adimlar" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
          <h2 id="dizi-adimlar" className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950">
            <ListOrdered className="h-4 w-4 text-brand-600" aria-hidden="true" /> Adımlar
          </h2>
          {steps.length === 0 ? (
            <p className="text-sm text-text-muted">Adım eklenmemiş. Düzenle ile adım ekleyin.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-line pl-5">
              {steps.map((s, i) => (
                <li key={s.id} className="relative">
                  <span aria-hidden="true" className="absolute -left-[27px] top-1 grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-surface bg-brand-600" />
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-950">
                    <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-700">Gün {dayOf[i]}</span>
                    {SEQUENCE_STEP_LABELS[s.step_type as SequenceStepType] ?? s.step_type}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-muted">{stepSummary(s)}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Müşteri ekle */}
        <section aria-labelledby="dizi-kayit" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
          <h2 id="dizi-kayit" className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-950">
            <Users className="h-4 w-4 text-brand-600" aria-hidden="true" /> Müşteri ekle
          </h2>
          {canEnroll ? (
            steps.length > 0 ? (
              <EnrollPanel sequenceId={id} />
            ) : (
              <p className="text-sm text-text-muted">Önce diziye en az bir adım ekleyin.</p>
            )
          ) : (
            <p className="text-sm text-text-muted">Müşteri eklemek için müşteri düzenleme yetkisi gerekir.</p>
          )}
        </section>
      </div>

      {/* Kayıtlar */}
      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
            <CalendarClock className="h-4 w-4 text-brand-600" aria-hidden="true" /> Diziye kayıtlı müşteriler
          </h2>
          <div className="flex gap-1.5">
            {FILTERS.map((f) => (
              <FilterChip
                key={f.value}
                href={f.value ? `/app/otomasyonlar/diziler/${id}?durum=${f.value}` : `/app/otomasyonlar/diziler/${id}`}
                active={durum === f.value}
              >
                {f.label} ({f.value ? (doneCount ?? 0) : (activeCount ?? 0)})
              </FilterChip>
            ))}
          </div>
        </div>
        {enrollments.length === 0 ? (
          <div className="px-4 py-10 sm:px-6">
            <EmptyState
              variant="compact"
              bare
              icon={durum ? CheckCircle2 : Users}
              title={durum ? "Biten kayıt yok" : "Dizide devam eden müşteri yok"}
              description={durum ? "Tamamlanan ya da durdurulan kayıtlar burada listelenir." : "Yukarıdaki panelden müşteri ya da etiket seçerek diziyi başlatın."}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {enrollments.map((r) => {
              const name = customerName(r);
              const next = steps[r.next_step];
              const last = r.last_result;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/app/musteriler/${r.customer_id}`}
                      className="focus-ring rounded-[var(--radius-control)] text-sm font-semibold text-ink-950 hover:text-brand-600 hover:underline"
                    >
                      {name}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {r.status === "active"
                        ? next
                          ? `Sıradaki: ${r.next_step + 1}/${steps.length} · ${SEQUENCE_STEP_LABELS[next.step_type as SequenceStepType] ?? next.step_type}${r.next_due_at ? ` · ${formatDateTimeTr(r.next_due_at)}` : ""}`
                          : "Son adım bekleniyor"
                        : `${ENROLLMENT_STATUS_LABELS[r.status] ?? r.status}${r.stop_reason ? ` · ${STOP_REASON_LABELS[r.stop_reason] ?? r.stop_reason}` : ""}${r.finished_at ? ` · ${formatDateTr(r.finished_at)}` : ""}`}
                    </p>
                    {last?.result && last.result !== "ok" ? (
                      <p className="text-xs text-amber-700">
                        Son adım atlandı{last.detail ? `: ${skipReasonLabel(last.detail)}` : ""}
                      </p>
                    ) : null}
                  </div>
                  {r.status === "active" && canEnroll ? <StopEnrollmentButton id={r.id} name={name} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
