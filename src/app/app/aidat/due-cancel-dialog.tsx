"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { cancelDue } from "@/app/actions/dues";
import { useToast } from "@/components/app/toast-provider";

/**
 * Aidat iptali (silme YOK): kayıt kalır, durumu "iptal" olur, neden denetim kaydına yazılır. Menü kapansa da açık kalır
 * (denetimli `open`). Hata pencerede gösterilir; başarıda liste tazelenir.
 */
export function DueCancelDialog({
  dueId,
  title,
  open,
  onOpenChange,
}: {
  dueId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fieldId = `due-cancel-${dueId}`;

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await cancelDue(dueId, reason);
        if (res.error) {
          setError(res.error);
          return;
        }
        push("Aidat iptal edildi", "ok");
        setReason("");
        onOpenChange(false);
        router.refresh();
      } catch {
        setError("Aidat iptal edilemedi. Bağlantınızı kontrol edip tekrar deneyin.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader
          icon={<Ban />}
          tone="danger"
          title="Aidatı iptal et"
          description={`"${title}" silinmez; iptal edildi olarak kalır ve nedeni denetim kaydına yazılır.`}
        />
        <DialogBody>
          <FormField label="İptal nedeni" htmlFor={fieldId} required hint="En az 3, en çok 300 karakter.">
            <FormInput
              id={fieldId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={3}
              maxLength={300}
              placeholder="Örn. yanlış dönem girildi"
            />
          </FormField>
          {error ? (
            <p role="alert" className="mt-3 rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Vazgeç</Button>
          </DialogClose>
          <Button variant="danger" loading={pending} disabled={reason.trim().length < 3} onClick={submit}>
            İptal et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
