"use client";

import { useEffect, useState } from "react";
import { listPostableAccounts, type PostableAccount } from "@/app/actions/finance-accounts";
import { cn } from "@/lib/utils";
import { Combobox } from "@/components/ui/combobox";

/**
 * "Hangi hesaba girdi?" (isteğe bağlı) — komisyon / kira / aidat tahsilat ekranlarında. Yetki veya şema yoksa ya da
 * hiç ofis hesabı açılmamışsa HİÇBİR ŞEY çizmez (tahsilat davranışı değişmez). Boş seçim = hesaba işleme.
 */
export function FinanceAccountPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (accountId: string) => void;
  className?: string;
}) {
  const [accounts, setAccounts] = useState<PostableAccount[] | null>(null);
  useEffect(() => {
    let alive = true;
    listPostableAccounts().then((list) => {
      if (alive) setAccounts(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!accounts || accounts.length === 0) return null;
  return (
    <Combobox
      aria-label="Hangi hesaba girdi (isteğe bağlı)"
      value={value}
      onValueChange={onChange}
      options={accounts.map((a) => ({ value: a.id, label: `${a.name} hesabına girdi` }))}
      placeholder="Hesaba işleme"
      searchPlaceholder="Hesap ara…"
      emptyText="Eşleşen hesap yok"
      className={cn("w-auto min-w-[10rem] text-xs", className)}
    />
  );
}
