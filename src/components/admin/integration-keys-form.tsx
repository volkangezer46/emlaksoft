"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, KeyRound, Landmark, MapPinned, Trash2 } from "lucide-react";
import {
  saveEndeksaKeys,
  clearEndeksaKeys,
  saveTapusorKeys,
  clearTapusorKeys,
} from "@/app/actions/integrations";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const field =
  "h-10 w-full rounded-[10px] border border-line bg-canvas px-3 font-mono text-sm text-ink-950 outline-none focus:border-brand-300";

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
        configured ? "bg-mint-500/12 text-mint-600" : "bg-amber-400/15 text-amber-600"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${configured ? "bg-mint-500" : "bg-amber-500"}`} />
      {configured ? "Bağlı" : "Bekliyor"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Endeksa form
// ---------------------------------------------------------------------------

export function EndeksaKeyForm({
  configured,
  maskedClientId,
  canEdit,
}: {
  configured: boolean;
  maskedClientId: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    setSaved(false);
    const fd = new FormData();
    fd.set("clientId", clientId.trim());
    fd.set("clientSecret", clientSecret.trim());
    if (baseUrl.trim()) fd.set("baseUrl", baseUrl.trim());
    startTransition(async () => {
      const res = await saveEndeksaKeys(fd);
      if (res.error) { setError(res.error); return; }
      setClientId(""); setClientSecret(""); setBaseUrl("");
      setSaved(true);
      router.refresh();
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      const res = await clearEndeksaKeys();
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold text-cyan-600">
          <Landmark className="h-4 w-4" /> Bölge endeksi &amp; değerleme
        </p>
        <StatusBadge configured={configured} />
      </div>
      <h2 className="mt-1 font-display font-bold text-ink-950">Endeksa API</h2>
      <p className="mt-1 text-xs text-text-muted">
        Bölgesel fiyat endeksi ve otomatik değerleme (AVM) için. Anahtarlar tanımlandığında{" "}
        <code className="rounded bg-canvas px-1 text-[11px]">/app/degerleme</code> canlı veri kullanır.{" "}
        <a
          href="https://www.endeksa.com/tr/urunler/api-widget"
          target="_blank"
          rel="noreferrer"
          className="text-brand-600 hover:underline"
        >
          Anahtar al →
        </a>
      </p>

      {configured && maskedClientId ? (
        <div className="mt-4 flex items-center justify-between rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5">
          <span className="flex items-center gap-2 font-mono text-sm text-ink-950">
            <KeyRound className="h-4 w-4 text-mint-600" /> {maskedClientId}
          </span>
          {canEdit ? (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-[8px] border border-line px-2 py-1 text-[11px] font-semibold text-danger-500 transition hover:border-danger-500/40 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> Kaldır
            </button>
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <div className="mt-3 space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            {configured ? "Anahtarları güncelle" : "Yeni anahtar"}
          </label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID"
            autoComplete="off"
            className={field}
          />
          <div className="relative">
            <input
              type={showSecret ? "text" : "password"}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Client Secret"
              autoComplete="off"
              className={`${field} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-faint transition hover:text-ink-950"
              aria-label={showSecret ? "Gizle" : "Göster"}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="Base URL (opsiyonel, varsayılan: https://api.endeksa.com)"
            autoComplete="off"
            className={field}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={save}
              disabled={pending || !clientId.trim() || !clientSecret.trim()}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> Kaydet
            </button>
          </div>
          {error ? <p className="text-xs font-medium text-danger-600">{error}</p> : null}
          {saved ? <p className="text-xs font-medium text-mint-600">Endeksa anahtarları kaydedildi.</p> : null}
        </div>
      ) : (
        <p className="mt-3 rounded-[10px] border border-line bg-canvas/60 px-3 py-2 text-xs text-text-muted">
          Anahtar yalnızca süper admin tarafından yönetilebilir.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tapusor form
// ---------------------------------------------------------------------------

export function TapusorKeyForm({
  configured,
  maskedApiKey,
  canEdit,
}: {
  configured: boolean;
  maskedApiKey: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    setSaved(false);
    const fd = new FormData();
    fd.set("apiKey", apiKey.trim());
    if (baseUrl.trim()) fd.set("baseUrl", baseUrl.trim());
    startTransition(async () => {
      const res = await saveTapusorKeys(fd);
      if (res.error) { setError(res.error); return; }
      setApiKey(""); setBaseUrl("");
      setSaved(true);
      router.refresh();
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      const res = await clearTapusorKeys();
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold text-violet-600">
          <MapPinned className="h-4 w-4" /> EDİ değerleme &amp; yatırım puanı
        </p>
        <StatusBadge configured={configured} />
      </div>
      <h2 className="mt-1 font-display font-bold text-ink-950">Tapusor API</h2>
      <p className="mt-1 text-xs text-text-muted">
        Ada/parsel sorgulama, yapay zeka EDİ değerlemesi ve yatırım puanı için. Anahtar tanımlandığında
        değerleme modülü Tapusor kaynağını devreye alır.{" "}
        <a
          href="https://tapusor.com"
          target="_blank"
          rel="noreferrer"
          className="text-brand-600 hover:underline"
        >
          Kurumsal erişim →
        </a>
      </p>

      {configured && maskedApiKey ? (
        <div className="mt-4 flex items-center justify-between rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5">
          <span className="flex items-center gap-2 font-mono text-sm text-ink-950">
            <KeyRound className="h-4 w-4 text-mint-600" /> {maskedApiKey}
          </span>
          {canEdit ? (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-[8px] border border-line px-2 py-1 text-[11px] font-semibold text-danger-500 transition hover:border-danger-500/40 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> Kaldır
            </button>
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <div className="mt-3 space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            {configured ? "Anahtarı güncelle" : "Yeni anahtar"}
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API Key"
              autoComplete="off"
              className={`${field} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-faint transition hover:text-ink-950"
              aria-label={showKey ? "Gizle" : "Göster"}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="Base URL (opsiyonel, varsayılan: https://api.tapusor.com)"
            autoComplete="off"
            className={field}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={save}
              disabled={pending || !apiKey.trim()}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> Kaydet
            </button>
          </div>
          {error ? <p className="text-xs font-medium text-danger-600">{error}</p> : null}
          {saved ? <p className="text-xs font-medium text-mint-600">Tapusor anahtarı kaydedildi.</p> : null}
        </div>
      ) : (
        <p className="mt-3 rounded-[10px] border border-line bg-canvas/60 px-3 py-2 text-xs text-text-muted">
          Anahtar yalnızca süper admin tarafından yönetilebilir.
        </p>
      )}
    </section>
  );
}
