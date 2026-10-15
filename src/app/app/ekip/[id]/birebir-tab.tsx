import Link from "@/components/ui/smart-link";
import { CalendarClock, ClipboardList, MessagesSquare } from "lucide-react";
import { now, trDayKey } from "@/lib/clock";
import { trMonthContext } from "@/lib/team/scorecard";
import { EmptyStateV3 } from "@/components/ui/empty-state";
import { COACHING_STALE_DAYS, SNAPSHOT_FIELDS, daysSince, sanitizeSnapshot, type CoachingSnapshot } from "@/lib/coaching/logic";
import { loadLeadData } from "./advisor-data";
import type { Ctx } from "./tab-panels";
import { CoachingSessionForm, CommitmentToggle, DeleteSessionButton } from "./coaching-form";

type Commitment = { id: string; body: string; due_on: string | null; task_id: string | null; done_at: string | null };
type Session = {
  id: string;
  manager_id: string | null;
  held_at: string;
  notes: string | null;
  snapshot: unknown;
  next_at: string | null;
  manager: { full_name: string | null } | { full_name: string | null }[] | null;
  commitments: Commitment[] | null;
};

const dtFmt = (iso: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" }).format(new Date(iso));
const dayFmt = (key: string) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${key}T12:00:00.000Z`));

function SnapshotChips({ snap }: { snap: CoachingSnapshot }) {
  const items = SNAPSHOT_FIELDS.filter((f) => typeof snap[f.key] === "number");
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Görüşme anındaki karne">
      {items.map((f) => (
        <li key={f.key} className="rounded-full bg-ink-950/[0.05] px-2.5 py-0.5 text-xs text-text-muted">
          {f.label}: <span className="numeric font-semibold text-ink-950">{snap[f.key]}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Danışman 360 > Birebir (OA8): yöneticinin danışmanla haftalık görüşme kaydı, o anki karne, taahhütler ve takibi.
 * Gizlilik RLS'tedir (danışman, görüşmeyi yapan, owner/gm, aynı şubenin müdürü); ekip arkadaşları göremez.
 */
export async function BirebirTab({ ctx, canWrite, viewerId }: { ctx: Ctx; canWrite: boolean; viewerId: string }) {
  const { supabase, id, isSelf } = ctx;
  const nowMs = now();
  const today = trDayKey(nowMs);
  const { data, error } = await supabase
    .from("coaching_sessions")
    .select(
      "id, manager_id, held_at, notes, snapshot, next_at, manager:profiles!coaching_sessions_manager_id_fkey(full_name), commitments:coaching_commitments(id, body, due_on, task_id, done_at)",
    )
    .eq("profile_id", id)
    .order("held_at", { ascending: false })
    .limit(20);
  if (error) {
    return <EmptyStateV3 title="Birebir görüşmeler henüz etkin değil" description="Bu özellik bu ortamda kurulum bekliyor." />;
  }
  const sessions = (data ?? []) as Session[];

  // Yeni görüşmenin karne özeti: aylık sayılar (tek kaynak) + erken işaretler.
  let snapshot = "{}";
  if (canWrite) {
    const [month, lead] = await Promise.all([ctx.monthP, loadLeadData(supabase, id)]);
    snapshot = JSON.stringify({
      month: trMonthContext(nowMs).monthKey,
      newCustomers: month.kpis.customers.cur,
      appointments: month.kpis.appointments.cur,
      offers: month.kpis.offers.cur,
      deals: month.kpis.deals.cur,
      calls: month.kpis.callsCur,
      overdueTasks: lead.overdueTasks,
      staleCustomers: lead.staleCustomers,
    });
  }

  const openCommitments = sessions.flatMap((s) => (s.commitments ?? []).filter((c) => !c.done_at));
  const last = sessions[0] ?? null;
  const since = daysSince(last?.held_at, nowMs);
  const nextAt = last?.next_at ?? null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
            <MessagesSquare className="h-3.5 w-3.5" aria-hidden /> Son görüşme
          </p>
          <p className={`mt-1 text-sm font-semibold ${since !== null && since > COACHING_STALE_DAYS ? "text-amber-700" : "text-ink-950"}`}>
            {since === null ? "Henüz yok" : since === 0 ? "Bugün" : `${since} gün önce`}
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Sonraki görüşme
          </p>
          <p className={`mt-1 text-sm font-semibold ${nextAt && nextAt < today ? "text-amber-700" : "text-ink-950"}`}>
            {nextAt ? `${dayFmt(nextAt)}${nextAt < today ? " (geçti)" : ""}` : "Planlanmadı"}
          </p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden /> Açık taahhüt
          </p>
          <p className="numeric mt-1 text-sm font-semibold text-ink-950">{openCommitments.length}</p>
        </div>
      </div>

      {canWrite ? <CoachingSessionForm profileId={id} snapshot={snapshot} today={today} /> : null}

      {sessions.length === 0 ? (
        <EmptyStateV3
          title={isSelf ? "Henüz birebir görüşmeniz yok" : "Henüz birebir görüşme yok"}
          description={
            isSelf
              ? "Yöneticiniz görüşmeyi kaydettiğinde notlar ve taahhütleriniz burada görünür."
              : "İlk görüşmeyi kaydedin: o anki karne otomatik eklenir, taahhütler tek dokunuşla görev olur."
          }
        />
      ) : (
        <ol className="space-y-3">
          {sessions.map((s) => {
            const manager = Array.isArray(s.manager) ? s.manager[0] : s.manager;
            const snap = sanitizeSnapshot(s.snapshot);
            const commitments = [...(s.commitments ?? [])].sort((a, b) => Number(Boolean(a.done_at)) - Number(Boolean(b.done_at)));
            const mine = s.manager_id === viewerId;
            return (
              <li key={s.id} className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-950">{dtFmt(s.held_at)}</p>
                    <p className="text-xs text-text-muted">
                      {manager?.full_name ?? "Yönetici"} ile{s.next_at ? ` · sonraki: ${dayFmt(s.next_at)}` : ""}
                    </p>
                  </div>
                  {mine ? <DeleteSessionButton id={s.id} /> : null}
                </div>
                <SnapshotChips snap={snap} />
                {s.notes ? <p className="whitespace-pre-line text-sm text-ink-950">{s.notes}</p> : null}
                {commitments.length > 0 ? (
                  <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
                    {commitments.map((c) => {
                      const overdue = !c.done_at && c.due_on && c.due_on < today;
                      return (
                        <li key={c.id} className="flex items-center gap-1 pr-3">
                          <CommitmentToggle id={c.id} done={Boolean(c.done_at)} label={c.body} disabled={!(isSelf || mine)} />
                          <span className="min-w-0 flex-1 py-2">
                            <span className={`block text-sm ${c.done_at ? "text-text-muted line-through" : "text-ink-950"}`}>{c.body}</span>
                            <span className="flex flex-wrap gap-x-2 text-xs text-text-muted">
                              {c.due_on ? <span className={overdue ? "font-semibold text-amber-700" : ""}>Termin {dayFmt(c.due_on)}</span> : null}
                              {c.task_id ? (
                                <Link href={`/app/gorevler?gorev=${c.task_id}`} className="font-semibold text-brand-600 hover:underline">
                                  Görevi aç
                                </Link>
                              ) : null}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
