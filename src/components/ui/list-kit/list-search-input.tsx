"use client";

import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useContext, useEffect, useRef } from "react";

/** Yazmayı bırakınca URL'in güncellenmesi için bekleme (B058). */
export const LIST_SEARCH_DEBOUNCE_MS = 300;

/**
 * Liste arama kutusu (ListToolbar'ın tek istemci adası). Yazarken 300 ms bekleyip `router.replace` ile URL'i günceller:
 * tam belge yüklemesi YOK (realtime kanalı yeniden katılmaz, kabuk ve kaydırma yerinde), geçmiş her harfle şişmez.
 * Enter yine formu gönderir (`next/form`, istemci gezinmesi). Filtre kontratı korunur: formun gizli alanları
 * (öteki formun alanları, görünüm, sıralama…) aynen taşınır, sayfalama sıfırlanır (gizli alanlarda sayfa yok), boş
 * arama parametresi URL'den düşer. URL dışarıdan değişince (çip kaldırma, geri/ileri) kutu yeni değeri alır; kullanıcının
 * henüz gönderilmemiş yazısı ezilmez.
 */
export function ListSearchInput({
  name,
  value,
  pathname,
  placeholder,
  className,
}: {
  name: string;
  /** URL'deki güncel arama değeri. */
  value: string;
  /** Formun hedefi (liste sayfasının yolu). */
  pathname: string;
  placeholder?: string;
  className?: string;
}) {
  // useRouter() yönlendirici dışında (test / sunucu önizleme) fırlatır; bağlam yoksa yalnız Enter ile gönderim kalır.
  const router = useContext(AppRouterContext);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** URL'e en son yazılan (ya da URL'den gelen) arama metni. */
  const sent = useRef(value);

  useEffect(() => {
    const el = ref.current;
    if (!el || value === sent.current) return;
    sent.current = value;
    if (el.value.trim() !== value) el.value = value;
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = () => {
    timer.current = null;
    const el = ref.current;
    const form = el?.form;
    if (!el || !form || !router) return;
    const q = el.value.trim();
    if (q === sent.current) return;
    sent.current = q;
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form)) {
      if (typeof v !== "string") continue;
      if (k === name) {
        if (q) params.append(k, q);
      } else {
        params.append(k, v);
      }
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <input
      ref={ref}
      type="search"
      name={name}
      defaultValue={value}
      placeholder={placeholder}
      className={className}
      autoComplete="off"
      onChange={(e) => {
        if ((e.nativeEvent as InputEvent).isComposing) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(commit, LIST_SEARCH_DEBOUNCE_MS);
      }}
      onKeyDown={(e) => {
        // Enter formu (next/form) gönderir: bekleyen gecikmeli güncelleme ikinci bir gezinme yapmasın.
        if (e.key !== "Enter") return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        sent.current = e.currentTarget.value.trim();
      }}
    />
  );
}
