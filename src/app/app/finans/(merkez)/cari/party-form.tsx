"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Pencil, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PartyKindKey } from "@/lib/finance/party/aging";

/**
 * Cari formu düğmesi (yeni / düzenle). Pencere gövdesi (form, PhoneInput, EmailInput, bağ seçicileri) yalnız düğmeye
 * basılınca yüklenir (`party-form-dialog`), sayfanın ilk yük JS'ine girmez.
 */

export type EditableParty = {
  id: string;
  name: string;
  kind: string;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  archived_at: string | null;
  /** IBAN son 4 hane (banka eşleştirmesi; formda alan yok, düzenlemede aynen geri gönderilir). */
  iban_last4?: string | null;
  /** Malik → müşteri kaydı bağı (hak ediş bölümü buna dayanır). Düzenlemede aynen geri gönderilir. */
  customer_id: string | null;
  /** Danışman → kullanıcı bağı (P12 sahipliği ve prim bölümü buna dayanır). Düzenlemede aynen geri gönderilir. */
  user_id: string | null;
};

/** Bağ alanlarının görünen adları (sayfa zaten okuduysa; seçicide açılışta ek arama yapılmaz). */
export type PartyLinkLabels = { customer?: string | null; user?: string | null };

const PartyFormDialog = dynamic(() => import("./party-form-dialog").then((m) => m.PartyFormDialog), { ssr: false });

export function PartyFormButton({
  party,
  defaultKind,
  label,
  variant = "primary",
  canLink = false,
  linkLabels,
}: {
  party?: EditableParty;
  defaultKind?: PartyKindKey | null;
  label?: string;
  variant?: "primary" | "outline" | "ghost";
  /** Müşteri / kullanıcı bağı seçicilerini göster (yalnız finans düzenleme yetkisi olanlar). */
  canLink?: boolean;
  linkLabels?: PartyLinkLabels;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size="sm" icon={party ? Pencil : UserPlus} onClick={() => setOpen(true)}>
        {label ?? (party ? "Düzenle" : "Yeni cari")}
      </Button>
      {open ? <PartyFormDialog party={party} defaultKind={defaultKind ?? null} canLink={canLink} linkLabels={linkLabels} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
