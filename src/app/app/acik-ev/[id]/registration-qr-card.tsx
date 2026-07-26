"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, Loader2, MonitorSmartphone, Printer, QrCode } from "lucide-react";

/**
 * Açık ev kayıt QR kartı — public self check-in linki (/acik-ev-kayit/[token]).
 *
 * NEDEN YEREL VARYANT: VitrinQr (components/public/vitrin-qr.tsx) vitrin
 * metinlerine sabitlenmiş; buradaki metinler (kapıya asma ipucu, kiosk linki)
 * farklı. QR üretim yaklaşımı AYNI: goqr.me (api.qrserver.com) harici servisi —
 * gerekçesi vitrin-qr.tsx'te (depoda doğrulanabilir yerel QR encoder yok).
 * Servise yalnızca zaten herkese açık kayıt URL'i iletilir; kişisel veri gitmez.
 */
export function RegistrationQrCard({ publicUrl }: { publicUrl: string }) {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  const kioskUrl = `${publicUrl}?kiosk=1`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=2&format=png&data=${encodeURIComponent(publicUrl)}`;
  const qrPrintSrc = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=4&format=png&data=${encodeURIComponent(publicUrl)}`;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard izni yoksa (eski tarayıcı/HTTP) linki seçilebilir göstermek
      // için prompt son çare olarak yeterli.
      window.prompt("Linki kopyalayın:", publicUrl);
    }
  }

  async function onDownload() {
    setDownloading(true);
    try {
      const res = await fetch(qrPrintSrc);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "acik-ev-kayit-qr.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(qrPrintSrc, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  function onPrint() {
    const w = window.open("", "_blank", "noopener,noreferrer,width=480,height=640");
    if (!w) return;
    w.document.write(`<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>Açık ev kayıt QR kodu</title>
<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;gap:16px}img{width:320px;height:320px}h1{font-size:20px;margin:0}p{font-size:13px;color:#333;max-width:360px;text-align:center;word-break:break-all;margin:0}</style>
</head><body>
<h1>Açık ev ziyaretçi kaydı</h1>
<img src="${qrPrintSrc}" alt="Açık ev kayıt QR kodu" onload="setTimeout(function(){window.print()},150)">
<p>Telefonunuzun kamerasıyla okutun, adınızı bırakın.</p>
<p>${publicUrl}</p>
</body></html>`);
    w.document.close();
  }

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <QrCode className="h-4 w-4 text-brand-600" /> Kayıt QR&apos;ı
          </h2>
          <p className="mt-1 max-w-md text-xs text-text-muted">
            Kapıya asın — ziyaretçiler telefonla okutup kendileri kaydolur; siz kapıda isim yazmakla
            uğraşmazsınız.
          </p>
          <code className="mt-3 block w-fit max-w-full truncate rounded-[10px] border border-line bg-canvas px-3 py-2 text-xs text-ink-950">
            {publicUrl}
          </code>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-brand-600/90"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Kopyalandı" : "Linki kopyala"}
            </button>
            <button
              type="button"
              onClick={onDownload}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-300 disabled:opacity-60"
            >
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              PNG indir
            </button>
            <button
              type="button"
              onClick={onPrint}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
            >
              <Printer className="h-3.5 w-3.5" /> Yazdır
            </button>
          </div>

          <a
            href={kioskUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex w-fit items-start gap-2 rounded-[12px] border border-line bg-canvas/60 px-3.5 py-2.5 text-xs text-text-muted transition hover:border-brand-300"
          >
            <MonitorSmartphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
            <span>
              <span className="font-bold text-ink-950">Kiosk modu</span> — girişteki tablette bu linki
              açık bırakın; her kayıttan sonra form kendini sıfırlar.
            </span>
          </a>

          <p className="mt-3 text-[11px] text-text-faint">
            QR görseli harici bir servisle (goqr.me) üretilir; yalnızca herkese açık kayıt linki iletilir.
            Sayfada açık adres gösterilmez.{" "}
            <Link href={publicUrl} target="_blank" className="font-semibold underline-offset-2 hover:underline">
              Sayfayı önizle
            </Link>
          </p>
        </div>
        <div className="rounded-[14px] border border-line bg-white p-3">
          {/* Harici servis görseli — next/image yerine img: uzak domain yapılandırması gerektirmez */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrSrc}
            alt="Açık ev kayıt sayfası için QR kodu"
            width={200}
            height={200}
            className="h-[200px] w-[200px]"
          />
        </div>
      </div>
    </section>
  );
}
