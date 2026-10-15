"use client";

import { useEffect, useState } from "react";
import { listPostableAccounts, type PostableAccount } from "@/app/actions/finance-accounts";
import { cn } from "@/lib/utils";
import { Combobox } from "@/components/ui/combobox";

/**
 * "Hangi hesaba girdi?" — komisyon / kira / aidat tahsilat ekranlarında. Yetki veya şema yoksa ya da hiç ofis hesabı
 * açılmamışsa HİÇBİR ŞEY çizmez. Varsayılan isteğe bağlıdır (boş seçim = hesaba işleme).
 * `required` (SK6/B109, komisyon tahsilatı): etiket "isteğe bağlı" demez, tek hesap varsa kendiliğinden seçilir; zorunluluğu
 * çağıran uygular (düğme hesap seçilmeden kapalı) ve sunucu yeniden denetler. `onAccountsLoaded` hesap sayısını bildirir
 * (0 = ofiste hesap yok: çağıran "kasaya yazmadan işaretle" onayı ister).
 */
export function FinanceAccountPicker({
  value,
  onChange,
  className,
  direction = "in",
  required = false,
  onAccountsLoaded,
}: {
  value: string;
  onChange: (accountId: string) => void;
  className?: string;
  /** "out": mülk sahibi ödemesi gibi çıkış (etiketler "hesabından çıktı"). */
  direction?: "in" | "out";
  required?: boolean;
  onAccountsLoaded?: (count: number) => void;
}) {
  const [accounts, setAccounts] = useState<PostableAccount[] | null>(null);
  useEffect(() => {
    let alive = true;
    listPostableAccounts().then((list) => {
      if (!alive) return;
      setAccounts(list);
      onAccountsLoaded?.(list.length);
      if (required && list.length === 1 && !value) onChange(list[0].id);
    });
    return () => {
      alive = false;
    };
    // Hesap listesi oturum başına bir kez yüklenir; geri çağrılar ve seçim değeri yeniden yükleme sebebi değildir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!accounts || accounts.length === 0) return null;
  const optional = required ? "" : " (isteğe bağlı)";
  return (
    <Combobox
      aria-label={direction === "out" ? `Hangi hesaptan çıktı${optional}` : `Hangi hesaba girdi${optional}`}
      value={value}
      onValueChange={onChange}
      options={accounts.map((a) => ({ value: a.id, label: direction === "out" ? `${a.name} hesabından çıktı` : `${a.name} hesabına girdi` }))}
      placeholder={required ? "Hangi hesaba girdi?" : direction === "out" ? "Hesaptan işleme" : "Hesaba işleme"}
      searchPlaceholder="Hesap ara…"
      emptyText="Eşleşen hesap yok"
      clearable={!required}
      className={cn("w-auto min-w-[10rem] text-xs", className)}
    />
  );
}
