"use client";

import { useEffect, useState } from "react";
import { listPostableAccounts, type PostableAccount } from "@/app/actions/finance-accounts";
import { cn } from "@/lib/utils";

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
    <select
      aria-label="Hangi hesaba girdi (isteğe bağlı)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("min-h-8 rounded-[var(--radius-control)] border border-line bg-canvas px-2 text-xs text-text outline-none focus:border-brand-400", className)}
    >
      <option value="">Hesaba işleme</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>{a.name} hesabına girdi</option>
      ))}
    </select>
  );
}
