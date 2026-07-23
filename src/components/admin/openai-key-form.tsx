"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, KeyRound, Sparkles, Trash2 } from "lucide-react";
import { clearOpenAiKey, saveOpenAiKey } from "@/app/actions/ai-advisor";

export function OpenAiKeyForm({
  configured,
  source,
  masked,
  canEdit,
}: {
  configured: boolean;
  source: "db" | "env" | "none";
  masked: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    setSaved(false);
    const fd = new FormData();
    fd.set("key", key.trim());
    startTransition(async () => {
      const res = await saveOpenAiKey(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setKey("");
      setSaved(true);
      router.refresh();
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      const res = await clearOpenAiKey();
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <Sparkles className="h-4 w-4" /> Yapay zeka iş danışmanı
        </p>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            configured ? "bg-mint-500/12 text-mint-600" : "bg-amber-400/15 text-amber-600"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${configured ? "bg-mint-500" : "bg-amber-500"}`} />
          {configured ? (source === "env" ? "Ortam değişkeni" : "Anahtar tanımlı") : "Yedek kip"}
        </span>
      </div>
      <h2 className="mt-1 font-display font-bold text-ink-950">OpenAI API anahtarı</h2>
      <p className="mt-1 text-xs text-text-muted">
        Anahtar girilirse danışman serbest sohbet ve derin analiz yapar. Girilmezse canlı verilerden
        kural-tabanlı içgörü üretir (yedek kip) — sistem her durumda çalışır.
      </p>

      {configured && masked ? (
        <div className="mt-4 flex items-center justify-between rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5">
          <span className="flex items-center gap-2 font-mono text-sm text-ink-950">
            <KeyRound className="h-4 w-4 text-mint-600" /> {masked}
          </span>
          {source === "env" ? (
            <span className="text-[11px] text-text-faint">.env üzerinden</span>
          ) : canEdit ? (
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
        <div className="mt-3">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            {configured && source === "db" ? "Anahtarı güncelle" : "Yeni anahtar"}
          </label>
          <div className="mt-1.5 flex gap-2">
            <div className="relative flex-1">
              <input
                type={show ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                className="h-10 w-full rounded-[10px] border border-line bg-canvas px-3 pr-10 font-mono text-sm text-ink-950 outline-none focus:border-brand-300"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-faint transition hover:text-ink-950"
                aria-label={show ? "Gizle" : "Göster"}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={save}
              disabled={pending || !key.trim()}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> Kaydet
            </button>
          </div>
          {error ? <p className="mt-2 text-xs font-medium text-danger-600">{error}</p> : null}
          {saved ? <p className="mt-2 text-xs font-medium text-mint-600">Anahtar kaydedildi.</p> : null}
          <p className="mt-2 text-[11px] text-text-faint">
            Anahtarınız sunucuda şifreli saklanır ve tarayıcıya asla gönderilmez.{" "}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
              Anahtar alın →
            </a>
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-[10px] border border-line bg-canvas/60 px-3 py-2 text-xs text-text-muted">
          Anahtar yalnızca süper admin tarafından yönetilebilir.
        </p>
      )}
    </section>
  );
}
