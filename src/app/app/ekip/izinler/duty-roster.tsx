import Link from "@/components/ui/smart-link";
import { ArrowUpRight, ChevronLeft, ChevronRight, Radio, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { now, trDayKey, trParts } from "@/lib/clock";
import { getSetting } from "@/lib/settings/read";
import { DUTY_FIRST_KEY } from "@/lib/settings/registry/tenant";
import { isOnLeave, type LeaveLike } from "@/lib/leave-utils";
import { DUTY_SLOT_SHORT, addDays, isDutySlot, onDutyIds, weekDays, weekStartOf } from "@/lib/duty/logic";
import { DutyAddForm, DutyRemoveButton, DutyWeekActions } from "./duty-controls";

type ShiftRow = { id: string; profile_id: string; duty_date: string; slot: string; note: string | null };

const dayFmt = (key: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("tr-TR", { ...opts, timeZone: "UTC" }).format(new Date(`${key}T12:00:00.000Z`));

/**
 * Nöbet çizelgesi (OA7): haftalık görünüm, gün kartları (mobilde tek sütun liste). Herkes görür; ekip yöneticisi
 * (team:edit) ekler, kaldırır, haftayı dengeli dağıtır ya da geçen haftayı kopyalar. "Yeni talep önce nöbetçiye"
 * ayarı Kurallar ve varsayılanlar > Talep dağıtımı'ndadır; durum burada gösterilir.
 */
export async function DutyRoster({ weekParam, canManage }: { weekParam: string; canManage: boolean }) {
  const nowMs = now();
  const today = trDayKey(nowMs);
  const week = weekStartOf(weekParam, weekStartOf(today, today));
  const days = weekDays(week);
  const supabase = await createClient();
  const [shiftRes, memberRes, leaveRes, dutyFirst] = await Promise.all([
    supabase
      .from("duty_shifts")
      .select("id, profile_id, duty_date, slot, note")
      .gte("duty_date", days[0]!)
      .lte("duty_date", days[6]!)
      .order("duty_date", { ascending: true })
      .limit(500),
    supabase.from("profiles").select("id, full_name, role, is_active").eq("is_active", true).neq("role", "readonly").order("full_name").limit(300),
    supabase.from("staff_leaves").select("staff_id, starts_on, ends_on, status").lte("starts_on", days[6]!).gte("ends_on", days[0]!).limit(500),
    getSetting<boolean>(DUTY_FIRST_KEY).catch(() => false),
  ]);

  if (shiftRes.error) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-line px-4 py-10 text-center text-sm text-text-muted">
        Nöbet çizelgesi bu ortamda henüz etkin değil (kurulum bekliyor).
      </p>
    );
  }

  const shifts = (shiftRes.data ?? []) as ShiftRow[];
  const people = ((memberRes.data ?? []) as { id: string; full_name: string }[]).map((p) => ({ id: p.id, name: p.full_name }));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const leaves = (leaveRes.data ?? []) as LeaveLike[];
  const nowDuty = onDutyIds(shifts, today, trParts(nowMs).hour).map((id) => nameOf.get(id) ?? "Üye");
  const weekHref = (d: string) => `/app/ekip/izinler?sekme=nobet&hafta=${d}`;
  const emptyDays = days.filter((d) => new Date(`${d}T12:00:00.000Z`).getUTCDay() !== 0 && !shifts.some((s) => s.duty_date === d)).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-mint-500/12 text-mint-600">
            <Radio className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-muted">Şu an nöbetçi</p>
            <p className="text-sm font-semibold text-ink-950">{nowDuty.length ? nowDuty.join(", ") : "Nöbetçi yok"}</p>
          </div>
        </div>
        <Link
          href="/app/ayarlar/merkez?grup=dagitim"
          className="focus-ring lift group flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-brand-300"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
            <ShieldAlert className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-text-muted">Yeni talep önce nöbetçiye</span>
            <span className="block text-sm font-semibold text-ink-950">{dutyFirst ? "Açık" : "Kapalı"}</span>
            <span className="block text-xs text-text-muted">
              {dutyFirst ? "Vitrin, WhatsApp, telefon ve API talepleri o anki nöbetçiye gider." : "Açınca yeni talepler o anki nöbetçiye gider."}
            </span>
          </span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint group-hover:text-brand-600" aria-hidden />
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Hafta" className="flex items-center gap-1">
          <Link href={weekHref(addDays(week, -7))} className="focus-ring grid h-11 w-11 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted hover:text-ink-950" aria-label="Önceki hafta">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Link>
          <span className="min-w-0 px-2 text-sm font-semibold text-ink-950">
            {dayFmt(days[0]!, { day: "numeric", month: "short" })} – {dayFmt(days[6]!, { day: "numeric", month: "short", year: "numeric" })}
          </span>
          <Link href={weekHref(addDays(week, 7))} className="focus-ring grid h-11 w-11 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted hover:text-ink-950" aria-label="Sonraki hafta">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
          {week !== weekStartOf(today, today) ? (
            <Link href={weekHref(weekStartOf(today, today))} className="focus-ring inline-flex min-h-11 items-center px-2 text-xs font-semibold text-brand-600 hover:underline">
              Bu hafta
            </Link>
          ) : null}
        </nav>
        {canManage ? <DutyWeekActions week={week} /> : null}
      </div>

      {canManage && emptyDays > 0 ? (
        <p className="text-xs text-text-muted">Bu hafta {emptyDays} günde (pazar hariç) nöbetçi yok.</p>
      ) : null}

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {days.map((d) => {
          const rows = shifts.filter((s) => s.duty_date === d);
          const isToday = d === today;
          const label = dayFmt(d, { weekday: "long", day: "numeric", month: "long" });
          return (
            <li
              key={d}
              aria-current={isToday ? "date" : undefined}
              className={`flex flex-col gap-2 rounded-[var(--radius-card)] border p-3 ${isToday ? "border-brand-400/60 bg-brand-600/[0.04]" : "border-line bg-surface"}`}
            >
              <p className="text-sm font-semibold capitalize text-ink-950">
                {label}
                {isToday ? <span className="ml-1.5 rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-700">Bugün</span> : null}
              </p>
              {rows.length === 0 ? <p className="text-xs text-text-faint">Nöbetçi yok</p> : null}
              <ul className="space-y-1.5">
                {rows.map((r) => {
                  const name = nameOf.get(r.profile_id) ?? "Pasif üye";
                  const onLeave = isOnLeave(leaves, r.profile_id, d);
                  return (
                    <li key={r.id} className="flex items-center gap-2 rounded-[var(--radius-control)] bg-canvas px-2 py-1">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-950">{name}</span>
                        <span className="block text-xs text-text-muted">
                          {isDutySlot(r.slot) ? DUTY_SLOT_SHORT[r.slot] : r.slot}
                          {onLeave ? <span className="font-semibold text-amber-700"> · izinli</span> : null}
                          {r.note ? ` · ${r.note}` : ""}
                        </span>
                      </span>
                      {canManage ? <DutyRemoveButton id={r.id} label={`${name}, ${label}`} /> : null}
                    </li>
                  );
                })}
              </ul>
              {canManage ? <DutyAddForm day={d} dayLabel={label} people={people} /> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
