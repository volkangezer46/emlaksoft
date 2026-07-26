"use client";

import { useState } from "react";
import { Download, Loader2, Printer, QrCode } from "lucide-react";

/**
 * Vitrin QR kodu bölümü (/app/ayarlar/lead).
 *
 * NEDEN HARİCİ SERVİS: SVG QR'ı bağımlılıksız üretmek için vendored bir
 * encoder (Reed-Solomon + maske + format bitleri) yazmak mümkün; ancak bu
 * depoda üretilen matrisin doğruluğunu bağımsız çapraz kontrol edecek hiçbir
 * araç yok (node_modules'ta QR paketi yok, tarayıcı/dekoder yok). Doğrulanamayan
 * bir encoder'la basılı materyale çıkan hatalı QR sessiz felakettir — bu yüzden
 * dürüst tercih: goqr.me (api.qrserver.com) harici servisi. Vitrin adresi
 * (zaten herkese açık URL) bu servise iletilir; kişisel veri gönderilmez.
 */
export function VitrinQr({ vitrinUrl }: { vitrinUrl: string }) {
  const [downloading, setDownloading] = useState(false);

  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=2&format=png&data=${encodeURIComponent(vitrinUrl)}`;
  const qrPrintSrc = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=4&format=png&data=${encodeURIComponent(vitrinUrl)}`;

  async function onDownload() {
    setDownloading(true);
    try {
      // goqr.me CORS'a açık — blob indirip yerel dosya olarak kaydettir.
      const res = await fetch(qrPrintSrc);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vitrin-qr.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // CORS/ağ engelinde son çare: görseli yeni sekmede aç (sağ tık → kaydet).
      window.open(qrPrintSrc, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  function onPrint() {
    const w = window.open("", "_blank", "noopener,noreferrer,width=480,height=640");
    if (!w) return;
    w.document.write(`<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>Vitrin QR kodu</title>
<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;gap:16px}img{width:320px;height:320px}p{font-size:13px;color:#333;max-width:360px;text-align:center;word-break:break-all}</style>
</head><body>
<img src="${qrPrintSrc}" alt="Vitrin QR kodu" onload="setTimeout(function(){window.print()},150)">
<p>${vitrinUrl}</p>
</body></html>`);
    w.document.close();
  }

  if (!vitrinUrl) {
    return (
      <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <QrCode className="h-4 w-4 text-brand-600" /> Vitrin QR kodu
        </h2>
        <p className="mt-2 text-xs text-text-muted">
          QR kodu üretmek için önce ofisinizin vitrin adresi (slug) tanımlı olmalı.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <QrCode className="h-4 w-4 text-brand-600" /> Vitrin QR kodu
          </h2>
          <p className="mt-1 max-w-md text-xs text-text-muted">
            Ofis camına, kartvizite veya ilan afişine basın — tarayan herkes vitrin sayfanıza ulaşır.
          </p>
          <code className="mt-3 block w-fit max-w-full truncate rounded-[10px] border border-line bg-canvas px-3 py-2 text-xs text-ink-950">
            {vitrinUrl}
          </code>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onDownload}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-brand-600/90 disabled:opacity-60"
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
          <p className="mt-3 text-[11px] text-text-faint">
            QR görseli harici bir servisle (goqr.me) üretilir; yalnızca herkese açık vitrin adresiniz iletilir.
          </p>
        </div>
        <div className="rounded-[14px] border border-line bg-white p-3">
          {/* Harici servis görseli — next/image yerine img: uzak domain yapılandırması gerektirmez */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc} alt={`${vitrinUrl} için QR kodu`} width={200} height={200} className="h-[200px] w-[200px]" />
        </div>
      </div>
    </section>
  );
}
