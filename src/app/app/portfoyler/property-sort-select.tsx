"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ArrowDownUp } from "lucide-react";

/**
 * Portföy listesi sıralama seçici — değişince URL'e ?sirala= yazıp gezinir
 * (aktif filtreleri korur, sayfayı 1'e döndürür). Native <select> erişilebilirliği
 * korunur; sunucu tarafı .order() ile eşleşen tek kaynak (bkz. portfoyler/page.tsx).
 * Varsayılan "yeni" URL'e yazılmaz (temiz link).
 */
const OPTIONS = [
  { value: "yeni", label: "En yeni" },
  { value: "eski", label: "En eski" },
  { value: "fiyat_yuksek", label: "Fiyat: yüksek → düşük" },
  { value: "fiyat_dusuk", label: "Fiyat: düşük → yüksek" },
] as const;

export function PropertySortSelect({ value }: { value: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const sp = new URLSearchParams(params.toString());
    const v = e.target.value;
    if (v && v !== "yeni") sp.set("sirala", v);
    else sp.delete("sirala");
    sp.delete("sayfa"); // sıralama değişince ilk sayfaya dön
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <label className="inline-flex items-center gap-2 rounded-[11px] border border-line bg-surface px-3 py-2 text-xs font-semibold text-text-muted shadow-[var(--shadow-xs)] transition focus-within:border-brand-400">
      <ArrowDownUp className="h-3.5 w-3.5 text-text-faint" aria-hidden />
      <span className="sr-only">Sıralama</span>
      <select
        value={value || "yeni"}
        onChange={onChange}
        aria-label="Portföyleri sırala"
        className="cursor-pointer appearance-none bg-transparent pr-1 font-semibold text-ink-950 outline-none"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
