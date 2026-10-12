"use client";

import { useMemo } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

export type PersonOption = {
  id: string;
  name: string | null;
  /** İkinci satır: rol, şube, uzmanlık gibi ayırt edici bilgi. */
  hint?: string | null;
  /** false ise (pasif/askıda) listenin sonunda soluk gösterilir. */
  active?: boolean;
  disabled?: boolean;
};

type Props = {
  people: readonly PersonOption[];
  /** Üstte "Önerilen" olarak gösterilecek kişiler (sırayla). */
  featuredIds?: string[];
  /** Boş seçimin etiketi (ör. "Danışmansız", "Değiştirme", "Danışman seçin"). */
  emptyLabel?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  required?: boolean;
  clearable?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
};

/**
 * PersonSelect — danışman/kullanıcı/atanan/sorumlu seçimi için aranabilir menü.
 * 200 danışmanlı ofiste düz `<select>` içinde gezmek zordur; bu bileşen ad, rol ve şube
 * üzerinden (Türkçe büyük/küçük harf duyarsız) arama yapar. Form uyumu `Combobox` gizli
 * input'u ile sağlanır: `name` verilirse FormData aynı değeri alır.
 * Sıra: önerilenler, aktif kişiler, pasifler.
 */
export function PersonSelect({
  people,
  featuredIds,
  emptyLabel = "Danışman seçin",
  searchPlaceholder = "İsim, rol veya şube ara…",
  emptyText = "Eşleşen kişi bulunamadı",
  ...rest
}: Props) {
  const options = useMemo<ComboboxOption[]>(() => {
    const featured = new Map((featuredIds ?? []).map((id, i) => [id, i]));
    const rank = (p: PersonOption) => (featured.has(p.id) ? 0 : p.active === false ? 2 : 1);
    return people
      .map((p, i) => ({ p, i }))
      .sort((a, b) => {
        const ra = rank(a.p);
        const rb = rank(b.p);
        if (ra !== rb) return ra - rb;
        if (ra === 0) return (featured.get(a.p.id) ?? 0) - (featured.get(b.p.id) ?? 0);
        return a.i - b.i;
      })
      .map(({ p }) => {
        const tags = [
          featured.has(p.id) ? "Önerilen" : null,
          p.active === false ? "Pasif" : null,
          p.hint || null,
        ].filter(Boolean);
        return {
          value: p.id,
          label: p.name?.trim() || "İsimsiz",
          hint: tags.length ? tags.join(" · ") : undefined,
          disabled: p.disabled,
        };
      });
  }, [people, featuredIds]);

  return (
    <Combobox
      options={options}
      placeholder={emptyLabel}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      {...rest}
    />
  );
}
