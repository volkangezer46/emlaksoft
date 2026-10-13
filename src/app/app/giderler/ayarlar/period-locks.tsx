"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import { lockFinancePeriod, unlockFinancePeriod } from "@/app/actions/expense-budgets";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError, FormField, FormInput } from "@/components/ui/form-controls";
import { StatusPill } from "@/components/ui/list-kit/status-pill";
import Link from "@/components/ui/smart-link";

export type PeriodRow = {
  /** YYYY-MM */
  key: string;
  label: string;
  locked: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
  note: string | null;
  /** Bu ayın hareketleri (filtreli Hareketler). */
  href: string;
};

/**
 * Dönem kapanışı: ay kilitlenince o aya hareket/açık kalem eklenemez, değiştirilemez ve iptal edilemez (DB tetiği).
 * Kilitleme `expenses:edit`; kilidi açma YALNIZ ofis sahibi ve genel müdür (sunucu ve RPC de aynı kuralı uygular).
 */
export function PeriodLocks({ rows, canLock, canUnlock }: { rows: readonly PeriodRow[]; canLock: boolean; canUnlock: boolean }) {
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2">
          <span className="min-w-0">
            <Link href={r.href} className="focus-ring rounded text-sm font-semibold capitalize text-text hover:underline">
              {r.label}
            </Link>
            {r.locked ? (
              <span className="mt-0.5 block text-xs text-text-muted">
                {r.lockedAt ? `Kilitlendi: ${r.lockedAt}` : "Kilitli"}
                {r.lockedBy ? ` · ${r.lockedBy}` : ""}
                {r.note ? ` · ${r.note}` : ""}
              </span>
            ) : null}
          </span>
          <span className="flex items-center gap-2">
            <StatusPill tone={r.locked ? "neutral" : "success"} dot={false}>
              {r.locked ? "Kapalı" : "Açık"}
            </StatusPill>
            {r.locked ? (canUnlock ? <UnlockButton month={r.key} label={r.label} /> : null) : canLock ? <LockButton month={r.key} label={r.label} /> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function LockButton({ month, label }: { month: string; label: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get("note") ?? "");
    setError(null);
    start(async () => {
      const res = await lockFinancePeriod(month, note);
      if (!res.ok) return setError(res.error);
      push(`${label} kapatıldı`, "ok");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="xs" icon={Lock} onClick={() => setOpen(true)} aria-label={`${label} dönemini kilitle`}>
        Ayı kilitle
      </Button>
      {open ? (
        <Dialog open onOpenChange={(v) => (v ? undefined : setOpen(false))}>
          <DialogContent size="sm">
            <DialogHeader
              title={`${label} kapatılsın mı?`}
              description="Kilitli aya yeni hareket ya da vade kaydı eklenemez, mevcutlar değiştirilemez ve iptal edilemez. Kilidi yalnız ofis sahibi ve genel müdür açabilir."
              icon={<Lock />}
            />
            <form onSubmit={submit}>
              <DialogBody className="grid gap-4">
                <FormField label="Not (isteğe bağlı)" htmlFor={`pl-note-${month}`} hint="Örn. Beyanname verildi, muhasebeciye teslim edildi.">
                  <FormInput id={`pl-note-${month}`} name="note" maxLength={200} autoComplete="off" />
                </FormField>
                <FormError error={error} nextStep={null} />
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button>
                <Button type="submit" variant="primary" icon={Lock} loading={pending}>
                  Ayı kilitle
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function UnlockButton({ month, label }: { month: string; label: string }) {
  const router = useRouter();
  const { push } = useToast();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="xs" icon={LockOpen} aria-label={`${label} kilidini aç`}>
          Kilidi aç
        </Button>
      }
      title={`${label} kilidi açılsın mı?`}
      description="Kilit açılınca bu aya yeniden kayıt girilebilir ve mevcut kayıtlar değiştirilebilir. İşlem denetim kaydına yazılır."
      confirmLabel="Kilidi aç"
      tone="danger"
      onConfirm={async () => {
        const res = await unlockFinancePeriod(month);
        if (!res.ok) push(res.error, "err");
        else {
          push(`${label} kilidi açıldı`, "ok");
          router.refresh();
        }
      }}
    />
  );
}
