"use client";

import { useState } from "react";
import { CheckCircle2, FileUp, Loader2, ShieldCheck } from "lucide-react";
import {
  completeDocRequest,
  finalizeDocRequestUpload,
  prepareDocRequestUpload,
} from "@/app/actions/document-request-public";
import { uploadToDirectFileTarget } from "@/lib/direct-file-upload-client";
import { Alert } from "@/components/ui/alert";
import { FileInput } from "@/components/ui/file-input";

export type RequestedType = { type: string; label: string; uploaded: number };

/**
 * Müşterinin telefonundan evrak yüklediği panel. Dosya doğrudan özel depoya gider
 * (tek-nesnelik izin), sunucu baytları doğrular. Popup yok; durum sayfa içinde gösterilir.
 */
export function UploadPanel({
  token,
  types,
  kvkkText,
  kvkkHref,
  canUpload,
}: {
  token: string;
  types: RequestedType[];
  kvkkText: string;
  /** Aydınlatma metni bağlantısı (ofise özgü metin yoksa genel platform aydınlatması). */
  kvkkHref?: string;
  canUpload: boolean;
}) {
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(types.map((t) => [t.type, t.uploaded])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [consent, setConsent] = useState(false);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  async function handleFile(docType: string, file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(docType);
    try {
      const prepared = await prepareDocRequestUpload(token, {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        docType,
      });
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }
      const up = await uploadToDirectFileTarget(prepared.upload, file);
      if (!up.ok) {
        setError(up.error);
        return;
      }
      const done = await finalizeDocRequestUpload(token, prepared.upload.sessionId);
      if (!done.ok) {
        setError(done.error ?? "Dosya doğrulanamadı.");
        return;
      }
      setCounts((c) => ({ ...c, [docType]: (c[docType] ?? 0) + 1 }));
    } catch {
      setError("Yükleme sırasında bir sorun oluştu. Lütfen tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSend() {
    setError(null);
    setBusy("send");
    try {
      const res = await completeDocRequest(token);
      if (!res.ok) {
        setError(res.error ?? "Gönderim tamamlanamadı.");
        return;
      }
      setSent(true);
    } catch {
      setError("Gönderim sırasında bir sorun oluştu. Lütfen tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  if (sent) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-10 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-mint-600" aria-hidden="true" />
        <h2 className="mt-3 font-display text-lg font-bold text-ink-950">Evraklarınız gönderildi</h2>
        <p className="mt-1 text-sm text-text-muted">Teşekkürler. Bu bağlantı artık yeni dosya kabul etmiyor; ofisiniz evraklarınızı inceleyecek.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {types.map((t) => (
          <li key={t.type} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-ink-950">{t.label}</p>
              <span className="text-xs font-semibold text-text-muted">
                {(counts[t.type] ?? 0) > 0 ? `${counts[t.type]} dosya yüklendi` : "Henüz yüklenmedi"}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              {busy === t.type ? (
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Yükleniyor ve doğrulanıyor
                </span>
              ) : (
                <FileInput
                  aria-label={`${t.label} dosyası seç`}
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  disabled={!canUpload || busy !== null || !consent}
                  buttonLabel="Dosya seç veya fotoğraf çek"
                  emptyLabel={consent ? "JPG, PNG, WEBP veya PDF · en çok 10 MB" : "Önce aydınlatma metnini onaylayın"}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    void handleFile(t.type, file);
                    e.target.value = "";
                  }}
                />
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-4 text-xs leading-relaxed text-text-muted">
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
          <span>
            {kvkkText}
            {kvkkHref ? (
              <>
                {" "}
                <a href={kvkkHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 underline underline-offset-2">
                  Aydınlatma metnini aç
                </a>
              </>
            ) : null}
          </span>
        </p>
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-semibold text-ink-950">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="h-4 w-4 rounded border-line accent-brand-600"
          />
          Aydınlatma metnini okudum
        </label>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <button
        type="button"
        onClick={handleSend}
        disabled={!canUpload || busy !== null || total < 1}
        className="focus-ring press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-brand-600 px-4 text-sm font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileUp className="h-4 w-4" aria-hidden="true" />}
        Evraklarımı gönder
      </button>
      <p className="text-center text-xs text-text-faint">Gönderdikten sonra bu bağlantı kapanır.</p>
    </div>
  );
}
