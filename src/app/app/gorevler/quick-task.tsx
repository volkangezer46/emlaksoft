"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { createTask } from "@/app/actions/tasks";
import { useToast } from "@/components/app/toast-provider";
import { Input } from "@/components/ui/input";

/** Tek satır "hızlı görev": başlığı yaz, Enter — varsayılanlarla (Takip, normal, bana atanır) eklenir. */
export function QuickTask() {
  const router = useRouter();
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const action = (formData: FormData) => {
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;
    startTransition(async () => {
      const res = await createTask({}, formData);
      if (res.ok) {
        setError(null);
        if (inputRef.current) inputRef.current.value = "";
        push("Görev eklendi", "ok");
        router.refresh();
        return;
      }
      setError(res.error ?? "Görev eklenemedi.");
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
