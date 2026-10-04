"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Pencil, UserRound } from "lucide-react";
import { resendSignerSms, updateContractSigner } from "@/app/actions/contract-signers";
import { useToast } from "@/components/app/toast-provider";
import { EmailInput } from "@/components/ui/email-input";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { PhoneInput } from "@/components/ui/phone-input";

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300";

/** İmza bekleyen kişinin bilgilerini düzeltir ve imza linkini SMS ile yeniden gönderir (popup yok). */
export function SignerEditPanel({
  signer,
}: {
  signer: { id: string; full_name: string; email: string | null; phone: string | null };
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [sending, startSend] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await updateContractSigner({}, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      push("İmzalayan güncellendi", "ok");
      setOpen(false);
      router.refresh();
    });
  }

  function resend() {
    startSend(async () => {
      const res = await resendSignerSms(signer.id);
      if (res.error) push(res.error, "err");
      else if (res.sms === "unavailable") push("SMS kapalı ya da telefon uygun değil; linki kopyalayıp elle iletin.", "err");
      else push("İmza linki SMS ile gönderildi", "ok");
    });
  }

  return (
    <>
      <InlineTabbedPanel
        open={open}
        onOpenChange={setOpen}
        title="İmzalayanı düzenle"
        description={signer.full_name}
        icon={<UserRound />}
        onSubmit={submit}
        pending={pending}
        error={error}
        hiddenFields={<input type="hidden" name="signer_id" value={signer.id} />}
        fieldLabels={{ full_name: "Ad soyad", email: "E-posta", phone: "Telefon" }}
        trigger={({ onClick, ...aria }) => (
          <button
            type="button"
            onClick={onClick}
            {...aria}
            title="İmzalayanı düzenle"
            aria-label={`${signer.full_name} bilgilerini düzenle`}
            className="focus-ring press grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        tabs={[{ id: "kisi", label: "Kişi", icon: UserRound, fields: ["full_name", "email", "phone"] }]}
        panels={{
          kisi: (
            <>
              <label className="text-xs font-semibold text-text-muted sm:col-span-2">
                Ad soyad
                <input name="full_name" required maxLength={160} defaultValue={signer.full_name} className={`mt-1 ${fieldClass}`} />
              </label>
              <label className="text-xs font-semibold text-text-muted">
                E-posta
                <EmailInput name="email" defaultValue={signer.email ?? ""} className={`mt-1 ${fieldClass}`} />
              </label>
              <label className="text-xs font-semibold text-text-muted">
                Telefon
                <PhoneInput name="phone" defaultValue={signer.phone ?? ""} className={`mt-1 ${fieldClass}`} />
              </label>
            </>
          ),
        }}
      />
      {signer.phone ? (
        <button
          type="button"
          onClick={resend}
          disabled={sending}
          title="İmza linkini SMS ile yeniden gönder"
          aria-label={`${signer.full_name} için imza linkini SMS ile yeniden gönder`}
          className="focus-ring press grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </>
  );
}
