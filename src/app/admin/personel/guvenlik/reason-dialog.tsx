"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

export const MIN_SECURITY_REASON = 10;

/**
 * Gerekçeli onay penceresi (güvenlik ayarları, doğrulayıcı sıfırlama, bayrak anahtarı). Gerekçe en az 10 karakter;
 * sunucu eylemi aynı kuralı yeniden uygular. Hata pencere içinde gösterilir, başarıda pencere kapanır.
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  confirmLabel = "Onayla",
  tone = "default",
  onConfirm,
  open: openProp,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: "default" | "danger";
  onConfirm: (reason: string) => Promise<{ error?: string } | void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
    if (!next) {
      setReason("");
      setError(null);
    }
  };
  const short = reason.trim().length < MIN_SECURITY_REASON;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent size="sm">
        <DialogHeader icon={<AlertTriangle />} tone={tone} title={title} description={description} />
        <DialogBody className="space-y-2">
          <label htmlFor="security-reason" className="block text-sm font-semibold text-ink-900">
            Gerekçe
          </label>
          <Textarea
            id="security-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Neden değiştiriyorsunuz? (denetim izine yazılır)"
          />
          <p className="text-xs text-text-muted">En az {MIN_SECURITY_REASON} karakter.</p>
          {error ? (
            <p role="alert" className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Vazgeç</Button>
          </DialogClose>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            loading={pending}
            disabled={short}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await onConfirm(reason.trim());
                if (res && res.error) {
                  setError(res.error);
                  return;
                }
                setOpen(false);
              })
            }
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
