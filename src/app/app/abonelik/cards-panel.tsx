"use client";

import { useState, useTransition } from "react";
import { CreditCard, Loader2, ShieldCheck, Star, Trash2 } from "lucide-react";
import { removePaymentCard, setAutoRenewConsent, setDefaultPaymentCard } from "@/app/actions/payment-cards";
import { maskedCardLabel, type PaymentCardRow } from "@/lib/billing/cards";

/**
 * Kayıtlı kartlar. Kart numarası/CVC/son kullanma bu ekranda HİÇ yoktur: kart iyzico'nun güvenli ödeme sayfasında
 * girilir ve iyzico'da saklanır; burada yalnız maskeli gösterim ve yönetim vardır.
 */
export function CardsPanel({
  cards,
  canManage,
  autoRenewAvailable,
  autoRenewEnabled,
  autoRenewCardId,
}: {
  cards: PaymentCardRow[];
  canManage: boolean;
  /** Yönetici bayrağı açıksa rıza alanı görünür; kapalıyken hiç gösterilmez. */
  autoRenewAvailable: boolean;
  autoRenewEnabled: boolean;
  autoRenewCardId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const defaultCard = cards.find((c) => c.is_default) ?? cards[0];

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "İşlem tamamlanamadı.");
      setBusyId(null);
      setConfirmId(null);
    });
  }

  return (
    <section id="kartlar" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <p className="flex items-center gap-2 text-xs font-semibold text-accent-text">
        <CreditCard className="h-4 w-4" /> Kayıtlı kartlar
      </p>
      <h2 className="mt-1 font-display font-bold text-text">Ödeme kartlarınız</h2>
      <p className="mt-1 flex items-start gap-1.5 text-xs text-text-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-strong" />
        Kart bilgileriniz EmlakSoft&apos;ta tutulmaz; iyzico güvenli kasasında saklanır. Burada yalnızca maskeli özet görünür.
      </p>

      {cards.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
          Kayıtlı kartınız yok. Bir paket için ödeme yaparken &quot;Kartımı sakla&quot; kutusunu işaretleyerek kart ekleyebilirsiniz.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {cards.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-4 py-3">
              <CreditCard className="h-5 w-5 text-text-muted" />
              <div className="min-w-0 flex-1">
                <p className="numeric text-sm font-semibold text-text">{maskedCardLabel(c)}</p>
                <p className="text-xs text-text-faint">
                  {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(c.created_at))} tarihinde eklendi
                </p>
              </div>
              {c.is_default ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-mint-500/15 px-2.5 py-1 text-xs font-bold text-success-strong">
                  <Star className="h-3 w-3" /> Varsayılan
                </span>
              ) : null}
              {canManage ? (
                <div className="flex items-center gap-2">
                  {!c.is_default ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(c.id, () => setDefaultPaymentCard(c.id))}
                      className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text transition hover:border-brand-400 disabled:opacity-60"
                    >
                      {busyId === c.id && pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Varsayılan yap"}
                    </button>
                  ) : null}
                  {confirmId === c.id ? (
                    <>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(c.id, () => removePaymentCard(c.id))}
                        className="rounded-[var(--radius-control)] bg-danger-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        {busyId === c.id && pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Evet, sil"}
                      </button>
                      <button type="button" onClick={() => setConfirmId(null)} className="text-xs font-semibold text-text-muted hover:underline">
                        Vazgeç
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      aria-label={`${maskedCardLabel(c)} kartını sil`}
                      onClick={() => setConfirmId(c.id)}
                      className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted transition hover:border-danger-500/50 hover:text-danger-strong"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {autoRenewAvailable && cards.length > 0 && canManage ? (
        <div className="mt-5 rounded-[var(--radius-card)] border border-line p-4">
          <p className="text-sm font-semibold text-text">Otomatik yenileme</p>
          {autoRenewEnabled ? (
            <>
              <p className="mt-1 text-xs text-text-muted">
                Açık: gecikmiş abonelik ödemesi, onayınızla{" "}
                {cards.find((c) => c.id === autoRenewCardId) ? maskedCardLabel(cards.find((c) => c.id === autoRenewCardId)!) : "seçilen kayıtlı"}{" "}
                kartından otomatik tahsil edilir.
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => run("auto", () => setAutoRenewConsent({ enabled: false }))}
                className="mt-2 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text hover:border-brand-400 disabled:opacity-60"
              >
                Otomatik yenilemeyi kapat
              </button>
            </>
          ) : (
            <>
              <label className="mt-2 flex items-start gap-2 text-xs text-text-muted">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
                <span>
                  Aboneliğimin gecikmesi halinde varsayılan kartımdan, paket bedelini oturum açmama gerek olmadan tahsil etmenizi
                  açıkça onaylıyorum. İstediğim zaman kapatabilirim.
                </span>
              </label>
              <button
                type="button"
                disabled={pending || !consent || !defaultCard}
                onClick={() => defaultCard && run("auto", () => setAutoRenewConsent({ enabled: true, cardId: defaultCard.id }))}
                className="mt-2 rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                Otomatik yenilemeyi aç
              </button>
            </>
          )}
        </div>
      ) : null}

      {error ? <p className="mt-3 text-xs text-danger-strong" role="alert">{error}</p> : null}
    </section>
  );
}
