"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "./dialog";
import { Button } from "./button";

/**
 * ConfirmDialog — yıkıcı/geri alınamaz işlemler için standart onay penceresi.
 * native confirm() ve onaysız tek-tık silmelerin yerini alır.
 *
 * İki kullanım biçimi:
 * 1) `onConfirm` — client callback (async olabilir; bitince kapanır)
 * 2) `formAction` — server action; `hiddenFields` gizli input olarak eklenir
 *    (mevcut <form action={...}> silme desenleri sarmalamadan taşınabilsin diye)
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Onayla",
  cancelLabel = "Vazgeç",
  tone = "danger",
  onConfirm,
  formAction,
  hiddenFields,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  onConfirm?: () => void | Promise<void>;
  formAction?: (formData: FormData) => void | Promise<void>;
  hiddenFields?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirmVariant = tone === "danger" ? "danger" : "primary";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader
          icon={<AlertTriangle />}
          tone={tone === "danger" ? "danger" : "default"}
          title={title}
          description={description}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{cancelLabel}</Button>
          </DialogClose>
          {formAction ? (
            <form
              action={formAction}
              onSubmit={() => {
                // Server action revalidate edene kadar dialog açık kalmasın
                startTransition(() => setOpen(false));
              }}
            >
              {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <Button type="submit" variant={confirmVariant} loading={pending}>
                {confirmLabel}
              </Button>
            </form>
          ) : (
            <Button
              variant={confirmVariant}
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  await onConfirm?.();
                  setOpen(false);
                })
              }
            >
              {confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
