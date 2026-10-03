"use client";

import { useRef, useState, useTransition } from "react";
import { Zap } from "lucide-react";
import { createTask } from "@/app/actions/tasks";
import { useToast } from "@/components/app/toast-provider";
import { Input } from "@/components/ui/input";

/** Tek satır "hızlı görev": başlığı yaz, Enter — varsayılanlarla (Takip, normal, bana atanır) eklenir. */
export function QuickTask() {
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const restore = (title: string, message: string) => {
    if (inputRef.current && !inputRef.current.value) inputRef.current.value = title;
    setError(message);
    push(message, "err");
  };

  const action = (formData: FormData) => {
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;
    // Anında geri bildirim: alan hemen boşalır, hatada yazılan başlık geri gelir.
    if (inputRef.current) inputRef.current.value = "";
    setError(null);
    startTransition(async () => {
      try {
        const res = await createTask({}, formData);
        if (res.ok) {
          // createTask zaten revalidatePath("/app/gorevler") yapıyor: action yanıtı
          // taze listeyi getirir, ayrıca router.refresh() gereksiz (çift gidiş-dönüş).
          push("Görev eklendi", "ok");
          return;
        }
        restore(title, res.error ?? "Görev eklenemedi.");
      } catch {
        restore(title, "Görev eklenemedi. Lütfen tekrar deneyin.");
      }
    });
  };

  return (
    <form action={action} className="space-y-1">
      <div className="relative">
        <Zap className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
        <Input
          ref={inputRef}
          name="title"
          aria-label="Hızlı görev"
          placeholder="Hızlı görev: başlığı yazıp Enter'a basın…"
          autoComplete="off"
          disabled={pending}
          className="pl-9"
        />
        <input type="hidden" name="kind" value="followup" />
        <input type="hidden" name="priority" value="normal" />
      </div>
      {error ? <p className="text-xs font-medium text-danger-600" role="alert">{error}</p> : null}
    </form>
  );
}
