"use client";

import Link from "next/link";
import { Building2, CalendarDays, ListChecks, Phone, Plus, UserPlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { QuickCreateFlags } from "./quick-create-menu";

/** Lazy gövde: kabuk tıklanınca yüklenir ve menü açık gelir. */
export function QuickCreateMenuBody({ flags }: { flags: QuickCreateFlags }) {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="focus-ring press inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3 text-xs font-bold text-white transition hover:bg-brand-700"
          aria-label="Hızlı yeni kayıt menüsü"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Yeni</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52">
        {flags.customer ? (
          <DropdownMenuItem asChild>
            <Link href="/app/musteriler/yeni">
              <UserPlus /> Yeni müşteri
            </Link>
          </DropdownMenuItem>
        ) : null}
        {flags.property ? (
          <DropdownMenuItem asChild>
            <Link href="/app/portfoyler/yeni">
              <Building2 /> Yeni portföy
            </Link>
          </DropdownMenuItem>
        ) : null}
        {flags.call ? (
          <DropdownMenuItem asChild>
            <Link href="/app/arama">
              <Phone /> Görüşme kaydet
            </Link>
          </DropdownMenuItem>
        ) : null}
        {flags.appointment ? (
          <DropdownMenuItem asChild>
            <Link href="/app/randevular/yeni">
              <CalendarDays /> Randevu
            </Link>
          </DropdownMenuItem>
        ) : null}
        {flags.task ? (
          <DropdownMenuItem asChild>
            <Link href="/app/gorevler/yeni">
              <ListChecks /> Görev
            </Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
