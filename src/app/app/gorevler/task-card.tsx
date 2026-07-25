import Link from "next/link";
import { CheckCircle2, Clock, FileText, MapPin, Phone, RotateCcw, Trash2, User } from "lucide-react";
import { completeTask, deleteTask, reopenTask } from "@/app/actions/tasks";
import { TaskEditDialog } from "./task-edit-dialog";

type Rel = { full_name?: string } | { full_name?: string }[] | null;

export type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  kind: string;
  priority: string;
  status: string;
  due_at: string | null;
  customer_id: string | null;
  property_id: string | null;
  assignee: Rel;
  customer: Rel;
};

const KIND_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  followup: { label: "Takip", icon: Clock },
  call: { label: "Arama", icon: Phone },
  visit: { label: "Ziyaret", icon: MapPin },
  document: { label: "Evrak", icon: FileText },
  other: { label: "Diğer", icon: FileText },
};

function relName(v: Rel) {
  if (!v) return null;
  const row = Array.isArray(v) ? v[0] : v;
  return row?.full_name ?? null;
}

function dueInfo(due: string | null, done: boolean) {
  if (!due) return { text: "Tarihsiz", cls: "text-text-faint" };
  const d = new Date(due);
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(d);
  if (done) return { text: fmt, cls: "text-text-muted" };
  if (d.getTime() < now.getTime()) return { text: `${fmt} · gecikti`, cls: "text-danger-500" };
  return { text: fmt, cls: "text-text-muted" };
}

export function TaskCard({ task, canEdit, canDelete }: { task: TaskRow; canEdit: boolean; canDelete: boolean }) {
  const done = task.status === "done";
  const meta = KIND_META[task.kind] ?? KIND_META.other;
  const due = dueInfo(task.due_at, done);
  const assignee = relName(task.assignee);
  const customer = relName(task.customer);
  const highPr = task.priority === "high";
  const href = task.customer_id
    ? `/app/musteriler/${task.customer_id}`
    : task.property_id
      ? `/app/portfoyler/${task.property_id}`
      : null;

  return (
    <article
      className={`group relative flex items-start gap-3 rounded-[16px] border bg-surface px-4 py-3.5 transition ${
        done ? "border-line opacity-70" : highPr ? "border-danger-500/25" : "border-line"
      }`}
    >
      {href ? (
        <Link href={href} className="absolute inset-0 rounded-[16px]" aria-label={`${task.title} kaydını aç`} />
      ) : null}
      <span
        className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[11px] ${
          done ? "bg-mint-500/10 text-mint-600" : "bg-brand-600/10 text-brand-600"
        }`}
      >
        <meta.icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm font-semibold ${done ? "text-text-muted line-through" : "text-ink-950"}`}>{task.title}</p>
          <span className="rounded-full bg-ink-950/6 px-2 py-0.5 text-[10px] font-bold text-text-muted">{meta.label}</span>
          {highPr && !done ? (
            <span className="rounded-full bg-danger-500/10 px-2 py-0.5 text-[10px] font-bold text-danger-500">Yüksek</span>
          ) : null}
        </div>
        {task.notes ? <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">{task.notes}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className={`flex items-center gap-1 ${due.cls}`}>
            <Clock className="h-3 w-3" /> {due.text}
          </span>
          {assignee ? (
            <span className="flex items-center gap-1 text-text-muted">
              <User className="h-3 w-3" /> {assignee}
            </span>
          ) : null}
          {customer ? (
            <Link
              href={`/app/musteriler/${task.customer_id}`}
              className="relative z-10 flex items-center gap-1 font-semibold text-brand-600 hover:underline"
            >
              {customer}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="relative z-10 flex shrink-0 items-center gap-1.5">
        {canEdit && !done ? (
          <TaskEditDialog task={{ id: task.id, title: task.title, notes: task.notes, kind: task.kind, priority: task.priority, due_at: task.due_at }} />
        ) : null}
        {canEdit ? (
          done ? (
            <form action={reopenTask}>
              <input type="hidden" name="id" value={task.id} />
              <button type="submit" title="Yeniden aç" className="grid h-8 w-8 place-items-center rounded-[9px] border border-line text-text-muted hover:border-brand-300">
                <RotateCcw className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <form action={completeTask}>
              <input type="hidden" name="id" value={task.id} />
              <button type="submit" title="Tamamla" className="inline-flex items-center gap-1.5 rounded-[9px] bg-mint-500/10 px-3 py-2 text-xs font-semibold text-mint-600 hover:bg-mint-500/20">
                <CheckCircle2 className="h-4 w-4" /> Tamamla
              </button>
            </form>
          )
        ) : null}
        {canDelete ? (
          <form action={deleteTask}>
            <input type="hidden" name="id" value={task.id} />
            <button type="submit" title="Sil" className="grid h-8 w-8 place-items-center rounded-[9px] border border-line text-danger-500 hover:border-danger-500/40">
              <Trash2 className="h-4 w-4" />
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}
