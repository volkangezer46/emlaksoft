"use client";

import { createContext, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, X } from "lucide-react";
import { completeTasksBulk } from "@/app/actions/tasks";
import { useToast } from "@/components/app/toast-provider";

/**
 * Görev listesine toplu tamamlama katmanı.
 *
 * TaskCard içinde tekil aksiyon formları (tamamla/sil) olduğundan kartlar
 * tek bir dış <form> ile sarılamaz (iç içe form geçersiz HTML). Bu yüzden
 * seçim istemci state'inde tutulur, "Seçilenleri tamamla" server action'ı
 * FormData ile doğrudan çağırır (tek UPDATE, .in()).
 *
 * Optimistic akış (React 19): buton tıklandığı anda seçili kartlar bu
 * context üzerinden "tamamlandı" görünür (TaskCard soluklaşır + üstü çizilir),
 * action arkada çalışır. Transition bitince taban boş kümeye döner —
 * başarıda revalidate edilmiş veri görevleri zaten "done" getirir, hatada
 * kartlar kendiliğinden eski haline döner (+ toast ve refresh).
 */
export const OptimisticDoneContext = createContext<ReadonlySet<string>>(new Set());

type Item = {
  id: string;
  /** Yalnız açık görevler (ve edit yetkisi varsa) seçilebilir. */
  selectable: boolean;
  card: ReactNode;
};

const EMPTY_DONE: ReadonlySet<string> = new Set();

export function TaskBulkList({ items }: { items: Item[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();
  // Boş taban + birleştirici reducer: transition boyunca id'ler kümede kalır,
  // transition bitince taban boş kümeye döner (sunucu verisi artık "done" getirir).
  const [optimisticDone, markDone] = useOptimistic(
    EMPTY_DONE,
    (prev, ids: readonly string[]) => new Set([...prev, ...ids]) as ReadonlySet<string>,
  );

  const selectableIds = items.filter((i) => i.selectable).map((i) => i.id);
  const hasSelectable = selectableIds.length > 0;
  const allSelected = hasSelectable && selectableIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  function submit() {
    if (selected.size === 0 || pending) return; // çifte tıklama koruması
    const ids = [...selected];
    const fd = new FormData();
    ids.forEach((id) => fd.append("ids", id));
    startTransition(async () => {
      markDone(ids); // seçili görevler ANINDA tamamlanmış görünür
      setSelected(new Set());
      try {
        await completeTasksBulk(fd);
      } catch {
        push("Görevler tamamlanamadı", "err");
        router.refresh();
      }
    });
  }

  return (
    <OptimisticDoneContext.Provider value={optimisticDone}>
    <div className="space-y-2">
      {hasSelectable ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-300">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 accent-brand-600"
              aria-label="Tüm açık görevleri seç"
            />
            Tümünü seç
          </label>
          {selected.size > 0 ? (
            <>
              <span className="text-xs font-semibold text-ink-950">{selected.size} görev seçildi</span>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] bg-mint-500/10 px-3.5 py-2 text-xs font-semibold text-mint-600 transition hover:bg-mint-500/20 disabled:opacity-60"
              >
                <CheckCheck className="h-4 w-4" />
                Seçilenleri tamamla
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="focus-ring press inline-flex items-center gap-1 rounded-[10px] border border-line bg-surface px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-300"
              >
                <X className="h-3.5 w-3.5" /> Vazgeç
              </button>
            </>
          ) : (
            <span className="text-[11px] text-text-faint">Toplu tamamlamak için görevleri işaretleyin.</span>
          )}
        </div>
      ) : null}

      {items.map((item) => (
        <div key={item.id} className="flex items-stretch gap-2">
          {item.selectable ? (
            <label className="flex cursor-pointer items-center px-1">
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
                disabled={optimisticDone.has(item.id)}
                className="h-4 w-4 accent-brand-600 disabled:opacity-40"
                aria-label="Görevi seç"
              />
            </label>
          ) : hasSelectable ? (
            // Hizalama: seçilemeyen kartlar da aynı sol boşluğu korur.
            <span className="w-6 shrink-0" aria-hidden />
          ) : null}
          <div className="min-w-0 flex-1">{item.card}</div>
        </div>
      ))}
    </div>
    </OptimisticDoneContext.Provider>
  );
}

