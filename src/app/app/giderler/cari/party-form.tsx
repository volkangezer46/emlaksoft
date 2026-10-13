"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, UserPlus } from "lucide-react";
import { archiveParty, upsertParty } from "@/app/actions/finance-ledger";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { EmailInput } from "@/components/ui/email-input";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { PARTY_KIND_LABEL, PARTY_KINDS, partyKindOf, type PartyKindKey } from "@/lib/finance/party/aging";

/**
 * Cari formu (yeni / düzenle) ve arşivleme. Telefon `PhoneInput`, e-posta `EmailInput` (tek merkez); sunucu
 * `upsertParty` telefonu `parsePhoneStrict` ile doğrulayıp saklama biçiminde yazar. VKN yalnız 10 hane (TCKN saklanmaz).
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
};

export function PartyFormButton({
  party,
  defaultKind,
  label,
  variant = "primary",
}: {
  party?: EditableParty;
  defaultKind?: PartyKindKey | null;
  label?: string;
  variant?: "primary" | "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size="sm" icon={party ? Pencil : UserPlus} onClick={() => setOpen(true)}>
        {label ?? (party ? "Düzenle" : "Yeni cari")}
      </Button>
      {open ? <PartyFormDialog party={party} defaultKind={defaultKind ?? null} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PartyFormDialog({ party, defaultKind, onClose }: { party?: EditableParty; defaultKind: PartyKindKey | null; onClose: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const taxId = String(fd.get("taxId") ?? "").replace(/\D/g, "");
    if (taxId && taxId.length !== 10) return setError("Vergi kimlik numarası 10 haneli olmalı.");
    setBusy(true);
    setError(null);
    const res = await upsertParty({
      id: party?.id ?? null,
      name: String(fd.get("partyName") ?? "").trim(),
      kind: String(fd.get("kind") ?? "diger"),
      taxId: taxId || null,
      phone: String(fd.get("phone") ?? "") || null,
      email: String(fd.get("email") ?? "") || null,
      note: String(fd.get("note") ?? "").trim() || null,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    push(party ? "Cari güncellendi" : "Cari oluşturuldu", "ok");
    onClose();
    if (!party && res.id) router.push(`/app/giderler?sekme=cari&cari=${res.id}`);
    else router.refresh();
  }

  async function toggleArchive() {
    if (!party) return;
    setBusy(true);
    const res = await archiveParty(party.id, !party.archived_at);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    push(party.archived_at ? "Cari arşivden çıkarıldı" : "Cari arşivlendi", "ok");
    onClose();
    router.refresh();
  }

  const kind = partyKindOf(party?.kind) ?? defaultKind ?? "musteri";
  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader
          title={party ? "Cariyi düzenle" : "Yeni cari"}
          description="Kişi ya da firma: müşteri, malik, kiracı, tedarikçi, danışman. Bakiye hareketlerden ve açık kalemlerden hesaplanır."
          icon={party ? <Pencil /> : <UserPlus />}
        />
        <form onSubmit={submit}>
          <DialogBody className="grid gap-4">
            <FormField label="Ad / unvan" htmlFor="pf-name" required>
              <FormInput id="pf-name" name="partyName" maxLength={120} defaultValue={party?.name ?? ""} required autoFocus />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Tür" htmlFor="pf-kind" required>
                <FormSelect id="pf-kind" name="kind" defaultValue={kind} required>
                  {PARTY_KINDS.map((k) => (
                    <option key={k} value={k}>{PARTY_KIND_LABEL[k]}</option>
                  ))}
                </FormSelect>
              </FormField>
              <FormField label="Vergi kimlik no (VKN)" htmlFor="pf-tax" hint="İsteğe bağlı, 10 hane.">
                <FormInput id="pf-tax" name="taxId" inputMode="numeric" maxLength={10} pattern="\d{10}" defaultValue={party?.tax_id ?? ""} />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Telefon" htmlFor="pf-phone">
                <PhoneInput id="pf-phone" name="phone" defaultValue={party?.phone ?? ""} />
              </FormField>
              <FormField label="E-posta" htmlFor="pf-email">
                <EmailInput id="pf-email" name="email" maxLength={160} defaultValue={party?.email ?? ""} />
              </FormField>
            </div>
            <FormField label="Not" htmlFor="pf-note">
              <FormTextarea id="pf-note" name="note" rows={2} maxLength={1000} defaultValue={party?.note ?? ""} />
            </FormField>
            <FormError error={error} nextStep={null} />
          </DialogBody>
          <DialogFooter>
            {party ? (
              <Button variant="ghost" icon={party.archived_at ? ArchiveRestore : Archive} onClick={toggleArchive} disabled={busy} className="mr-auto">
                {party.archived_at ? "Arşivden çıkar" : "Arşivle"}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
            <Button type="submit" variant="primary" loading={busy}>Kaydet</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
