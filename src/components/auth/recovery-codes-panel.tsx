"use client";

import { useState } from "react";
import { Check, Copy, Download, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Kurtarma kodları — YALNIZ bir kez gösterilir (sunucu yalnız özetini saklar). Kopyala / metin dosyası olarak kaydet,
 * "kaydettim" onayı verilmeden devam düğmesi açılmaz. Telefon kaybında authenticator yerine bir kod kullanılır.
 */
export function RecoveryCodesPanel({
  codes,
  onDone,
  doneLabel = "Devam et",
}: {
  codes: string[];
  onDone?: () => void;
  doneLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [ack, setAck] = useState(false);
  const text = `EmlakSoft kurtarma kodları\nHer kod yalnız bir kez kullanılabilir.\n\n${codes.join("\n")}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function save() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "emlaksoft-kurtarma-kodlari.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/8 p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-ink-950">
        <KeyRound className="h-4 w-4 text-amber-600" aria-hidden="true" /> Kurtarma kodlarınız
      </p>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        Telefonunuzu kaybederseniz authenticator kodu yerine bu kodlardan birini girersiniz. Her kod bir kez çalışır.
        Kodlar bir daha gösterilmez; güvenli bir yere kaydedin.
      </p>
      <ol className="mt-3 grid grid-cols-2 gap-2" aria-label="Kurtarma kodları">
        {codes.map((code) => (
          <li
            key={code}
            className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-2 text-center font-mono text-sm font-bold tracking-wider text-ink-950 select-all"
          >
            {code}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" icon={copied ? Check : Copy} onClick={copy}>
          {copied ? "Kopyalandı" : "Kopyala"}
        </Button>
        <Button variant="outline" size="sm" icon={Download} onClick={save}>
          Dosya olarak kaydet
        </Button>
      </div>
      {onDone ? (
        <div className="mt-4 border-t border-line pt-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink-900">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-brand-600"
            />
            Kodları güvenli bir yere kaydettim
          </label>
          <Button className="mt-2 w-full sm:w-auto" disabled={!ack} onClick={onDone}>
            {doneLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
