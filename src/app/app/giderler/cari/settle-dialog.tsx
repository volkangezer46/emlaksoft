"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { FilePlus2, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PartyKindKey } from "@/lib/finance/party/aging";

/**
 * Cari eylem düğmeleri: "Tahsil et / Öde" ve "Yeni alacak / borç". Pencere gövdeleri (form, PartyPicker, Combobox)
 * yalnız düğmeye basılınca yüklenir (`settle-dialog-body`), sayfanın ilk yük JS'ine girmez.
 */

const SettleDialog = dynamic(() => import("./settle-dialog-body").then((m) => m.SettleDialog), { ssr: false });
const OpenItemDialog = dynamic(() => import("./settle-dialog-body").then((m) => m.OpenItemDialog), { ssr: false });

export type SettleAccount = { id: string; name: string; currency: string };
export type SettleItem = { id: string; title: string; direction: "receivable" | "payable"; amount: number; remaining: number; currency: string };

export function SettleButton({ item, accounts, today, size = "xs" }: { item: SettleItem; accounts: readonly SettleAccount[]; today: string; size?: "xs" | "sm" }) {
  const [open, setOpen] = useState(false);
  const verb = item.direction === "receivable" ? "Tahsil et" : "Öde";
  return (
    <>
      <Button variant="outline" size={size} icon={HandCoins} onClick={() => setOpen(true)} aria-label={`${item.title}: ${verb}`}>
        {verb}
      </Button>
      {open ? <SettleDialog item={item} accounts={accounts} today={today} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function NewOpenItemButton({
  party,
  today,
  defaultDirection = "receivable",
  label = "Yeni alacak / borç",
  variant = "outline",
  advisorOwnerId,
}: {
  party?: { id: string; name: string; kind: PartyKindKey | null } | null;
  /** `earnings_all` yoksa kullanıcının kimliği: cari seçicide yalnız kendi danışman carisi görünür (P12). */
  advisorOwnerId?: string | null;
  today: string;
  defaultDirection?: "receivable" | "payable";
  label?: string;
  variant?: "primary" | "outline";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size="sm" icon={FilePlus2} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? <OpenItemDialog party={party ?? null} today={today} defaultDirection={defaultDirection} advisorOwnerId={advisorOwnerId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
