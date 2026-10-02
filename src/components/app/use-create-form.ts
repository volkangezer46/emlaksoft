"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/app/toast-provider";
import { resolveSubmitOutcome, type FormResultLike, type SubmitOptions } from "@/lib/form-logic";

export type UseCreateFormOptions<R extends FormResultLike> = SubmitOptions<R> & {
  /** Başarıda router.refresh() (sunucu verisini tazele). */
  refresh?: boolean;
  /** Başarıdan sonra, yönlendirmeden önce (ör. ikinci istek). Hata fırlatırsa yutulur. */
  afterSuccess?: (result: R, formData: FormData) => Promise<void> | void;
};

/**
 * "Yeni X" formlarının ortak gönderim akışı: action çağrısı + pending + hata +
 * başarıda toast ve yönlendirme tek yerde.
 *
 * `onSubmit` kullanılır (React 19 `<form action>` başarısızlıkta alanları
 * sıfırlıyordu — kullanıcı yazdıklarını kaybediyordu). `formAction` ise
 * `<form action>` isteyenler için aynı akıştır.
 */
export function useCreateForm<R extends FormResultLike>(
  action: (formData: FormData) => Promise<R>,
  options: UseCreateFormOptions<R>,
) {
  const router = useRouter();
  const { push } = useToast();
  const [state, setState] = useState<R>({} as R);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await action(formData);
      setState(result);
      const outcome = resolveSubmitOutcome(result, options);
      if (!outcome.ok) return;
      try {
        await options.afterSuccess?.(result, formData);
      } catch (e) {
        console.error("useCreateForm.afterSuccess", e);
      }
      push(outcome.message, "ok");
      router.push(outcome.redirect);
      if (options.refresh) router.refresh();
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit(new FormData(event.currentTarget));
  }

  return { state, formAction: submit, onSubmit, pending, error: state.error ?? null };
}
