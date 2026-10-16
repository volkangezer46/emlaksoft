"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/app/toast-provider";
import { completeTask, reopenTask } from "@/app/actions/tasks";

/**
 * "Yapılacak görevlerim" satırının onay kutusu (istemci adası, ~1 KB): işaretlenince satır AYNI karede üstü çizili
 * görünür (iyimser; CSS `.kh-task:has(.kh-check:checked)`), görev kapanır ve "Geri al" bildirimi çıkar. Geri alınca
 * görev yeniden açılır. 44 px dokunma alanı (etiket kutusu), görünür kutu 18 px.
 */
export function GorevKutusu({ id, title }: { id: string; title: string }) {
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
  function toggle(next: boolean) {
    if (!next) return undo();
    setDone(true);
    start(async () => {
      await completeTask(form());
      push("Görev tamamlandı", "ok", { action: { label: "Geri al", onClick: undo } });
      router.refresh();
    });
  }
  return (
    <label className="kh-check-wrap focus-within:ring-2" title={done ? "Tamamlandı" : "Tamamla"}>
      <input type="checkbox" className="kh-check touch:size-5"
        checked={done}
        disabled={pending}
        onChange={(e) => toggle(e.currentTarget.checked)}
        aria-label={`${title}: ${done ? "tamamlandı, geri almak için işareti kaldırın" : "tamamlandı olarak işaretle"}`}
      />
    </label>
  );
}
