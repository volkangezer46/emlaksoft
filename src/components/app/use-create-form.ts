"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/app/toast-provider";
import { clearActiveFormDrafts } from "@/components/app/use-form-draft";
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

  useCenterFocusedField();

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
      // B097a: taslak, yönlendirmeden ÖNCE silinir (kabuk pending=false anını görmeden ayrılır; aksi halde sonraki
      // açılışta "taslak var" bandı çıkardı). Form dosyalarına dokunmadan tüm taslaklı formlar için geçerli.
      clearActiveFormDrafts();
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

/** Dokunmatik ya da dar ekran (alt çubuklar ve ekran klavyesi burada alan kapatır). */
const FOCUS_CENTER_QUERY = "(max-width: 1023.98px), (pointer: coarse)";
/** Klavye açılış animasyonu (iOS ~250 ms, Android ~300 ms) bitince ölçülür. */
const FOCUS_CENTER_DELAY_MS = 320;
const TEXT_FIELD = 'input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"], [type="reset"], [type="file"], [type="color"], [type="hidden"]), textarea, select';

/**
 * Odaklanan alan görünür alanın kör bölgesinde mi (üstte yapışkan başlık, altta form çubuğu + ekran klavyesi)?
 * `viewTop`/`viewBottom`: görünür alan (visualViewport); `bottomCover`: alttan kapatan yapışkan çubuk yüksekliği.
 */
export function fieldNeedsCentering(
  rect: { top: number; bottom: number },
  view: { top: number; bottom: number },
  topCover: number,
  bottomCover: number,
): boolean {
  return rect.top < view.top + topCover || rect.bottom > view.bottom - bottomCover;
}

/**
 * WP1: dokunmatikte/dar ekranda form alanına odaklanınca alan ekran klavyesi ve yapışkan Kaydet çubuğunun ALTINDA kalmasın:
 * klavye açıldıktan sonra alan kapalı bölgedeyse görünür alanın ORTASINA kaydırılır (`block: "center"`). Yalnız gerektiğinde
 * kaydırır (görünür alandaki alana dokunmak sayfayı zıplatmaz); hareket azaltma tercihinde anlık.
 */
function useCenterFocusedField() {
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia(FOCUS_CENTER_QUERY).matches) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.matches(TEXT_FIELD) || !el.closest("form")) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (document.activeElement !== el) return;
        const vv = window.visualViewport;
        const view = vv ? { top: vv.offsetTop, bottom: vv.offsetTop + vv.height } : { top: 0, bottom: window.innerHeight };
        const bar = document.querySelector<HTMLElement>(".fab-bar[data-sticky]:not([data-kb])");
        const bottomCover = bar ? Math.max(0, view.bottom - bar.getBoundingClientRect().top) : 0;
        if (!fieldNeedsCentering(el.getBoundingClientRect(), view, 64, bottomCover)) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: reduce ? "auto" : "smooth" });
      }, FOCUS_CENTER_DELAY_MS);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);
}
