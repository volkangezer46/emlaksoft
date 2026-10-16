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
import { useToast } from "@/components/app/toast-provider";

/** `{ error: "..." }` sonucundan kullanıcı metni (void / başarı → null). */
function outcomeError(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("error" in result)) return null;
  const message = (result as { error?: unknown }).error;
  return typeof message === "string" && message.trim() ? message : null;
}

/**
 * ConfirmDialog — yıkıcı/geri alınamaz işlemler için standart onay penceresi.
 * native confirm() ve onaysız tek-tık silmelerin yerini alır.
 *
 * İki kullanım biçimi:
 * 1) `onConfirm` — client callback (async olabilir; bitince kapanır)
 * 2) `formAction` — server action; `hiddenFields` gizli input olarak eklenir
 *    (mevcut <form action={...}> silme desenleri sarmalamadan taşınabilsin diye)
 *
 * Sonuç: eylem `{ ok } | { error }` döndürebilir (SK10 / B166). `error` gelirse pencere nedeni gösterir (yetki reddi
 * dahil); sessizce kapanmaz. Sonuç döndürmeyen (void) eylemler eskisi gibi çalışır.
 *
 * Başarı geri bildirimi: `successMessage` verilirse eylem hatasız bitince kısa bir bildirim (toast) çıkar; yoksa sessiz
 * kapanır (kayıt listeden kalktığı için yeterli sayılan yerler).
 *
 * Denetimli kullanım: `open` + `onOpenChange` verilirse `trigger` isteğe bağlıdır (ör. ⋮ menü öğesinden açılış;
 * menü kapanınca tetik DOM'dan kalksa da diyalog açık kalır).
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
  open: openProp,
  onOpenChange,
  successMessage,
}: {
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  onConfirm?: () => void | Promise<unknown>;
  formAction?: (formData: FormData) => void | Promise<unknown>;
  hiddenFields?: Record<string, string>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hatasız bitişte gösterilecek kısa onay metni (ör. "Hedef silindi"). */
  successMessage?: string;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();

  const confirmVariant = tone === "danger" ? "danger" : "primary";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent size="sm">
        <DialogHeader
          icon={<AlertTriangle />}
          tone={tone === "danger" ? "danger" : "default"}
          title={title}
          description={description}
        />
        {error ? (
          <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{cancelLabel}</Button>
          </DialogClose>
          {formAction ? (
            <form
              action={async (formData: FormData) => {
                setError(null);
                const message = outcomeError(await formAction(formData));
                // Ret/hata sessizce yutulmaz: pencere nedeniyle yeniden açılır.
                if (message) {
                  setError(message);
                  setOpen(true);
                } else if (successMessage) {
                  push(successMessage, "ok");
                }
              }}
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
                  setError(null);
                  const message = outcomeError(await onConfirm?.());
                  if (message) {
                    setError(message);
                    return;
                  }
                  setOpen(false);
                  if (successMessage) push(successMessage, "ok");
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
