"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { Eye, FileSignature, Link2, MoreVertical, PenLine, XCircle } from "lucide-react";
import { setAppointmentStatus } from "@/app/actions/appointments";
import { useToast } from "@/components/app/toast-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * Randevu satırının ikincil eylemleri (⋮): detay, imzaya al, tutanak, teyit linkini kopyala, iptal.
 * Satırda yalnız birincil eylemler (Tamamla / Onayla / Düzenle) görünür. İptal onayı denetimli ConfirmDialog
 * ile açılır (menü kapanınca da diyalog açık kalır).
 */
export function AppointmentRowMore({
  id,
  status,
  customerName,
  whenLabel,
  cardHref,
  tutanakHref,
  isShowing,
  confirmToken,
}: {
  id: string;
  status: string;
  customerName: string;
  whenLabel: string;
  cardHref: string | null;
  tutanakHref: string;
  isShowing: boolean;
  confirmToken: string | null;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const completed = status === "completed";

  function toSignature() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("status", "signature");
      await setAppointmentStatus(fd);
      router.refresh();
    });
  }

  async function copyConfirm() {
    if (!confirmToken) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/randevu-teyit/${confirmToken}`);
      push("Teyit linki kopyalandı", "ok");
    } catch {
      push("Link panoya kopyalanamadı", "err");
    }
  }

  const hasItems = Boolean(cardHref) || status === "confirmed" || isShowing || (!completed && confirmToken) || !completed;
  if (!hasItems) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={pending}
            aria-label={`Diğer işlemler: ${customerName} randevusu`}
            title="Diğer işlemler"
            className="focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-transparent text-text-muted transition hover:border-border-interactive hover:bg-surface-hover hover:text-brand-700 disabled:opacity-60 touch:h-11 touch:w-11"
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {cardHref ? (
            <DropdownMenuItem asChild>
              <Link href={cardHref} prefetch={false}>
                <Eye aria-hidden="true" /> Detayı aç
              </Link>
            </DropdownMenuItem>
          ) : null}
          {status === "confirmed" ? (
            <DropdownMenuItem onSelect={toSignature}>
              <PenLine aria-hidden="true" /> İmzaya al
            </DropdownMenuItem>
          ) : null}
          {isShowing ? (
            <DropdownMenuItem asChild>
              <Link href={tutanakHref} prefetch={false}>
                <FileSignature aria-hidden="true" /> Yer gösterme tutanağı
              </Link>
            </DropdownMenuItem>
          ) : null}
          {!completed && confirmToken ? (
            <DropdownMenuItem onSelect={() => void copyConfirm()}>
              <Link2 aria-hidden="true" /> Teyit linkini kopyala
            </DropdownMenuItem>
          ) : null}
          {!completed ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem danger onSelect={() => setCancelOpen(true)}>
                <XCircle aria-hidden="true" /> Randevuyu iptal et…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {!completed ? (
        <ConfirmDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          title="Randevuyu iptal et"
          description={`${customerName} ile ${whenLabel} randevusu iptal edilecek ve takvimden kalkacak.`}
          confirmLabel="İptal et"
          formAction={setAppointmentStatus}
          hiddenFields={{ id, status: "cancelled" }}
        />
      ) : null}
    </>
  );
}
