"use client";

import { useContext, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { AlarmClock, Briefcase, CheckCircle2, Clock, FileText, Link2, ListChecks, Loader2, MapPin, Megaphone, MoreHorizontal, Pencil, Phone, Repeat, RotateCcw, ShieldAlert, Trash2, User } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { completeTask, deleteTask, reopenTask, rescheduleTasks } from "@/app/actions/tasks";
import { SwipeRow } from "@/components/ui/swipe-row";
import { useToast } from "@/components/app/toast-provider";
import { now as clockNow } from "@/lib/clock";
import { TaskEditDialog } from "./task-edit-dialog";
import { NoteText } from "@/components/app/note-text";
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
  recurrence_parent_id?: string | null;
  deal_id?: string | null;
  /** Anlaşma bağı etiketi (sunucuda `dealOptionLabel` ile çözülür). */
  deal_label?: string | null;
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
  // EİDS aksiyon motoru (sistem görevleri; elle oluşturulmaz, tür değiştirilmez).
  eids_publish: { label: "Yetki geldi", icon: Megaphone },
  eids_takedown: { label: "İlan kaldır", icon: ShieldAlert },
};

/** Sistem görevleri düzenleme diyaloğunda açılmaz (tür seçicisi bu türleri tanımaz); kaldırma görevi kontrol listesiyle kapanır. */
const SYSTEM_KINDS = new Set(["eids_publish", "eids_takedown"]);

function relName(v: Rel) {
  if (!v) return null;
  const row = Array.isArray(v) ? v[0] : v;
  return row?.full_name ?? null;
}

function dueInfo(due: string | null, done: boolean) {
  if (!due) return { text: "Tarihsiz", cls: "text-text-faint" };
  const d = new Date(due);
  const fmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" }).format(d);
  if (done) return { text: fmt, cls: "text-text-muted" };
  if (d.getTime() < clockNow()) return { text: `${fmt} · gecikti`, cls: "text-danger-500" };
  return { text: fmt, cls: "text-text-muted" };
}

export function TaskCard({
  task,
  canEdit,
  canDelete,
  members,
  deals,
  compact = false,
  focused = false,
}: {
  task: TaskRow;
  canEdit: boolean;
  canDelete: boolean;
  /** Düzenleme panelindeki "Atanan" seçici için ofis üyeleri. */
  members?: { id: string; name: string }[];
  /** Düzenleme panelindeki "İlgili anlaşma" seçici için seçenekler. */
  deals?: { id: string; label: string }[];
  /** Kanban sütunu: notu ve ikonu gizleyen dar kart. */
  compact?: boolean;
  /** Derin bağlantıyla (?gorev=<id>) açılan görev: vurgulanır, düzenleme paneli açık gelir. */
  focused?: boolean;
}) {
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
  // Düzenleme paneli ve silme onayı denetimli: masaüstü ikon düğmeleri ile mobil "…" menüsü aynı örneği açar.
  const [editOpen, setEditOpen] = useState(focused);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
            const fmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" }).format(new Date(result.nextDueAt));
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

  // GA-10 mobil kaydırma: sağa = Tamamla (geri alınabilir), sola = yarın 10:00 (toplu "Vadeyi taşı" ile aynı eylem).
  function swipeComplete() {
    setStatus("done");
    push("Görev tamamlandı", "ok", { action: { label: "Geri al", onClick: () => setStatus("open") } });
  }

  function swipeTomorrow() {
    startTransition(async () => {
      const res = await rescheduleTasks([task.id], "tomorrow10");
      if (res.error) {
        push(res.error, "err");
        return;
      }
      push("Görev yarın 10:00'a taşındı", "ok");
      router.refresh();
    });
  }

  async function removeTask() {
    const fd = new FormData();
    fd.set("id", task.id);
    try {
      const result = await deleteTask(fd);
      if (result.error) {
        push(result.error, "err");
        return;
      }
      push("Görev silindi", "ok");
      router.refresh();
    } catch {
      push("Görev silinemedi. Lütfen tekrar deneyin.", "err");
    }
  }

  const meta = KIND_META[task.kind] ?? KIND_META.other;
  const due = dueInfo(task.due_at, done);
  const assignee = relName(task.assignee);
  const customer = relName(task.customer);
  const highPr = task.priority === "high" || task.priority === "urgent";
  const urgent = task.priority === "urgent";
  const systemKind = SYSTEM_KINDS.has(task.kind);
  const takedown = task.kind === "eids_takedown";
  const href = takedown
    ? `/app/gorevler/eids/${task.id}`
    : task.customer_id
    ? `/app/musteriler/${task.customer_id}`
    : task.property_id
      ? `/app/portfoyler/${task.property_id}`
      : task.deal_id
        ? `/app/anlasmalar/${task.deal_id}`
        : null;
  // Tekrar zinciri: kök = recurrence_parent_id ya da (tekrarlıysa) görevin kendisi.
  const chainRoot = task.recurrence_parent_id ?? (task.recurrence ? task.id : null);
  const editTask = { id: task.id, title: task.title, notes: task.notes, kind: task.kind, priority: task.priority, due_at: task.due_at, recurrence: task.recurrence, assigned_to: task.assigned_to, deal_id: task.deal_id ?? null };

  const canEditHere = canEdit && !done && !systemKind;
  const canDeleteHere = canDelete && !takedown;

  return (
    <SwipeRow
      disabled={!canEditHere || pending}
      right={{ label: "Tamamla", icon: CheckCircle2, tone: "success", onAction: swipeComplete }}
      left={{ label: "Yarın 10:00", icon: AlarmClock, tone: "warning", onAction: swipeTomorrow }}
    >
    <article
      data-task-card=""
      data-task-id={task.id}
      // <640 px: iki satır (B133) — üstte başlık + meta tam genişlik, altta eylem satırı (Tamamla geniş, Düzenle/Sil "…"
      // menüsünde). Tek satırlı düzende 390 px'te metin sütununa 45 px kalıyor, kart 270-390 px uzuyordu.
      className={`group relative flex flex-col gap-2.5 rounded-[var(--radius-card)] border bg-surface px-4 py-3.5 transition sm:flex-row sm:items-start sm:gap-3 ${
        done ? "border-line opacity-70" : highPr ? "border-danger-500/25" : "border-line"
      }${focused ? " ring-2 ring-brand-300" : ""}`}
      aria-current={focused ? "true" : undefined}
    >
      {href ? (
        <Link href={href} className="absolute inset-0 rounded-[var(--radius-card)]" aria-label={`${task.title} kaydını aç`} />
      ) : canEditHere ? (
        // Müşterisiz/portföysüz görevde gidilecek kayıt yok — kartın kendisi
        // düzenleme diyaloğunu açar (overlay tetikleyicili ikinci diyalog örneği).
        <TaskEditDialog task={editTask} members={members} deals={deals} variant="overlay" />
      ) : null}
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {compact ? null : (
          <span
            className={`mt-0.5 hidden h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] transition sm:grid ${
              done ? "bg-mint-500/10 text-mint-600" : "bg-brand-600/10 text-brand-600"
            }`}
          >
            <meta.icon className="h-4 w-4" />
          </span>
        )}

        <div className="min-w-0 flex-1" data-task-text="">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-sm font-semibold transition ${done ? "text-text-muted line-through" : "text-ink-950"}`}>{task.title}</p>
            <span className="rounded-full bg-ink-950/6 px-2 py-0.5 text-xs font-bold text-text-muted">{meta.label}</span>
            {task.recurrence && RECURRENCE_LABELS[task.recurrence] ? (
              <span className="flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs font-bold text-cyan-600">
                <Repeat className="h-3 w-3" /> {RECURRENCE_LABELS[task.recurrence]}
              </span>
            ) : null}
            {highPr && !done ? (
              <span className="rounded-full bg-danger-500/10 px-2 py-0.5 text-xs font-bold text-danger-500">{urgent ? "Acil" : "Yüksek"}</span>
            ) : null}
            {task.priority === "low" && !done ? (
              <span className="rounded-full bg-ink-950/6 px-2 py-0.5 text-xs font-bold text-text-faint">Düşük</span>
            ) : null}
          </div>
          {task.notes && !compact ? <p className="mt-0.5 line-clamp-1 text-xs text-text-muted"><NoteText text={task.notes} /></p> : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
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
            {task.deal_id ? (
              <Link
                href={`/app/anlasmalar/${task.deal_id}`}
                className="relative z-10 flex items-center gap-1 font-semibold text-brand-600 hover:underline"
                title="Bağlı anlaşma"
              >
                <Briefcase className="h-3 w-3" /> {task.deal_label ?? "Anlaşma"}
              </Link>
            ) : null}
            {chainRoot ? (
              <Link
                href={`/app/gorevler?filter=all&zincir=${chainRoot}`}
                className="relative z-10 flex items-center gap-1 text-cyan-600 hover:underline"
                title="Bu tekrar zincirindeki tüm görevler"
              >
                <Link2 className="h-3 w-3" /> Tekrar zinciri
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {canEdit || canDeleteHere || takedown ? (
        <div className="relative z-10 flex shrink-0 items-center gap-1.5 max-sm:w-full">
          {canEditHere ? (
            <Button
              size="icon"
              variant="secondary"
              icon={Pencil}
              onClick={() => setEditOpen((v) => !v)}
              aria-label="Görevi düzenle"
              aria-expanded={editOpen}
              className="max-sm:hidden"
            />
          ) : null}
          {takedown ? (
            <Link
              href={`/app/gorevler/eids/${task.id}`}
              className="focus-ring press inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-danger-500/10 px-3 py-2 text-xs font-semibold text-danger-600 transition hover:bg-danger-500/20 max-sm:flex-1 touch:min-h-11"
            >
              <ListChecks className="h-4 w-4" /> Kontrol listesi
            </Link>
          ) : canEdit ? (
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
                  className="focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted transition hover:border-brand-300 disabled:opacity-50 touch:min-h-11 touch:min-w-11"
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                </button>
              </Tip>
            ) : (
              <button
                type="button"
                onClick={() => setStatus("done")}
                disabled={pending}
                className="focus-ring press inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-mint-500/10 px-3 py-2 text-xs font-semibold text-mint-600 transition hover:bg-mint-500/20 disabled:opacity-60 max-sm:flex-1 touch:min-h-11"
              >
                <CheckCircle2 className="h-4 w-4" /> Tamamla
              </button>
            )
          ) : null}
          {canDeleteHere ? (
            <Button
              size="icon"
              variant="secondary"
              icon={Trash2}
              onClick={() => setDeleteOpen(true)}
              aria-label="Görevi sil"
              className="text-danger-500 hover:border-danger-500/40 max-sm:hidden"
            />
          ) : null}
          {canEditHere || canDeleteHere ? (
            // <640 px: Düzenle ve Sil "…" menüsünde (kart iki satır; eylem satırında Tamamla geniş).
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="secondary" icon={MoreHorizontal} aria-label={`Diğer işlemler: ${task.title}`} className="ml-auto shrink-0 sm:hidden" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {canEditHere ? (
                  <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                    <Pencil aria-hidden="true" /> Düzenle
                  </DropdownMenuItem>
                ) : null}
                {canDeleteHere ? (
                  <DropdownMenuItem danger onSelect={() => setDeleteOpen(true)}>
                    <Trash2 aria-hidden="true" /> Sil…
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
      {canEditHere ? (
        <TaskEditDialog task={editTask} members={members} deals={deals} variant="none" open={editOpen} onOpenChange={setEditOpen} />
      ) : null}
      {canDeleteHere ? (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Görevi sil"
          description={`“${task.title}” kalıcı olarak silinecek. Bu işlem geri alınamaz.`}
          confirmLabel="Sil"
          onConfirm={removeTask}
        />
      ) : null}
    </article>
    </SwipeRow>
  );
}
