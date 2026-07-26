"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, ListChecks, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { completeTask, createTask, deleteTask, reopenTask } from "@/app/actions/tasks";

export type CustomerTaskRow = {
  id: string;
  title: string;
  kind: string;
  priority: string;
  status: string;
  due_at: string | null;
};

const KIND_LABEL: Record<string, string> = {
  followup: "Takip",
  call: "Arama",
  visit: "Ziyaret",
  document: "Evrak",
  other: "Diğer",
};

export function CustomerTasks({
  customerId,
  tasks,
  canCreate,
  canEdit,
  canDelete,
}: {
  customerId: string;
  tasks: CustomerTaskRow[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nowTs] = useState(() => Date.now());

  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");

  async function submit(formData: FormData) {
    setError(null);
    formData.set("customer_id", customerId);
    const res = await createTask({}, formData);
    if (res.error) {
      setError(res.error);
      return;
    }
    setAdding(false);
    router.refresh();
  }

  // completeTask artık sonraki tekrar bilgisini döndürüyor — dönüş burada kullanılmaz.
  function act(fn: (fd: FormData) => Promise<unknown>, id: string) {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      await fn(fd);
      router.refresh();
    });
  }

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <ListChecks className="h-4 w-4 text-brand-600" /> Görevler & takip
          </h2>
          <p className="text-xs text-text-muted">{open.length} açık · {done.length} tamamlanan</p>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-ink-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-ink-800"
          >
            <Plus className="h-3.5 w-3.5" /> Görev ekle
          </button>
        ) : null}
      </div>

      {adding ? (
        <form action={submit} className="mt-4 grid gap-2 rounded-[14px] border border-line bg-canvas p-3 sm:grid-cols-[1fr_auto_auto_auto]">
          <input name="title" required placeholder="Görev başlığı" className="rounded-[9px] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-400" />
          <select name="kind" defaultValue="followup" className="rounded-[9px] border border-line bg-surface px-2 py-2 text-sm outline-none focus:border-brand-400">
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input name="due_at" type="datetime-local" className="rounded-[9px] border border-line bg-surface px-2 py-2 text-sm outline-none focus:border-brand-400" />
          <button type="submit" className="rounded-[9px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Ekle</button>
          {error ? <p className="text-sm text-danger-500 sm:col-span-4">{error}</p> : null}
        </form>
      ) : null}

      <div className="mt-4 space-y-2">
        {open.length === 0 && done.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">Bu müşteri için görev yok.</p>
        ) : null}
        {[...open, ...done].map((t) => {
          const isDone = t.status === "done";
          const overdue = !isDone && t.due_at && new Date(t.due_at).getTime() < nowTs;
          return (
            <div key={t.id} className={`flex items-center gap-3 rounded-[12px] border px-3 py-2.5 ${isDone ? "border-line opacity-70" : "border-line"}`}>
              <span className="min-w-0 flex-1">
                <span className={`text-sm font-semibold ${isDone ? "text-text-muted line-through" : "text-ink-950"}`}>{t.title}</span>
                <span className="mt-0.5 flex items-center gap-2 text-[11px] text-text-muted">
                  <span className="rounded-full bg-ink-950/6 px-2 py-0.5 font-bold">{KIND_LABEL[t.kind] ?? "Görev"}</span>
                  {t.due_at ? (
                    <span className={`flex items-center gap-1 ${overdue ? "text-danger-500" : ""}`}>
                      <Clock className="h-3 w-3" /> {new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(t.due_at))}
                      {overdue ? " · gecikti" : ""}
                    </span>
                  ) : null}
                </span>
              </span>
              {canEdit ? (
                isDone ? (
                  <Tip label="Yeniden aç">
                    <button type="button" disabled={pending} onClick={() => act(reopenTask, t.id)} aria-label="Görevi yeniden aç" className="focus-ring press grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[8px] border border-line text-text-muted transition hover:border-brand-300">
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </Tip>
                ) : (
                  <Tip label="Tamamla">
                    <button type="button" disabled={pending} onClick={() => act(completeTask, t.id)} aria-label="Görevi tamamla" className="focus-ring press grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[8px] bg-mint-500/10 text-mint-600 transition hover:bg-mint-500/20">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </button>
                  </Tip>
                )
              ) : null}
              {canDelete ? (
                <Tip label="Sil">
                  <button type="button" disabled={pending} onClick={() => act(deleteTask, t.id)} aria-label="Görevi sil" className="focus-ring press grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[8px] border border-line text-danger-500 transition hover:border-danger-500/40">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </Tip>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
