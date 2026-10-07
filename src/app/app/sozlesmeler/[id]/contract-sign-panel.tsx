"use client";

import { useState, useTransition } from "react";
import { FileSignature, Loader2, Send, Trash2, UserPlus } from "lucide-react";
import { sendContractForSigning } from "@/app/actions/contracts";
import { EmailInput } from "@/components/ui/email-input";
import { PhoneInput } from "@/components/ui/phone-input";

type Signer = { full_name: string; email: string; phone: string };

export function ContractSignPanel({
  contractId,
  status,
}: {
  contractId: string;
  status: string;
}) {
  const [signers, setSigners] = useState<Signer[]>([{ full_name: "", email: "", phone: "" }]);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok?: boolean; error?: string } | null>(null);

  if (status !== "draft") return null;

  function addSigner() {
    setSigners((prev) => [...prev, { full_name: "", email: "", phone: "" }]);
  }

  function removeSigner(i: number) {
    setSigners((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateSigner(i: number, field: keyof Signer, value: string) {
    setSigners((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  }

  function send() {
    const valid = signers.filter((s) => s.full_name.trim());
    if (!valid.length) {
      setResult({ error: "En az bir imzalayan adı girin." });
      return;
    }
    setResult(null);
    startTransition(async () => {
      const res = await sendContractForSigning(contractId, valid.map((s) => ({
        full_name: s.full_name.trim(),
        email: s.email.trim() || undefined,
        phone: s.phone.trim() || undefined,
      })));
      setResult(res);
    });
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
        <Send className="h-4 w-4 text-brand-600" /> İmzaya gönder
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        İmzalayacak kişileri ekleyin; her biri için benzersiz onay linki oluşturulur.
      </p>

      <div className="mt-4 space-y-3">
        {signers.map((s, i) => (
          <div key={i} className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-950">
                <FileSignature className="h-3.5 w-3.5 text-brand-600" /> İmzalayan {i + 1}
              </span>
              {signers.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSigner(i)}
                  className="grid h-6 w-6 place-items-center rounded-[var(--radius-control)] text-text-faint hover:text-danger-500"
                  aria-label="Sil"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <input
              aria-label="İmzalayan ad soyad"
              type="text"
              placeholder="Ad Soyad *"
              value={s.full_name}
              onChange={(e) => updateSigner(i, "full_name", e.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-400"
              required
            />
            <div className="grid grid-cols-2 gap-2">
              <EmailInput
                aria-label="İmzalayan e-postası"
                placeholder="E-posta (opsiyonel)"
                value={s.email}
                onChange={(e) => updateSigner(i, "email", e.target.value)}
                className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-400 aria-[invalid=true]:border-danger-400"
              />
              <PhoneInput
                aria-label="İmzalayan telefonu"
                value={s.phone}
                onValueChange={(v) => updateSigner(i, "phone", v)}
                className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-400 aria-[invalid=true]:border-danger-400"
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addSigner}
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline"
      >
        <UserPlus className="h-3.5 w-3.5" /> İmzalayan ekle
      </button>

      {result?.error && (
        <p className="mt-3 rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm text-danger-500">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <p className="mt-3 rounded-[var(--radius-control)] bg-mint-500/10 px-3 py-2 text-sm font-semibold text-mint-600">
          ✓ Sözleşme imzalamaya gönderildi.
        </p>
      )}

      <button
        type="button"
        onClick={send}
        disabled={pending || !!result?.ok}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {pending ? "Gönderiliyor…" : "İmzaya gönder"}
      </button>
    </section>
  );
}
