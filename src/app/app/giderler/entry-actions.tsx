"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Undo2 } from "lucide-react";
import { updateCashEntry, voidCashEntry } from "@/app/actions/finance-accounts";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { categoriesFor, type CashDirection } from "@/lib/finance/cash/categories";

export type EditableEntry = {
  id: string;
  direction: CashDirection;
  amount: number;
  date: string;
  category: string | null;
  title: string;
  counterparty: string | null;
  note: string | null;
};

/** Hareket satırı eylemleri: düzenle (yalnız elle girilen gelir/gider) ve iptal (neden zorunlu; silinmez). */
export function EntryRowActions({
  entry,
  today,
  canEdit,
  canVoid,
  canSalary,
  isTransfer,
}: {
  entry: EditableEntry;
  today: string;
  canEdit: boolean;
  canVoid: boolean;
  canSalary: boolean;
  isTransfer: boolean;
}) {
  const [mode, setMode] = useState<"edit" | "void" | null>(null);
  return (
    <div className="flex items-center justify-end gap-1">
      {canEdit ? (
        <Button variant="ghost" size="xs" icon={Pencil} onClick={() => setMode("edit")} aria-label={`${entry.title} hareketini düzenle`}>
          Düzenle
        </Button>
      ) : null}
      {canVoid ? (
        <Button variant="ghost" size="xs" icon={Undo2} onClick={() => setMode("void")} aria-label={`${entry.title} hareketini iptal et`}>
          İptal
        </Button>
      ) : null}
      {mode === "edit" ? <EditDialog entry={entry} today={today} canSalary={canSalary} onClose={() => setMode(null)} /> : null}
      {mode === "void" ? <VoidDialog entry={entry} isTransfer={isTransfer} onClose={() => setMode(null)} /> : null}
    </div>
  );
}

function EditDialog({ entry, today, canSalary, onClose }: { entry: EditableEntry; today: string; canSalary: boolean; onClose: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const categories = categoriesFor(entry.direction).filter((c) => canSalary || c.value !== "maas" || entry.category === "maas");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await updateCashEntry(entry.id, {
      direction: entry.direction,
      amount: String(fd.get("amount") ?? ""),
      category: String(fd.get("category") ?? ""),
      title: String(fd.get("title") ?? ""),
      date: String(fd.get("date") ?? ""),
      counterparty: String(fd.get("counterparty") ?? ""),
      note: String(fd.get("note") ?? ""),
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    push("Hareket güncellendi", "ok");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader title="Hareketi düzenle" description="Tahsilata veya transfere bağlı hareketler düzenlenemez." icon={<Pencil />} />
        <form onSubmit={submit}>
          <DialogBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Tutar" htmlFor="ee-amount" required>
                <FormInput id="ee-amount" name="amount" inputMode="decimal" defaultValue={String(entry.amount).replace(".", ",")} required autoFocus />
              </FormField>
              <FormField label="Tarih" htmlFor="ee-date">
                <FormInput id="ee-date" name="date" type="date" defaultValue={entry.date} max={today} min="2000-01-01" />
              </FormField>
            </div>
            <FormField label="Ne için?" htmlFor="ee-category" required>
              <FormSelect id="ee-category" name="category" defaultValue={entry.category ?? ""} required>
                {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </FormSelect>
            </FormField>
            <FormField label="Açıklama" htmlFor="ee-title">
              <FormInput id="ee-title" name="title" maxLength={160} defaultValue={entry.title} />
            </FormField>
            <FormField label={entry.direction === "in" ? "Kimden?" : "Kime?"} htmlFor="ee-counterparty">
              <FormInput id="ee-counterparty" name="counterparty" maxLength={120} defaultValue={entry.counterparty ?? ""} />
            </FormField>
            <FormField label="Not" htmlFor="ee-note">
              <FormTextarea id="ee-note" name="note" rows={2} maxLength={1000} defaultValue={entry.note ?? ""} />
            </FormField>
            <FormError error={error} nextStep={null} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
            <Button type="submit" variant="primary" loading={busy}>Kaydet</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ entry, isTransfer, onClose }: { entry: EditableEntry; isTransfer: boolean; onClose: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await voidCashEntry(entry.id, String(fd.get("reason") ?? ""));
    setBusy(false);
    if (res.error) return setError(res.error);
    push("Hareket iptal edildi", "ok");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader
          title="Hareketi iptal et"
          description={isTransfer ? "Transferin iki bacağı birlikte iptal edilir." : "Kayıt silinmez; bakiyeden düşer ve iptal nedeniyle saklanır."}
          icon={<Undo2 />}
          tone="danger"
        />
        <form onSubmit={submit}>
          <DialogBody className="grid gap-4">
            <FormField label="İptal nedeni" htmlFor="ve-reason" required>
              <FormInput id="ve-reason" name="reason" maxLength={300} placeholder="ör. yanlış tutar girildi" required autoFocus />
            </FormField>
            <FormError error={error} nextStep={null} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
            <Button type="submit" variant="danger" loading={busy}>Hareketi iptal et</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
