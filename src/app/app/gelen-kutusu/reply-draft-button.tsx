"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Send, ShieldAlert, Sparkles } from "lucide-react";
import { InlinePanel, useInlinePanel } from "@/components/ui/inline-panel";
import { suggestReplyDraft } from "@/app/actions/reply-draft";
import { sendCustomerSms } from "@/app/actions/communications";
import { useToast } from "@/components/app/toast-provider";

/**
 * Gelen mesaja AI cevap TASLAĞI (sayfa içi panel, popup yok). Düğme ve panel aynı `panelId` ile eşleşir.
 * Taslak hiçbir yere kaydedilmez ve OTOMATİK GÖNDERİLMEZ: kullanıcı düzenler, kopyalar ya da
 * (İYS onayı varsa) kendisi "SMS olarak gönder"e basar — gönderim mevcut `sendCustomerSms` yoludur.
 * Mesaj metni istemciden gitmez; sunucu kaydı kimliğinden okur ve yapay zekâya maskeleyerek iletir.
 */
export function ReplyDraftButton({ panelId, customerName }: { panelId: string; customerName: string }) {
  const { open, toggle } = useInlinePanel(panelId);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={(e) => toggle(e.currentTarget)}
      className="focus-ring press relative z-10 inline-flex h-8 items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
      aria-label={`${customerName} mesajı için cevap taslağı öner`}
    >
      <Sparkles className="h-3.5 w-3.5" /> Taslak öner
    </button>
  );
}

export function ReplyDraftPanel({
  panelId,
  communicationId,
  customerId,
  customerName,
  consentGranted,
}: {
  panelId: string;
  communicationId: string;
  customerId: string | null;
  customerName: string;
  consentGranted: boolean;
}) {
  return (
    <InlinePanel
      id={panelId}
      title="Cevap taslağı"
      description={`${customerName} mesajı için yapay zekâ önerisi. Gönderilmeden önce siz okuyup düzenlersiniz.`}
      icon={<Sparkles />}
      className="relative z-10 w-full basis-full"
    >
      {(close) => (
        <DraftForm
          communicationId={communicationId}
          customerId={customerId}
          consentGranted={consentGranted}
          close={close}
        />
      )}
    </InlinePanel>
  );
}

function DraftForm({
  communicationId,
  customerId,
  consentGranted,
  close,
}: {
  communicationId: string;
  customerId: string | null;
  consentGranted: boolean;
  close: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [generating, startGenerate] = useTransition();
  const [sending, startSend] = useTransition();

  function generate() {
    setError(null);
    startGenerate(async () => {
      const res = await suggestReplyDraft(communicationId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDraft(res.draft);
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      push("Taslak panoya kopyalandı", "ok");
    } catch {
      push("Kopyalanamadı; metni elle seçip kopyalayın", "err");
    }
  }

  function sendSms() {
    if (!customerId || !draft.trim()) return;
    setError(null);
    startSend(async () => {
      const res = await sendCustomerSms(customerId, draft);
      if (res.error) {
        setError(res.error);
        return;
      }
      push("SMS gönderildi", "ok");
      close();
      router.refresh();
    });
  }

  const canSms = Boolean(customerId) && consentGranted && draft.trim().length > 0 && draft.length <= 460 && !sending;

  return (
    <div className="space-y-3 p-4">
      {draft ? (
        <>
          <label htmlFor={`reply-draft-${communicationId}`} className="text-sm font-semibold text-ink-950">
            Taslak (düzenleyebilirsiniz)
          </label>
          <textarea
            id={`reply-draft-${communicationId}`}
            rows={5}
            maxLength={1500}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full resize-y rounded-[var(--radius-control)] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 outline-none focus:border-brand-300"
          />
          <p className="text-xs text-text-faint">
            Yapay zekâ metni hatalı olabilir; fiyat, tarih ve müsaitlik bilgilerini göndermeden önce kontrol edin. Hiçbir şey otomatik gönderilmez.
          </p>
        </>
      ) : (
        <p className="text-sm text-text-muted">
          Müşterinin mesajı kişisel veriler maskelenerek yapay zekâya iletilir ve kısa bir cevap taslağı hazırlanır.
        </p>
      )}

      {draft && !consentGranted ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Bu müşteri için SMS izni kayıtlı değil; SMS gönderimi kilitli.{" "}
            <Link href="/app/uyum" className="font-semibold underline underline-offset-2">
              Uyum sayfası
            </Link>
            . Metni kopyalayıp başka kanaldan kendiniz iletebilirsiniz.
          </span>
        </p>
      ) : null}

      {error ? (
        <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={close}
          className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
        >
          Kapat
        </button>
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-950 transition hover:border-brand-300 disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" /> {generating ? "Hazırlanıyor…" : draft ? "Yeniden üret" : "Taslak üret"}
        </button>
        {draft ? (
          <>
            <button
              type="button"
              onClick={copy}
              className="focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-950 transition hover:border-brand-300"
            >
              <Copy className="h-4 w-4" /> Kopyala
            </button>
            <button
              type="button"
              onClick={sendSms}
              disabled={!canSms}
              className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> {sending ? "Gönderiliyor…" : "SMS olarak gönder"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
