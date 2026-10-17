"use client";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

/**
 * Kolon eşleme seçicisi (2. adım). Sihirbaz bunu ve danışman seçicisini (`Combobox`) `next/dynamic` ile yükler: açılır
 * menü kütüphaneleri (Radix Select/Popover, konumlandırma) ilk ekranın (dosya seçimi) paketine girmez. Dosya okununca
 * önceden yüklenir; 2. adıma geçişte beklenmez.
 */
export function ColumnSelect({
  value,
  none,
  headers,
  label,
  onChange,
}: {
  value: string;
  none: string;
  headers: readonly string[];
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={`${label} için dosya kolonu`} placeholder="Eşleme yok" />
      <SelectContent>
        <SelectItem value={none}>— Eşleme yok —</SelectItem>
        {headers.map((h, i) => (
          <SelectItem key={`${h}-${i}`} value={String(i)}>
            {h || `Kolon ${i + 1}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
