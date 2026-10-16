"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/app/toast-provider";
import { completeTask, reopenTask } from "@/app/actions/tasks";

/**
 * "Bugünüm" görev satırının TEK eylemi: her cihazda görünür, dolu, 44 px "Bitti" düğmesi (hover'a bağlı değil).
 * Basınca satır aynı karede soluklaşır (iyimser), görev kapanır ve "Geri al" bildirimi çıkar.
 */
export function BittiDugmesi({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const form = () => {
    const fd = new FormData();
    fd.set("id", id);
    return fd;
  };

  function undo() {
    setDone(false);
    start(async () => {
      const res = await reopenTask(form());
      if (res.error) push(res.error, "err");
      router.refresh();
    });
  }

  function complete() {
    setDone(true);
    start(async () => {
      await completeTask(form());
      push("Görev tamamlandı", "ok", { action: { label: "Geri al", onClick: undo } });
      router.refresh();
    });
  }

  if (done) {
    return (
      <span role="status" className="inline-flex h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-semibold text-[var(--pm-success-text)]">
        Bitti ✓
      </span>
    );
  }
  return (
    <Button size="lg" variant="secondary" icon={Check} loading={pending} onClick={complete} aria-label={`${title}: bitti`} className="h-11 min-w-11 shrink-0">
      Bitti
    </Button>
  );
}
