"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { duplicateAutomation, duplicateContract, duplicateProperty, restoreDeletedRecord, type RecordOpResult } from "@/app/actions/record-ops";
import { useToast } from "@/components/app/toast-provider";

type Kind = "property" | "contract" | "automation";

const ACTION: Record<Kind, (id: string) => Promise<RecordOpResult>> = {
  property: duplicateProperty,
  contract: duplicateContract,
  automation: duplicateAutomation,
};
const PATH: Record<Kind, (id: string) => string> = {
  property: (id) => `/app/portfoyler/${id}`,
  contract: (id) => `/app/sozlesmeler/${id}`,
  automation: (id) => `/app/otomasyonlar/${id}`,
};
const DONE: Record<Kind, string> = {
  property: "Portföy taslak olarak çoğaltıldı",
  contract: "Sözleşme taslak olarak çoğaltıldı",
  automation: "Otomasyon pasif olarak çoğaltıldı",
};

/** "Kaydı çoğalt": kopya oluşturur ve kopyaya gider (kopya taslak/pasif doğar). */
export function DuplicateRecordButton({ kind, id, className, label = "Çoğalt" }: { kind: Kind; id: string; className?: string; label?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const { push } = useToast();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await ACTION[kind](id);
          if (res.error || !res.id) {
            push(res.error ?? "Çoğaltılamadı", "err");
            return;
          }
          push(DONE[kind]);
          router.push(PATH[kind](res.id));
        })
      }
      className={
        className ??
        "focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300 disabled:opacity-60"
      }
    >
      <Copy className="h-3.5 w-3.5" aria-hidden /> {pending ? "Çoğaltılıyor…" : label}
    </button>
  );
}

/** Silme sonrası "Geri al" eylemli bildirim (çöp kutusu altyapısı). Kayıt geri alınınca detayına döner. */
export function useUndoDelete() {
  const router = useRouter();
  const { push } = useToast();
  return (entity: "customer" | "property", id: string, message: string) => {
    push(message, "ok", {
      action: {
        label: "Geri al",
        onClick: async () => {
          const res = await restoreDeletedRecord(entity, id);
          if (res.error) {
            push(res.error, "err");
            return;
          }
          push("Geri alındı");
          router.push(entity === "customer" ? `/app/musteriler/${id}` : `/app/portfoyler/${id}`);
        },
      },
    });
  };
}
