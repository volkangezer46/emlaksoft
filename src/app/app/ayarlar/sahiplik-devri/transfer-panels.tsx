"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";
import { ICONS } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { FormError, FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import {
  acceptOwnershipTransfer,
  requestOwnershipTransfer,
  resolveOwnershipTransfer,
  type OwnershipActionResult,
} from "@/app/actions/ownership-transfer";

function useAction() {
  const router = useRouter();
  const [result, setResult] = useState<OwnershipActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (action: (fd: FormData) => Promise<OwnershipActionResult>, fd: FormData) => {
    setResult(null);
    startTransition(async () => {
      const res = await action(fd);
      setResult(res);
      if (res.ok) router.refresh();
    });
  };
  return { result, pending, run };
}

/** Sahip: devralacak kişiyi ve kendi devir sonrası rolünü seçer, parolasıyla başlatır (sayfa içi onay, popup yok). */
export function RequestTransferForm({
  candidates,
  roles,
  ttlHours,
}: {
  candidates: { id: string; label: string }[];
  roles: readonly { value: string; label: string }[];
  ttlHours: number;
}) {
  const { result, pending, run } = useAction();
  const [ack, setAck] = useState(false);
  const ids = { to: useId(), role: useId(), pw: useId(), ack: useId() };

  if (result?.ok) {
    return <Alert tone="success" title="Talep gönderildi">{result.message}</Alert>;
  }

  return (
    <form
      className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5"
      aria-label="Sahiplik devri başlat"
      onSubmit={(e) => {
        e.preventDefault();
        run(requestOwnershipTransfer, new FormData(e.currentTarget));
      }}
    >
      <div>
        <h2 className="font-display text-lg font-bold text-ink-950">Devri başlat</h2>
        <p className="mt-1 text-sm text-text-muted">
          Devralacak kişi {ttlHours} saat içinde onaylamazsa talep düşer. Onaylanana kadar hiçbir yetki değişmez; dilediğiniz an iptal edebilirsiniz.
        </p>
      </div>
      <FormField label="Devralacak kişi" htmlFor={ids.to} required>
        <FormSelect name="to_user_id" defaultValue="" required>
          <option value="" disabled>
            Ekipten birini seçin
          </option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="Devirden sonra sizin rolünüz" htmlFor={ids.role} hint="Ofiste kalırsınız; yalnız sahiplik yetkileri yeni sahibe geçer.">
        <FormSelect name="demote_role" defaultValue="gm">
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="Parolanız" htmlFor={ids.pw} required hint="Kimliğinizi doğrulamak için.">
        <FormInput name="password" type="password" autoComplete="current-password" required />
      </FormField>
      <label htmlFor={ids.ack} className="flex cursor-pointer items-start gap-2 text-sm text-text">
        <input id={ids.ack} type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--brand-600)]" />
        Onaylandığında ofis sahipliğinin (faturalama, roller, ofis ayarları) devredileceğini anlıyorum.
      </label>
      <FormError error={result?.error} nextStep={null} />
      <Button type="submit" icon={ICONS.sahiplik} loading={pending} disabled={!ack}>
        Devir talebini gönder
      </Button>
    </form>
  );
}

/** Devralacak kişi: talebi parolasıyla onaylar ya da reddeder. */
export function AcceptTransferPanel({
  transferId,
  fromName,
  demoteRoleLabel,
  expiresLabel,
}: {
  transferId: string;
  fromName: string;
  demoteRoleLabel: string;
  expiresLabel: string;
}) {
  const accept = useAction();
  const decline = useAction();
  const pwId = useId();

  if (accept.result?.ok) {
    return <Alert tone="success" title="Sahiplik devralındı">{accept.result.message}</Alert>;
  }
  if (decline.result?.ok) {
    return <Alert tone="info">{decline.result.message}</Alert>;
  }

  return (
    <form
      className="space-y-4 rounded-[var(--radius-panel)] border border-brand-300 bg-brand-500/[0.04] p-5"
      aria-label="Sahiplik devri onayı"
      onSubmit={(e) => {
        e.preventDefault();
        accept.run(acceptOwnershipTransfer, new FormData(e.currentTarget));
      }}
    >
      <input type="hidden" name="transfer_id" value={transferId} />
      <div>
        <h2 className="font-display text-lg font-bold text-ink-950">Ofis sahipliği size devredilmek isteniyor</h2>
        <p className="mt-1 text-sm text-text-muted">
          {fromName} sahipliği size devretmek istiyor. Onaylarsanız ofis sahibi siz olursunuz; {fromName} {demoteRoleLabel} rolüne geçer.
          Talep {expiresLabel} tarihine kadar geçerli.
        </p>
      </div>
      <FormField label="Parolanız" htmlFor={pwId} required hint="Onay için kendi parolanızı girin.">
        <FormInput name="password" type="password" autoComplete="current-password" required />
      </FormField>
      <FormError error={accept.result?.error ?? decline.result?.error} nextStep={null} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" icon={CheckCircle2} loading={accept.pending} disabled={decline.pending}>
          Onayla ve devral
        </Button>
        <Button
          type="button"
          variant="ghost"
          icon={X}
          loading={decline.pending}
          disabled={accept.pending}
          onClick={() => {
            const fd = new FormData();
            fd.set("transfer_id", transferId);
            fd.set("decision", "declined");
            decline.run(resolveOwnershipTransfer, fd);
          }}
        >
          Reddet
        </Button>
      </div>
    </form>
  );
}

/** Başlatan sahip: bekleyen talebi geri çeker. */
export function CancelTransferButton({ transferId }: { transferId: string }) {
  const { result, pending, run } = useAction();
  return (
    <div className="space-y-2">
      <FormError error={result?.error} nextStep={null} />
      <Button
        type="button"
        variant="secondary"
        icon={X}
        loading={pending}
        onClick={() => {
          const fd = new FormData();
          fd.set("transfer_id", transferId);
          fd.set("decision", "cancelled");
          run(resolveOwnershipTransfer, fd);
        }}
      >
        Talebi iptal et
      </Button>
    </div>
  );
}
