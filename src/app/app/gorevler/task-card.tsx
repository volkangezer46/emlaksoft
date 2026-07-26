"use client";

import { useContext, useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Clock, FileText, Loader2, MapPin, Phone, Repeat, RotateCcw, Trash2, User } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { completeTask, deleteTask, reopenTask } from "@/app/actions/tasks";
import { useToast } from "@/components/app/toast-provider";
import { TaskEditDialog } from "./task-edit-dialog";
import { OptimisticDoneContext } from "./task-bulk-list";

type Rel = { full_name?: string } | { full_name?: string }[] | null;

export type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  kind: string;
  priority: string;
  status: string;
  due_at: string | null;
  assigned_to: string | null;
  customer_id: string | null;
  property_id: string | null;
  recurrence: string | null;
  assignee: Rel;
  customer: Rel;
};

const RECURRENCE_LABELS: Record<string, string> = {
  daily: "Her gün",
  weekly: "Her hafta",
  biweekly: "İki haftada bir",
  monthly: "Her ay",
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
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  // React 19 optimistic desen: tamamla/yeniden aç anında yansır, action arkada
  // çalışır. Transition bitince taban `task.status`a dönülür — başarıda
  // revalidate edilmiş veri aynı durumu getirir, hatada kart kendiliğinden
  // eski haline döner (+ toast ve refresh).
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(task.status);
  // Toplu tamamlamada seçili kartlar da anında "done" görünsün (TaskBulkList).
  const bulkDone = useContext(OptimisticDoneContext);
  const done = optimisticStatus === "done" || bulkDone.has(task.id);

  function setStatus(next: "done" | "open") {
    if (pending) return; // çifte tıklama koruması
    startTransition(async () => {
      setOptimisticStatus(next); // satır ANINDA soluklaşır / geri açılır
      const fd = new FormData();
      fd.set("id", task.id);
      try {
        if (next === "done") {
          const result = await completeTask(fd);
          // Tekrarlı görev: sonraki kopya action içinde üretildi — tarihi bildir.
          if (result?.nextDueAt) {
            const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(result.nextDueAt));
            push(`Görev tamamlandı — sonraki oluşturuldu: ${fmt}`, "ok");
          }
        } else {
          await reopenTask(fd);
        }
      } catch {
        push(next === "done" ? "Görev tamamlanamadı" : "Görev yeniden açılamadı", "err");
        router.refresh();
      }
    });
  }

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
      ) : canEdit && !done ? (
        // Müşterisiz/portföysüz görevde gidilecek kayıt yok — kartın kendisi
        // düzenleme diyaloğunu açar (overlay tetikleyicili ikinci diyalog örneği).
        <TaskEditDialog
          task={{ id: task.id, title: task.title, notes: task.notes, kind: task.kind, priority: task.priority, due_at: task.due_at, recurrence: task.recurrence }}
          variant="overlay"
        />
      ) : null}
      <span
        className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[11px] transition ${
          done ? "bg-mint-500/10 text-mint-600" : "bg-brand-600/10 text-brand-600"
        }`}
      >
        <meta.icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm font-semibold transition ${done ? "text-text-muted line-through" : "text-ink-950"}`}>{task.title}</p>
          <span className="rounded-full bg-ink-950/6 px-2 py-0.5 text-[11px] font-bold text-text-muted">{meta.label}</span>
          {task.recurrence && RECURRENCE_LABELS[task.recurrence] ? (
            <span className="flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[11px] font-bold text-cyan-600">
              <Repeat className="h-3 w-3" /> {RECURRENCE_LABELS[task.recurrence]}
            </span>
          ) : null}
          {highPr && !done ? (
            <span className="rounded-full bg-danger-500/10 px-2 py-0.5 text-[11px] font-bold text-danger-500">Yüksek</span>
          ) : null}
        </div>
        {task.notes ? <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">{task.notes}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className={`flex items-center gap-1 ${due.cls}`}>
            <Clock className="h-3 w-3" /> {due.text}
          </span>
          {assignee ? (
            task.assigned_to ? (
              <Link
                href={`/app/ekip/${task.assigned_to}`}
                className="relative z-10 flex items-center gap-1 text-text-muted transition hover:text-brand-600 hover:underline"
              >
                <User className="h-3 w-3" /> {assignee}
              </Link>
            ) : (
              <span className="flex items-center gap-1 text-text-muted">
                <User className="h-3 w-3" /> {assignee}
              </span>
            )
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
          <TaskEditDialog task={{ id: task.id, title: task.title, notes: task.notes, kind: task.kind, priority: task.priority, due_at: task.due_at, recurrence: task.recurrence }} />
        ) : null}
        {canEdit ? (
          done ? (
            /* `title=""` yerine Tip: klavye odagında da açılır, dokunmatikte
               kilitlenmez ve ekran dışına taşmaz. `aria-label` ayrıca şart —
               ikon-only butonda `title` ekran okuyucularda tutarlı okunmuyor. */
            <Tip label="Yeniden aç">
              <button
                type="button"
                onClick={() => setStatus("open")}
                disabled={pending}
                aria-label="Görevi yeniden aç"
                className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-line text-text-muted transition hover:border-brand-300 disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              </button>
            </Tip>
          ) : (
            <button
              type="button"
              onClick={() => setStatus("done")}
              disabled={pending}
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] bg-mint-500/10 px-3 py-2 text-xs font-semibold text-mint-600 transition hover:bg-mint-500/20 disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" /> Tamamla
            </button>
          )
        ) : null}
        {canDelete ? (
          <form action={deleteTask}>
            <input type="hidden" name="id" value={task.id} />
            <Tip label="Sil">
              <button type="submit" aria-label="Görevi sil" className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-line text-danger-500 transition hover:border-danger-500/40">
                <Trash2 className="h-4 w-4" />
              </button>
            </Tip>
          </form>
        ) : null}
      </div>
    </article>
  );
}
