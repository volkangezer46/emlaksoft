"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Plus, Save, Trash2 } from "lucide-react";
import {
  addSupportHoliday,
  deleteAssignmentRule,
  deleteSupportHoliday,
  saveAssignmentRule,
  saveBusinessHours,
  saveSlaMatrix,
  setStaffAvailability,
  type DeskActionResult,
} from "@/app/actions/support-desk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { minutesToClock, WEEKDAY_LABELS, type BusinessDay } from "@/lib/support/business-hours";
import { formatHours, resolveSlaTarget, SLA_PLAN_KEYS, SLA_PLAN_LABEL, SLA_PRIORITY_LABEL, type SlaPolicyRow } from "@/lib/support/sla-policy";
import { TICKET_PRIORITIES } from "@/lib/support/ticket-contract";

const fieldClass =
  "focus-ring h-9 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2 text-xs font-semibold text-ink-950 outline-none focus:border-brand-400";

/** Ortak gönderim: bekleme durumu + hata/başarı satırı + sayfa tazeleme. */
function useDeskAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; ok?: string }>({});
  function run(action: (fd: FormData) => Promise<DeskActionResult>, fd: FormData, okText = "Kaydedildi.") {
    setState({});
    start(async () => {
      const r = await action(fd);
      if (r.error) setState({ error: r.error });
      else {
        setState({ ok: okText });
        router.refresh();
      }
    });
  }
  return { pending, state, run };
}

function Status({ state }: { state: { error?: string; ok?: string } }) {
  if (state.error) return <p role="alert" className="text-xs font-semibold text-danger-600">{state.error}</p>;
  if (state.ok) return <p role="status" className="text-xs font-semibold text-mint-700">{state.ok}</p>;
  return null;
}

export function SlaMatrixForm({ policies, canEdit }: { policies: SlaPolicyRow[]; canEdit: boolean }) {
  const { pending, state, run } = useDeskAction();
  const own = (plan: string, priority: string) => policies.find((p) => p.plan === plan && p.priority === priority);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(saveSlaMatrix, new FormData(e.currentTarget), "SLA hedefleri kaydedildi; yeni talepler bu hedeflerle açılır.");
      }}
      className="space-y-3"
    >
      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="bg-canvas/60">
            <tr className="text-left text-text-faint">
              <th className="px-3 py-2 font-semibold">Plan</th>
              {TICKET_PRIORITIES.slice().reverse().map((p) => (
                <th key={p} className="px-2 py-2 font-semibold">
                  {SLA_PRIORITY_LABEL[p]}
                  <span className="block font-normal">ilk yanıt / çözüm (iş saati)</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {SLA_PLAN_KEYS.map((plan) => (
              <tr key={plan}>
                <th scope="row" className="px-3 py-2 text-left font-semibold text-ink-950">
                  {SLA_PLAN_LABEL[plan]}
                  {plan !== "*" ? <span className="block font-normal text-text-faint">boş = varsayılan</span> : null}
                </th>
                {TICKET_PRIORITIES.slice().reverse().map((priority) => {
                  const row = own(plan, priority);
                  const fallback = resolveSlaTarget(policies, "*", priority);
                  return (
                    <td key={priority} className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <input
                          aria-label={`${SLA_PLAN_LABEL[plan]} ${SLA_PRIORITY_LABEL[priority]} ilk yanıt (saat)`}
                          name={`fr:${plan}:${priority}`}
                          inputMode="decimal"
                          disabled={!canEdit}
                          defaultValue={row ? formatHours(row.first_response_minutes) : plan === "*" ? formatHours(fallback.firstResponseMinutes) : ""}
                          placeholder={plan === "*" ? "" : formatHours(fallback.firstResponseMinutes)}
                          className={fieldClass}
                        />
                        <span className="text-text-faint">/</span>
                        <input
                          aria-label={`${SLA_PLAN_LABEL[plan]} ${SLA_PRIORITY_LABEL[priority]} çözüm (saat)`}
                          name={`rs:${plan}:${priority}`}
                          inputMode="decimal"
                          disabled={!canEdit}
                          defaultValue={row ? formatHours(row.resolution_minutes) : plan === "*" ? formatHours(fallback.resolutionMinutes) : ""}
                          placeholder={plan === "*" ? "" : formatHours(fallback.resolutionMinutes)}
                          className={fieldClass}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" icon={Save} loading={pending}>SLA hedeflerini kaydet</Button>
          <Status state={state} />
        </div>
      ) : (
        <p className="text-xs text-text-muted">SLA hedeflerini süper admin ve operasyon değiştirebilir.</p>
      )}
    </form>
  );
}

export function BusinessHoursForm({ days, canEdit }: { days: BusinessDay[]; canEdit: boolean }) {
  const { pending, state, run } = useDeskAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(saveBusinessHours, new FormData(e.currentTarget), "İş saatleri kaydedildi.");
      }}
      className="space-y-3"
    >
      <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
        {days.map((d) => (
          <li key={d.weekday} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 sm:grid-cols-[160px_auto_1fr]">
            <label className="flex min-h-11 items-center gap-2 text-xs font-semibold text-ink-950">
              <input type="checkbox" name={`open:${d.weekday}`} defaultChecked={d.isOpen} disabled={!canEdit} className="h-4 w-4 accent-[var(--color-brand-600)]" />
              {WEEKDAY_LABELS[d.weekday]}
            </label>
            <span className="flex items-center gap-1.5">
              <input aria-label={`${WEEKDAY_LABELS[d.weekday]} başlangıç`} type="time" name={`start:${d.weekday}`} defaultValue={minutesToClock(d.openMinute)} disabled={!canEdit} className={`${fieldClass} w-28`} />
              <span className="text-text-faint">–</span>
              <input aria-label={`${WEEKDAY_LABELS[d.weekday]} bitiş`} type="time" name={`end:${d.weekday}`} defaultValue={minutesToClock(Math.min(d.closeMinute, 1439))} disabled={!canEdit} className={`${fieldClass} w-28`} />
            </span>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" icon={Save} loading={pending}>İş saatlerini kaydet</Button>
          <Status state={state} />
        </div>
      ) : null}
    </form>
  );
}

export function HolidayList({ holidays, canEdit }: { holidays: { day: string; label: string }[]; canEdit: boolean }) {
  const { pending, state, run } = useDeskAction();
  const fmt = (day: string) =>
    new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
  return (
    <div className="space-y-3">
      {holidays.length ? (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
          {holidays.map((h) => (
            <li key={h.day} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
              <span>
                <span className="font-semibold text-ink-950">{h.label}</span>
                <span className="ml-2 text-text-muted">{fmt(h.day)}</span>
              </span>
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${h.label} tatilini sil`}
                  disabled={pending}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("day", h.day);
                    run(deleteSupportHoliday, fd, "Tatil silindi.");
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-text-faint">Tatil tanımlı değil; yalnız hafta sonu kapalı sayılır.</p>
      )}
      {canEdit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            run(addSupportHoliday, new FormData(form), "Tatil eklendi.");
            form.reset();
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="text-xs font-semibold text-text-muted">
            Tarih
            <input type="date" name="day" required className={`${fieldClass} mt-1 w-40`} />
          </label>
          <label className="min-w-48 flex-1 text-xs font-semibold text-text-muted">
            Ad
            <Input name="label" required maxLength={80} placeholder="Ramazan Bayramı 1. gün" className="mt-1 h-9 w-full text-xs" />
          </label>
          <Button type="submit" size="sm" icon={CalendarPlus} loading={pending}>Tatil ekle</Button>
        </form>
      ) : null}
      <Status state={state} />
    </div>
  );
}

type RuleRow = {
  id: string;
  category: string;
  target_role: string | null;
  target_staff_ids: string[];
  is_active: boolean;
  sort_order: number;
  assigned_count: number;
  last_assigned_name: string | null;
};
type Option = { value: string; label: string };

function RuleForm({
  rule,
  categories,
  roles,
  staff,
  onDone,
}: {
  rule?: RuleRow;
  categories: Option[];
  roles: Option[];
  staff: Option[];
  onDone?: () => void;
}) {
  const { pending, state, run } = useDeskAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (rule) fd.set("id", rule.id);
        run(saveAssignmentRule, fd, rule ? "Kural güncellendi." : "Kural eklendi.");
        onDone?.();
      }}
      className="grid gap-2 rounded-[var(--radius-card)] border border-line bg-canvas/40 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_90px_auto]"
    >
      <label className="text-xs font-semibold text-text-muted">
        Kategori
        <select name="category" defaultValue={rule?.category ?? categories[0]?.value} className={`${fieldClass} mt-1`}>
          <option value="*">Tüm kategoriler (yedek kural)</option>
          {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold text-text-muted">
        Rol
        <select name="target_role" defaultValue={rule?.target_role ?? ""} className={`${fieldClass} mt-1`}>
          <option value="">Rol şartı yok</option>
          {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>
      <fieldset className="min-w-0 text-xs font-semibold text-text-muted">
        <legend>Personel (boş = roldeki herkes)</legend>
        <div className="mt-1 max-h-24 space-y-0.5 overflow-y-auto rounded-[var(--radius-control)] border border-line bg-canvas px-2 py-1">
          {staff.length === 0 ? <p className="py-1 font-normal text-text-faint">Aktif personel yok.</p> : null}
          {staff.map((s) => (
            <label key={s.value} className="flex min-h-8 items-center gap-2 font-normal text-ink-950">
              <input type="checkbox" name="staff_ids" value={s.value} defaultChecked={rule?.target_staff_ids.includes(s.value)} className="h-4 w-4" />
              <span className="truncate">{s.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="text-xs font-semibold text-text-muted">
        Sıra
        <input name="sort_order" type="number" min={0} max={10000} defaultValue={rule?.sort_order ?? 100} className={`${fieldClass} mt-1`} />
      </label>
      <div className="flex flex-col justify-end gap-2">
        <label className="flex min-h-9 items-center gap-2 text-xs font-semibold text-ink-950">
          <input type="checkbox" name="is_active" defaultChecked={rule?.is_active ?? true} className="h-4 w-4" /> Etkin
        </label>
        <Button type="submit" size="sm" icon={rule ? Save : Plus} loading={pending}>{rule ? "Kaydet" : "Kural ekle"}</Button>
      </div>
      <div className="sm:col-span-2 lg:col-span-5"><Status state={state} /></div>
    </form>
  );
}

export function AssignmentRules({
  rules,
  categories,
  roles,
  staff,
  canEdit,
}: {
  rules: RuleRow[];
  categories: Option[];
  roles: Option[];
  staff: Option[];
  canEdit: boolean;
}) {
  const { pending, state, run } = useDeskAction();
  const [editing, setEditing] = useState<string | null>(null);
  const categoryLabel = (v: string) => (v === "*" ? "Tüm kategoriler" : categories.find((c) => c.value === v)?.label ?? v);
  const roleLabel = (v: string | null) => (v ? roles.find((r) => r.value === v)?.label ?? v : null);
  const staffLabel = (id: string) => staff.find((s) => s.value === id)?.label ?? "Eski personel";
  return (
    <div className="space-y-3">
      {rules.length ? (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
          {rules.map((r) => (
            <li key={r.id} className="space-y-2 px-3 py-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  <span className="font-semibold text-ink-950">{categoryLabel(r.category)}</span>
                  <span className="mx-1.5 text-text-faint">→</span>
                  <span className="text-ink-950">
                    {[roleLabel(r.target_role), r.target_staff_ids.length ? r.target_staff_ids.map(staffLabel).join(", ") : null].filter(Boolean).join(" · ")}
                  </span>
                  {!r.is_active ? <span className="ml-2 rounded-full bg-canvas px-2 py-0.5 text-text-faint">Kapalı</span> : null}
                </p>
                <span className="text-text-muted">
                  sıra {r.sort_order} · {r.assigned_count} atama{r.last_assigned_name ? ` · son: ${r.last_assigned_name}` : ""}
                </span>
              </div>
              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(editing === r.id ? null : r.id)}>
                    {editing === r.id ? "Vazgeç" : "Düzenle"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-danger-600"
                    disabled={pending}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("id", r.id);
                      run(deleteAssignmentRule, fd, "Kural silindi.");
                    }}
                  >
                    Sil
                  </Button>
                </div>
              ) : null}
              {editing === r.id ? <RuleForm rule={r} categories={categories} roles={roles} staff={staff} onDone={() => setEditing(null)} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-text-faint">Kural yok; yeni talepler atanmadan kuyruğa düşer.</p>
      )}
      <Status state={state} />
      {canEdit ? (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Yeni kural</h3>
          <RuleForm categories={categories} roles={roles} staff={staff} />
        </div>
      ) : null}
    </div>
  );
}

export function StaffAvailabilityList({
  rows,
  viewerId,
  canEditAll,
}: {
  rows: { id: string; name: string; roleLabel: string; isAway: boolean; awayUntil: string | null; note: string | null; active: boolean }[];
  viewerId: string;
  canEditAll: boolean;
}) {
  const { pending, state, run } = useDeskAction();
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
        {rows.map((r) => {
          const editable = r.active && (canEditAll || r.id === viewerId);
          return (
            <li key={r.id} className="px-3 py-2 text-xs">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  fd.set("staff_id", r.id);
                  run(setStaffAvailability, fd, "İzin durumu kaydedildi.");
                }}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="min-w-40 flex-1">
                  <span className="font-semibold text-ink-950">{r.name}</span>
                  <span className="ml-1.5 text-text-muted">{r.roleLabel}</span>
                  {!r.active ? <span className="ml-1.5 text-text-faint">(pasif — atanmaz)</span> : null}
                </span>
                <label className="flex min-h-9 items-center gap-1.5 font-semibold">
                  <input type="checkbox" name="is_away" defaultChecked={r.isAway} disabled={!editable} className="h-4 w-4" /> İzinli
                </label>
                <label className="flex items-center gap-1.5 text-text-muted">
                  dönüş
                  <input type="date" name="away_until" defaultValue={r.awayUntil ?? ""} disabled={!editable} className={`${fieldClass} w-36`} />
                </label>
                <input name="note" defaultValue={r.note ?? ""} maxLength={200} disabled={!editable} placeholder="Not (isteğe bağlı)" aria-label={`${r.name} izin notu`} className={`${fieldClass} w-44`} />
                {editable ? <Button type="submit" size="sm" variant="outline" loading={pending}>Kaydet</Button> : null}
              </form>
            </li>
          );
        })}
      </ul>
      <Status state={state} />
    </div>
  );
}
