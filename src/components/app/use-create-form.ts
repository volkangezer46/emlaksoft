"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/app/toast-provider";
import { takeSubmitIntent } from "@/lib/form-submit-intent";
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
  // Çift gönderim kilidi (B13): pending state'i bir sonraki render'a kadar güncellenmez; ref anında kilitler.
  const inFlight = useRef(false);

  // Gönderim başlamadan hedef listeyi ısıt: redirectTo çoğu formda id yokken liste
  // adresini döndürür (`detailOrList`); sonuç gelince push anında açılır. Detay
  // adresi sonuçtaki id'ye bağlı olduğundan önceden bilinemez — push o rota için
  // zaten loading.tsx iskeletini anında gösterir.
  useEffect(() => {
    try {
      const target = options.redirectTo({} as R);
      if (typeof target === "string" && target.startsWith("/app")) router.prefetch(target);
    } catch {
      // redirectTo sonuç alanlarına bağlıysa önceden hesaplanamaz — sorun değil.
    }
    // yalnız bağlanırken bir kez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function submit(formData: FormData) {
    if (inFlight.current) return;
    inFlight.current = true;
    const intent = takeSubmitIntent();
    startTransition(async () => {
      let result: R;
      try {
        result = await action(formData);
      } finally {
        inFlight.current = false;
      }
      setState(result);
      const outcome = resolveSubmitOutcome(result, options);
      if (!outcome.ok) return;
      try {
        await options.afterSuccess?.(result, formData);
      } catch (e) {
        console.error("useCreateForm.afterSuccess", e);
      }
      push(outcome.message, "ok");
      if (intent === "new") {
        // "Kaydet ve yenisini ekle": aynı sayfa temiz açılsın (alan durumu sıfırlansın) — tam yükleme.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- bilinçli tam yükleme: form durumu sıfırlanır
        window.location.assign(`${window.location.pathname}?kaydedildi=1`); // bayrak: kabuk "önceki kayıt eklendi" bandı gösterir
        return;
      }
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
