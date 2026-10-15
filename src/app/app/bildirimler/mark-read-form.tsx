"use client";

import { useTransition, type ReactNode } from "react";
import { useToast } from "@/components/app/toast-provider";
import type { NotificationReadResult } from "@/app/actions/notifications";

/**
 * Bildirim sayfasının okundu formları (tekil/grup ve "Tümünü okundu işaretle"). Eylem `{ ok } | { error }` döndürür;
 * hata sessizce yutulmaz, toast olur (B167: salt okunur kullanıcıda okundu yazımı eskiden 42501 alıp kayboluyordu).
 * Başarıda eylem sayfayı yeniden doğrular, zil 'reads:<uid>' yayınıyla eşlenir.
 */
export function MarkReadForm({
  action,
  ids,
  className,
  errorFallback = "Bildirim okundu işaretlenemedi",
  children,
}: {
  action: (formData: FormData) => Promise<NotificationReadResult>;
  ids?: readonly string[];
  className?: string;
  errorFallback?: string;
  children: ReactNode;
}) {
  const { push } = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <form
      className={className}
      aria-busy={pending || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const formData = new FormData(e.currentTarget);
        startTransition(async () => {
          try {
            const result = await action(formData);
            if (!result.ok) push(result.error || errorFallback, "err");
          } catch {
            push(errorFallback, "err");
          }
        });
      }}
    >
      {ids?.map((id) => (
        <input key={id} type="hidden" name="id" value={id} />
      ))}
      {children}
    </form>
  );
}
