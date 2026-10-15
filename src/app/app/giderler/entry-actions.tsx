"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Undo2 } from "lucide-react";
import { recordCashEntry, voidCashEntry } from "@/app/actions/finance-accounts";
import { adoptLegacyExpenses } from "@/app/actions/finance-ledger";
import { useToast } from "@/components/app/toast-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FormError, FormField, FormInput } from "@/components/ui/form-controls";
import { isCashCategory, type CashDirection } from "@/lib/finance/cash/categories";

export type EditableEntry = {
  id: string;
  direction: CashDirection;
  /** Satırdaki NAKİT tutar (cash_entries.amount). */
  amount: number;
  date: string;
  category: string | null;
  title: string;
  counterparty: string | null;
  note: string | null;
};

/**
 * İptal sonrası "Geri al" için gereken bilgi (yalnız elle girilen gelir/gider). İptal kaydı silmez; geri alma aynı bilgilerle
 * yeni bir hareket yazar. `hadExpense`: hareket ofis giderini KENDİSİ üretmişti (created_expense; iptal o gideri sildi), geri
 * alınca yeniden üretilir. `adoptExpenseId`: hareket "Hesaba taşı" ile benimsenmiş eski gidere bağlıydı (gider iptalde
 * silinmez, yeniden "Hesapsız" olur); geri al yeni gider YAZMAZ, aynı gideri aynı hesaba yeniden taşır (çift sayım olmaz).
 */
export type UndoInfo = { accountId: string; hadExpense: boolean; adoptExpenseId?: string | null };

/**
 * Hareket satırı eylemleri: düzenle (yalnız elle girilen gelir/gider; TAM SAYFA `/app/giderler/kayit/[id]`, popup yok) ve
 * iptal (küçük onay; neden zorunlu, kayıt silinmez).
 */
export function EntryRowActions({
  entry,
  editHref,
  canEdit,
  canVoid,
  isTransfer,
  undo,
  disabledReason,
}: {
  entry: EditableEntry;
  /** Düzenleme sayfası (`entryEditHref`). */
  editHref: string;
  canEdit: boolean;
  canVoid: boolean;
  isTransfer: boolean;
  /** Verilirse iptal bildiriminde "Geri al" çıkar. */
  undo?: UndoInfo | null;
  /** Kilitli dönem vb.: düğmeler pasif, neden ipucu olarak gösterilir. */
  disabledReason?: string | null;
}) {
  const [voiding, setVoiding] = useState(false);
  return (
    <div className="flex items-center justify-end gap-1">
      {canEdit ? (
        disabledReason ? (
          <Button variant="ghost" size="xs" icon={Pencil} disabled title={disabledReason} aria-label={`${entry.title} hareketini düzenle`}>
            Düzenle
          </Button>
        ) : (
          <ButtonLink href={editHref} variant="ghost" size="xs" icon={Pencil} data-row-primary="" aria-label={`${entry.title} hareketini düzenle`}>
            Düzenle
          </ButtonLink>
        )
      ) : null}
      {canVoid ? (
        <Button
          variant="ghost"
          size="xs"
          icon={Undo2}
          onClick={() => setVoiding(true)}
          disabled={Boolean(disabledReason)}
          title={disabledReason ?? undefined}
          aria-label={`${entry.title} hareketini iptal et`}
        >
          İptal
        </Button>
      ) : null}
      {voiding ? <VoidDialog entry={entry} isTransfer={isTransfer} undo={undo ?? null} onClose={() => setVoiding(false)} /> : null}
    </div>
  );
}

function VoidDialog({ entry, isTransfer, undo, onClose }: { entry: EditableEntry; isTransfer: boolean; undo: UndoInfo | null; onClose: () => void }) {
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
    // Geri al: iptal edilen elle girilmiş hareket aynı bilgilerle yeniden yazılır (sistem kategorisi + transfer değil).
    const restorable = undo && !isTransfer && entry.category && isCashCategory(entry.category, entry.direction) ? undo : null;
    push("Hareket iptal edildi", "ok", restorable ? { action: { label: "Geri al", onClick: () => void restore(restorable) } } : undefined);
    // Eylem revalidatePath yapar: sayfa aynı yanıtla tazelenir (router.refresh ikinci tur olurdu, B037).
    onClose();
  }

  async function restore(info: UndoInfo) {
    if (info.adoptExpenseId) {
      const adopted = await adoptLegacyExpenses(info.accountId, [info.adoptExpenseId]);
      if (!adopted.ok) return push(adopted.error, "err");
      if ((adopted.count ?? 0) === 0) return push("Gider yeniden hesaba taşınamadı; Hesapsız listesinden elle taşıyın.", "err");
      push("Hareket geri alındı (gider yeniden hesaba taşındı)", "ok");
      router.refresh();
      return;
    }
    const res = await recordCashEntry(entry.direction, {
      accountId: info.accountId,
      amount: String(entry.amount),
      date: entry.date,
      category: entry.category ?? "",
      title: entry.title,
      counterparty: entry.counterparty ?? "",
      note: entry.note ?? "",
      alsoExpense: info.hadExpense,
    });
    if (res.error) return push(res.error, "err");
    push("Hareket geri alındı", "ok");
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
