import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  PalmtreeIcon,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { TR_OFFSET_MIN } from "@/lib/booking-slots";
import {
  asLeaveKind,
  asLeaveStatus,
  isOnLeave,
  leaveDaysCount,
  LEAVE_KIND_LABELS,
  LEAVE_KIND_TONES,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_TONES,
  type LeaveLike,
} from "@/lib/leave-utils";
import { approveLeaveForm, deleteLeaveForm, rejectLeaveForm } from "@/app/actions/staff-leaves";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { AddLeaveDialog } from "./leave-form";

const DAY_MS = 86_400_000;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

type LeaveRow = LeaveLike & {
  id: string;
  note: string | null;
  kind: string;
  status: string;
};

/** "YYYY-MM-DD" → gün ekle/çıkar (UTC aritmetiği; tarih anahtarı saat taşımaz). */
function shiftDay(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Ay anahtarını (YYYY-MM) kaydır. */
function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const total = y! * 12 + (m! - 1) + delta;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey: string): string {
  return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${monthKey}-01T12:00:00.000Z`),
  );
}

function trDate(dateKey: string): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${dateKey}T12:00:00.000Z`),
  );
}

function rangeLabel(startsOn: string, endsOn: string): string {
  return startsOn === endsOn ? trDate(startsOn) : `${trDate(startsOn)} – ${trDate(endsOn)}`;
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
}

const WEEKDAY_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/**
 * Ekip izin & müsaitlik takvimi.
 *
 * NEDEN: Dalga P'de açılan online randevu linki (/randevu-al/[token]) danışman
 * izne çıktığında da slot üretmeye devam ediyordu — sistemin "kim izinde"
 * bilgisi hiç yoktu. Buradaki ONAYLI kayıtlar hem bu sayfadaki takvimi hem de
 * public slot üretimini besler (bkz. src/lib/leave-utils.ts).
 *
 * FİLTRE KONTRATI: ?ay=YYYY-MM takvim ayını, ?gecmis=1 yandaki listeyi geçmişe
 * çevirir; ikisi de sunucu sorgusuna iner.
 *
 * ZAMAN: render'da `new Date()` yok — `now()` (clock.ts) + sabit TR ofseti ile
 * duvar günü hesaplanır (booking-slots.ts ile aynı karar: TR'de DST yok).
 */
export default async function LeavesPage({
  searchParams,
}: {
  searchParams?: Promise<{ ay?: string; gecmis?: string }>;
}) {
  const gate = await requireModulePage("team");
  const canManage = (gate.perms.team ?? []).includes("edit");
  const supabase = await createClient();
  const sp = (await searchParams) ?? {};

  // ---- Bugün (TR duvar günü) ----
  const nowMs = now();
  const today = new Date(nowMs + TR_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const monthKey = MONTH_RE.test(sp.ay ?? "") ? sp.ay! : currentMonth;
  const gecmis = sp.gecmis === "1";

  // ---- Takvim ızgarası (7 sütun, pazartesi başlangıçlı) ----
  const monthStart = `${monthKey}-01`;
  const monthStartMs = Date.parse(`${monthStart}T00:00:00.000Z`);
  const nextMonthStartMs = Date.parse(`${shiftMonth(monthKey, 1)}-01T00:00:00.000Z`);
  const daysInMonth = Math.round((nextMonthStartMs - monthStartMs) / DAY_MS);
  const monthEnd = shiftDay(`${shiftMonth(monthKey, 1)}-01`, -1);
  // JS getUTCDay: pazar=0 → pazartesi başlangıçlı ızgarada kaç boş hücre var.
  const firstWeekday = (new Date(monthStartMs).getUTCDay() + 6) % 7;

  const [{ data: memberRows }, { data: monthLeaveRows }, { data: listLeaveRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, is_active")
      .order("full_name", { ascending: true })
      .limit(500),
    // Ay ızgarası: ayla KESİŞEN tüm kayıtlar (aya taşan izinler dahil).
    supabase
      .from("staff_leaves")
      .select("id, staff_id, starts_on, ends_on, kind, status, note")
      .lte("starts_on", monthEnd)
      .gte("ends_on", monthStart)
      .order("starts_on", { ascending: true })
      .limit(500),
    // Yan liste: yaklaşan (bugün dahil ileri) ya da ?gecmis=1 ile bitmiş olanlar.
    gecmis
      ? supabase
          .from("staff_leaves")
          .select("id, staff_id, starts_on, ends_on, kind, status, note")
          .lt("ends_on", today)
          .order("starts_on", { ascending: false })
          .limit(50)
      : supabase
          .from("staff_leaves")
          .select("id, staff_id, starts_on, ends_on, kind, status, note")
          .gte("ends_on", today)
          .order("starts_on", { ascending: true })
          .limit(50),
  ]);

  const members = (memberRows ?? []) as { id: string; full_name: string; is_active: boolean }[];
  const nameById = new Map(members.map((m) => [m.id, m.full_name]));
  const monthLeaves = (monthLeaveRows ?? []) as LeaveRow[];
  const listLeaves = (listLeaveRows ?? []) as LeaveRow[];

  const selfName = nameById.get(gate.userId) ?? "Siz";
  const selectableMembers = canManage
    ? members.filter((m) => m.is_active || m.id === gate.userId).map((m) => ({ id: m.id, full_name: m.full_name }))
    : [{ id: gate.userId, full_name: selfName }];

  // ---- Çakışma uyarısı: izin aralığında o kişinin randevusu var mı? ----
  // Listelenen izinlerin tümünü kapsayan TEK pencere ile tek sorgu; sayım JS'te.
  const conflictByLeave = new Map<string, number>();
  const activeListLeaves = listLeaves.filter((l) => asLeaveStatus(l.status) !== "reddedildi");
  if (activeListLeaves.length > 0) {
    const from = activeListLeaves.reduce((a, l) => (l.starts_on < a ? l.starts_on : a), activeListLeaves[0]!.starts_on);
    const to = activeListLeaves.reduce((a, l) => (l.ends_on > a ? l.ends_on : a), activeListLeaves[0]!.ends_on);
    const { data: apptRows } = await supabase
      .from("appointments")
      .select("assigned_to, scheduled_at")
      .neq("status", "cancelled")
      .gte("scheduled_at", `${from}T00:00:00.000Z`)
      .lt("scheduled_at", `${shiftDay(to, 1)}T00:00:00.000Z`)
      .limit(2000);

    const appts = ((apptRows ?? []) as { assigned_to: string | null; scheduled_at: string }[]).map((r) => ({
      staffId: r.assigned_to ?? "",
      // Randevu anı TR duvar gününe çevrilir — izin de duvar günü tutar.
      day: new Date(Date.parse(r.scheduled_at) + TR_OFFSET_MIN * 60_000).toISOString().slice(0, 10),
    }));
    for (const l of activeListLeaves) {
      const count = appts.filter((a) => a.staffId === l.staff_id && a.day >= l.starts_on && a.day <= l.ends_on).length;
      if (count > 0) conflictByLeave.set(l.id, count);
    }
  }

  // ---- Ay ızgarası hücreleri ----
  const cells = Array.from({ length: daysInMonth }).map((_, i) => {
    const dateKey = shiftDay(monthStart, i);
    const onLeave = monthLeaves.filter(
      (l) => asLeaveStatus(l.status) !== "reddedildi" && l.starts_on <= dateKey && dateKey <= l.ends_on,
    );
    return { dateKey, dayNum: i + 1, onLeave, isToday: dateKey === today, isWeekend: (firstWeekday + i) % 7 >= 5 };
  });

  // ---- KPI'lar ----
  const todayOnLeave = members.filter((m) => isOnLeave(monthLeaves, m.id, today));
  const pendingCount = listLeaves.filter((l) => asLeaveStatus(l.status) === "talep").length;
  const monthLeaveDays = cells.filter((c) => c.onLeave.some((l) => asLeaveStatus(l.status) === "onayli")).length;

  const monthHref = (patch: { ay?: string; gecmis?: string }) => {
    const q = new URLSearchParams();
    const ay = patch.ay !== undefined ? patch.ay : monthKey;
    const g = patch.gecmis !== undefined ? patch.gecmis : gecmis ? "1" : "";
    if (ay && ay !== currentMonth) q.set("ay", ay);
    if (g === "1") q.set("gecmis", "1");
    const s = q.toString();
    return s ? `/app/ekip/izinler?${s}` : "/app/ekip/izinler";
  };

  const kpis = [
    { label: "Bugün izinde", value: todayOnLeave.length, icon: PalmtreeIcon, href: monthHref({ ay: currentMonth }) },
    { label: "Onay bekleyen", value: pendingCount, icon: Clock3, href: monthHref({ gecmis: "" }) },
    { label: "Bu ay izinli gün", value: monthLeaveDays, icon: CalendarDays, href: monthHref({}) },
    { label: "Ekip üyesi", value: members.length, icon: UserRound, href: "/app/ekip" },
  ];

  return (
    <div className="space-y-6">
      {/* premium header */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-mint-500/25 blur-[90px]" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
                <CalendarRange className="h-4 w-4" /> Ekip müsaitliği
              </span>
              <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">İzin takvimi</h1>
              <p className="mt-1 max-w-lg text-sm text-white/60">
                Kim bugün sahada, kim izinde? Onaylanan izinlerde danışmanın online randevu linki o günler için
                otomatik kapanır — müşteri izinli güne randevu alamaz.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/app/ekip"
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <ArrowLeft className="h-4 w-4" /> Ekip
              </Link>
              <AddLeaveDialog
                members={selectableMembers}
                canManage={canManage}
                selfId={gate.userId}
                selfName={selfName}
                today={today}
              />
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpis.map((k) => (
              <Link
                key={k.label}
                href={k.href}
                className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur hover:border-white/30"
              >
                <span className="flex items-start justify-between">
                  <k.icon className="h-4 w-4 text-mint-400" />
                  <ArrowUpRight className="hover-action h-4 w-4 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
                </span>
                <p className="mt-2 font-display text-xl font-extrabold text-white">{k.value}</p>
                <p className="text-[11px] text-white/45 sm:text-xs">{k.label}</p>
              </Link>
            ))}
          </div>

          {todayOnLeave.length > 0 ? (
            <div className="relative mt-4 flex flex-wrap items-center gap-2 rounded-[14px] border border-white/10 bg-white/[0.04] px-4 py-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">Bugün izinde</span>
              {todayOnLeave.map((m) => (
                <Link
                  key={m.id}
                  href={`/app/ekip/${m.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-bold text-amber-300 transition hover:bg-amber-400/25"
                >
                  <PalmtreeIcon className="h-3 w-3" /> {m.full_name}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        {/* ---- Ay ızgarası ---- */}
        <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                <CalendarDays className="h-4 w-4 text-brand-600" /> {monthLabel(monthKey)}
              </h2>
              <p className="text-xs text-text-muted">
                {monthLeaveDays} gün izinli personel var · {monthLeaves.length} kayıt
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Link
                href={monthHref({ ay: shiftMonth(monthKey, -1) })}
                aria-label="Önceki ay"
                className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              {monthKey !== currentMonth ? (
                <Link
                  href={monthHref({ ay: currentMonth })}
                  className="focus-ring press rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
                >
                  Bu ay
                </Link>
              ) : null}
              <Link
                href={monthHref({ ay: shiftMonth(monthKey, 1) })}
                aria-label="Sonraki ay"
                className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="p-4">
            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAY_SHORT.map((w) => (
                <div key={w} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">
                  {w}
                </div>
              ))}
              {Array.from({ length: firstWeekday }).map((_, i) => (
                <div key={`bos-${i}`} />
              ))}
              {cells.map((c) => (
                <div
                  key={c.dateKey}
                  className={`min-h-[74px] rounded-[11px] border p-1.5 transition ${
                    c.isToday
                      ? "border-brand-400 bg-brand-600/[0.04]"
                      : c.isWeekend
                        ? "border-line bg-canvas/60"
                        : "border-line bg-canvas/30"
                  }`}
                >
                  <p
                    className={`text-[11px] font-bold tabular-nums ${
                      c.isToday ? "text-brand-600" : c.isWeekend ? "text-text-faint" : "text-text-muted"
                    }`}
                  >
                    {c.dayNum}
                  </p>
                  <div className="mt-1 space-y-1">
                    {c.onLeave.slice(0, 3).map((l) => {
                      const kind = asLeaveKind(l.kind);
                      const pending = asLeaveStatus(l.status) === "talep";
                      return (
                        <span
                          key={l.id}
                          title={`${nameById.get(l.staff_id) ?? "Personel"} — ${LEAVE_KIND_LABELS[kind]}${pending ? " (onay bekliyor)" : ""}`}
                          className={`block truncate rounded-[6px] px-1.5 py-0.5 text-[10px] font-bold ${LEAVE_KIND_TONES[kind]} ${pending ? "opacity-55 ring-1 ring-inset ring-current" : ""}`}
                        >
                          {nameById.get(l.staff_id) ?? "Personel"}
                        </span>
                      );
                    })}
                    {c.onLeave.length > 3 ? (
                      <span className="block px-1.5 text-[10px] font-semibold text-text-faint">
                        +{c.onLeave.length - 3} kişi
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {/* Renk anahtarı — rozetin ne anlattığı ızgaraya bakınca anlaşılsın */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[11px] text-text-muted">
              <span className="font-semibold">Tür:</span>
              {(Object.keys(LEAVE_KIND_LABELS) as (keyof typeof LEAVE_KIND_LABELS)[]).map((k) => (
                <span key={k} className={`rounded-full px-2 py-0.5 font-bold ${LEAVE_KIND_TONES[k]}`}>
                  {LEAVE_KIND_LABELS[k]}
                </span>
              ))}
              <span className="ml-1">· soluk + çerçeveli rozet: onay bekliyor</span>
            </div>
          </div>
        </section>

        {/* ---- Liste ---- */}
        <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                {gecmis ? <History className="h-4 w-4 text-brand-600" /> : <CalendarRange className="h-4 w-4 text-brand-600" />}
                {gecmis ? "Geçmiş izinler" : "Yaklaşan izinler"}
              </h2>
              <p className="text-xs text-text-muted">{listLeaves.length} kayıt</p>
            </div>
            <Link
              href={monthHref({ gecmis: gecmis ? "" : "1" })}
              className="focus-ring press rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
            >
              {gecmis ? "Yaklaşanlar" : "Geçmiş"}
            </Link>
          </div>

          {listLeaves.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={PalmtreeIcon}
                tone="mint"
                title={gecmis ? "Geçmiş izin kaydı yok" : "Yaklaşan izin yok"}
                description={
                  gecmis
                    ? "Bitmiş izin bulunmuyor. Yaklaşan izinlere dönebilirsiniz."
                    : "Ekipte planlanmış izin yok. İzin ekleyerek takvimi ve randevu linkini birlikte güncel tutun."
                }
              />
            </div>
          ) : (
            <div className="divide-y divide-line">
              {listLeaves.map((l) => {
                const kind = asLeaveKind(l.kind);
                const status = asLeaveStatus(l.status);
                const days = leaveDaysCount(l.starts_on, l.ends_on);
                const conflicts = conflictByLeave.get(l.id) ?? 0;
                const name = nameById.get(l.staff_id) ?? "Personel";
                const isSelf = l.staff_id === gate.userId;
                // Yetkisiz kullanıcı yalnız kendi TALEBİNİ geri çekebilir (action ile aynı kural).
                const canDelete = canManage || (isSelf && status === "talep");
                return (
                  <article key={l.id} className="px-5 py-4 transition hover:bg-brand-600/[0.02]">
                    <div className="flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-[image:var(--grad-brand)] text-[11px] font-bold text-white">
                        {initials(name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/app/ekip/${l.staff_id}`}
                            className="truncate text-sm font-semibold text-ink-950 transition hover:text-brand-600"
                          >
                            {name}
                          </Link>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${LEAVE_KIND_TONES[kind]}`}>
                            {LEAVE_KIND_LABELS[kind]}
                          </span>
                          {status !== "onayli" ? (
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${LEAVE_STATUS_TONES[status]}`}>
                              {LEAVE_STATUS_LABELS[status]}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-text-muted">
                          <span className="font-semibold text-ink-950">{rangeLabel(l.starts_on, l.ends_on)}</span> · {days} gün
                        </p>
                        {l.note ? <p className="mt-1 line-clamp-2 text-xs text-text-faint">{l.note}</p> : null}

                        {conflicts > 0 ? (
                          <Link
                            href={`/app/randevular?gorunum=gun&tarih=${l.starts_on}`}
                            className="focus-ring group mt-2 flex items-center gap-2 rounded-[10px] border border-amber-400/30 bg-amber-400/8 px-3 py-2 text-[11px] font-semibold text-amber-600 transition hover:border-amber-400/60"
                          >
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            Bu aralıkta {conflicts} randevusu var — devretmeyi unutmayın.
                            <ArrowUpRight className="hover-action h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
                          </Link>
                        ) : null}

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {canManage && status !== "onayli" ? (
                            <form action={approveLeaveForm}>
                              <input type="hidden" name="id" value={l.id} />
                              <button
                                type="submit"
                                className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-mint-600 transition hover:border-mint-500/40"
                              >
                                <CheckCircle2 className="h-3 w-3" /> Onayla
                              </button>
                            </form>
                          ) : null}
                          {canManage && status !== "reddedildi" ? (
                            <form action={rejectLeaveForm}>
                              <input type="hidden" name="id" value={l.id} />
                              <button
                                type="submit"
                                className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-danger-500 transition hover:border-danger-500/40"
                              >
                                <XCircle className="h-3 w-3" /> Reddet
                              </button>
                            </form>
                          ) : null}
                          {canDelete ? (
                            <ConfirmDialog
                              trigger={
                                <button
                                  type="button"
                                  title="Sil"
                                  className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-text-muted transition hover:border-danger-500/40 hover:text-danger-500"
                                >
                                  <Trash2 className="h-3 w-3" /> Sil
                                </button>
                              }
                              title="İzin kaydı silinsin mi?"
                              description={`${name} · ${rangeLabel(l.starts_on, l.ends_on)} kaydı kalıcı olarak silinir. Onaylıysa o günler randevuya yeniden açılır.`}
                              confirmLabel="Kalıcı sil"
                              formAction={deleteLeaveForm}
                              hiddenFields={{ id: l.id }}
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
