"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, FileText, ListPlus, Loader2, RotateCcw, Save, Send, UserPlus, X } from "lucide-react";
import {
  convertApplicationToCustomer,
  getApplicationFileUrl,
  saveApplicationNote,
  setApplicationStatus,
} from "@/app/actions/rental-applications";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormTextarea } from "@/components/ui/form-controls";
import type { RentalApplicationStatus } from "@/lib/workflow-state";

type Step = { to: RentalApplicationStatus; label: string; icon: typeof Check; variant: "primary" | "outline" | "ghost" | "danger"; confirm?: { title: string; description: string } };

const STEPS: Record<RentalApplicationStatus, Step[]> = {
  new: [
    { to: "shortlisted", label: "Kısa listeye al", icon: ListPlus, variant: "outline" },
    { to: "owner_review", label: "Malike öner", icon: Send, variant: "primary", confirm: { title: "Adayı malike öner", description: "Aday malik portalında “Önerilen kiracı adayları” bölümünde görünür; malik onay ya da ret verir. Telefon ve e-posta malike gösterilmez." } },
    { to: "rejected", label: "Reddet", icon: X, variant: "ghost", confirm: { title: "Başvuruyu reddet", description: "Başvuru kapanır; gerekirse yeniden değerlendirmeye alabilirsiniz." } },
  ],
  shortlisted: [
    { to: "owner_review", label: "Malike öner", icon: Send, variant: "primary", confirm: { title: "Adayı malike öner", description: "Aday malik portalında “Önerilen kiracı adayları” bölümünde görünür; malik onay ya da ret verir. Telefon ve e-posta malike gösterilmez." } },
    { to: "approved", label: "Onayla", icon: Check, variant: "outline", confirm: { title: "Adayı onayla", description: "Malik onayını telefonla aldıysanız adayı doğrudan onaylayabilirsiniz. Onaylanan başvuru kapanır ve kira kaydına dönüştürülebilir." } },
    { to: "rejected", label: "Reddet", icon: X, variant: "ghost", confirm: { title: "Başvuruyu reddet", description: "Başvuru kapanır; gerekirse yeniden değerlendirmeye alabilirsiniz." } },
  ],
  owner_review: [
    { to: "approved", label: "Malik adına onayla", icon: Check, variant: "outline", confirm: { title: "Malik adına onayla", description: "Malik onayını telefonla ya da yüz yüze aldıysanız kullanın. Onaylanan başvuru kapanır." } },
    { to: "shortlisted", label: "Öneriyi geri al", icon: RotateCcw, variant: "ghost" },
    { to: "rejected", label: "Reddet", icon: X, variant: "ghost", confirm: { title: "Başvuruyu reddet", description: "Başvuru kapanır; gerekirse yeniden değerlendirmeye alabilirsiniz." } },
  ],
  approved: [],
  rejected: [{ to: "shortlisted", label: "Yeniden değerlendir", icon: RotateCcw, variant: "outline" }],
  withdrawn: [],
};

/** Durum eylemleri: her adım açık adıyla, geri alınamaz/kapatan adımlar onay penceresiyle. */
export function ApplicationStatusActions({ id, status, canEdit }: { id: string; status: RentalApplicationStatus; canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [busyTo, setBusyTo] = useState<string | null>(null);
  if (!canEdit) return null;
  const run = (to: RentalApplicationStatus) =>
    new Promise<void>((resolve) =>
      start(async () => {
        setBusyTo(to);
        const res = await setApplicationStatus(id, to);
        setBusyTo(null);
        if (res.error) push(res.error, "err");
        else {
          push(to === "owner_review" ? "Aday malik portalına önerildi" : "Başvuru güncellendi", "ok");
          router.refresh();
        }
        resolve();
      }),
    );
  const steps = STEPS[status];
  if (steps.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {steps.map((s) =>
        s.confirm ? (
          <ConfirmDialog
            key={s.to}
            trigger={<Button variant={s.variant} size="sm" icon={s.icon} loading={pending && busyTo === s.to}>{s.label}</Button>}
            title={s.confirm.title}
            description={s.confirm.description}
            confirmLabel={s.label}
            tone={s.to === "rejected" ? "danger" : "default"}
            onConfirm={() => run(s.to)}
          />
        ) : (
          <Button key={s.to} variant={s.variant} size="sm" icon={s.icon} loading={pending && busyTo === s.to} disabled={pending} onClick={() => void run(s.to)}>
            {s.label}
          </Button>
        ),
      )}
    </div>
  );
}

/** Onaylanan aday → müşteri kaydı (aynı telefonlu müşteri varsa o bağlanır) → kira kaydı formu ön dolgulu. */
export function ConvertActions({
  id,
  customerId,
  propertyId,
  rent,
  rentalId,
  canCreateRental,
}: {
  id: string;
  customerId: string | null;
  propertyId: string;
  rent: number | null;
  rentalId: string | null;
  canCreateRental: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  if (rentalId) {
    return (
      <Button variant="outline" size="sm" icon={ExternalLink} onClick={() => router.push(`/app/kiralama/${rentalId}`)}>
        Kira kaydını aç
      </Button>
    );
  }
  const rentalHref = (cid: string) =>
    `/app/kiralama/yeni?portfoy=${propertyId}&musteri=${cid}${rent ? `&tutar=${Math.round(rent)}` : ""}&basvuru=${id}`;
  if (customerId) {
    return canCreateRental ? (
      <Button size="sm" icon={UserPlus} onClick={() => router.push(rentalHref(customerId))}>
        Kira kaydı aç
      </Button>
    ) : null;
  }
  return (
    <Button
      size="sm"
      icon={UserPlus}
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await convertApplicationToCustomer(id);
          if (res.error || !res.id) {
            push(res.error ?? "Müşteri kaydı açılamadı.", "err");
            return;
          }
          push("Aday müşteri olarak kaydedildi", "ok");
          if (canCreateRental) router.push(rentalHref(res.id));
          else router.refresh();
        })
      }
    >
      {canCreateRental ? "Müşteri yap ve kira kaydı aç" : "Müşteri kaydı aç"}
    </Button>
  );
}

/** Evrakı yeni sekmede açar (5 dk geçerli imzalı bağlantı; özel kova). */
export function FileOpenButton({ fileId, label }: { fileId: string; label: string }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    // Açılır pencere engelleyicisine takılmamak için sekme tıklama anında açılır, adres sonra verilir.
    const win = window.open("", "_blank");
    if (win) win.opener = null;
    const res = await getApplicationFileUrl(fileId);
    setBusy(false);
    if (!res.url) {
      win?.close();
      push(res.error ?? "Dosya açılamadı.", "err");
      return;
    }
    if (win) win.location.href = res.url;
    else window.location.href = res.url;
  };
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={open}
      className="h-auto min-h-11 w-full justify-start gap-2 px-3 py-2 text-left touch:h-auto"
    >
      {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <FileText className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden="true" />
    </Button>
  );
}

export function OfficeNoteEditor({ id, initial, canEdit }: { id: string; initial: string; canEdit: boolean }) {
  const { push } = useToast();
  const router = useRouter();
  const [note, setNote] = useState(initial);
  const [pending, start] = useTransition();
  if (!canEdit) return initial ? <p className="whitespace-pre-wrap text-sm text-text-muted">{initial}</p> : <p className="text-sm text-text-muted">Not yok.</p>;
  return (
    <div className="space-y-2">
      <label htmlFor="ra-office-note" className="sr-only">Ofis notu</label>
      <FormTextarea id="ra-office-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Yalnız ofis içi görünür. Örn. Görüşme olumlu, kefil babası." />
      <Button
        size="sm"
        variant="outline"
        icon={Save}
        loading={pending}
        disabled={note === initial}
        onClick={() =>
          start(async () => {
            const res = await saveApplicationNote(id, note);
            if (res.error) push(res.error, "err");
            else {
              push("Not kaydedildi", "ok");
              router.refresh();
            }
          })
        }
      >
        Notu kaydet
      </Button>
    </div>
  );
}
