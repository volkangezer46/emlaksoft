"use client";

/* eslint-disable @next/next/no-img-element -- marka önizlemeleri <img> ile (SVG inline gömülmez) */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImageUp, Loader2, RotateCcw, Smartphone } from "lucide-react";
import { resetBrandAsset, uploadBrandAsset } from "@/app/actions/platform-brand";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FileInput } from "@/components/ui/file-input";
import {
  BRAND_MAX_BYTES,
  BRAND_SLOTS,
  BRAND_SLOT_LABELS,
  DEFAULT_BRAND_ASSETS,
  brandAssetUrl,
  resolveBrandSrc,
  type BrandMeta,
  type BrandSlot,
} from "@/lib/brand/slots";

const DEFAULT_SRC: Record<BrandSlot, string> = {
  "logo-light": DEFAULT_BRAND_ASSETS.horizontalLight,
  "logo-dark": DEFAULT_BRAND_ASSETS.horizontalDark,
  mark: DEFAULT_BRAND_ASSETS.markLight,
  favicon: DEFAULT_BRAND_ASSETS.favicon,
};

function SlotCard({ slot, meta }: { slot: BrandSlot; meta: BrandMeta }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const info = meta.slots[slot];
  const cfg = BRAND_SLOT_LABELS[slot];
  const dark = slot === "logo-dark";
  const currentSrc = info ? brandAssetUrl(slot, info) : DEFAULT_SRC[slot];

  const pick = (f: File | null) => {
    setError(null);
    setDone(false);
    if (localUrl) URL.revokeObjectURL(localUrl);
    setLocalUrl(null);
    setFile(null);
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (!lower.endsWith(".svg") && !lower.endsWith(".png")) {
      setError("Yalnız SVG veya PNG yüklenebilir.");
      return;
    }
    const max = lower.endsWith(".svg") ? BRAND_MAX_BYTES.svg : BRAND_MAX_BYTES.png;
    if (f.size > max) {
      setError(`Dosya en fazla ${Math.round(max / 1024)} KB olabilir.`);
      return;
    }
    setFile(f);
    setLocalUrl(URL.createObjectURL(f));
  };

  const upload = () => {
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("slot", slot);
    fd.set("file", file);
    start(async () => {
      const res = await uploadBrandAsset(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDone(true);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  };

  const reset = () => {
    setError(null);
    const fd = new FormData();
    fd.set("slot", slot);
    start(async () => {
      const res = await resetBrandAsset(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDone(false);
      router.refresh();
    });
  };

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-extrabold text-ink-950">{cfg.label}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{cfg.hint}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${info ? "bg-brand-600/10 text-brand-700" : "bg-ink-950/6 text-text-muted"}`}
        >
          {info ? `Özel (${info.type.toUpperCase()})` : "Varsayılan"}
        </span>
      </div>

      <div
        className={`mt-4 grid min-h-28 place-items-center rounded-[var(--radius-card)] border border-line p-4 ${dark ? "bg-[#0b1220]" : "bg-white"}`}
      >
        <img
          src={localUrl ?? currentSrc}
          alt={`${cfg.label} önizleme`}
          className={cfg.square ? "h-20 w-20 object-contain" : "h-16 max-w-full object-contain"}
        />
      </div>
      {localUrl ? <p className="mt-2 text-xs font-semibold text-amber-600">Seçilen dosyanın önizlemesi — henüz kaydedilmedi.</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FileInput
          ref={inputRef}
          accept=".svg,.png,image/svg+xml,image/png"
          aria-label={`${cfg.label} dosyası seç`}
          className="w-full max-w-xs"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          disabled={pending}
        />
        <button
          type="button"
          onClick={upload}
          disabled={!file || pending}
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-brand-700 disabled:opacity-45"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5" />} Yükle ve yayınla
        </button>
        {info ? (
          <ConfirmDialog
            tone="default"
            title={`${cfg.label} varsayılana dönsün mü?`}
            description="Yüklediğiniz dosya yayından kalkar; EmlakSoft varsayılan markası kullanılır."
            confirmLabel="Varsayılana dön"
            onConfirm={reset}
            trigger={
              <button
                type="button"
                disabled={pending}
                className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-400 hover:text-ink-950"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Varsayılana dön
              </button>
            }
          />
        ) : null}
      </div>
      <p className="mt-2 text-xs text-text-faint">
        SVG en çok {BRAND_MAX_BYTES.svg / 1024} KB, PNG en çok {BRAND_MAX_BYTES.png / 1024} KB.
        {cfg.square ? " Kare olmalı." : ""} SVG içinde betik, olay özniteliği ve dış kaynak bulunamaz.
      </p>
      {error ? <p role="alert" className="mt-2 text-xs font-semibold text-danger-500">{error}</p> : null}
      {done && !error ? (
        <p role="status" className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-mint-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> Yayınlandı; site genelinde birkaç saniye içinde yansır.
        </p>
      ) : null}

    </section>
  );
}

export function BrandManager({ meta }: { meta: BrandMeta }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const hasCustom = Object.keys(meta.slots).length > 0;

  const faviconSrc = meta.slots.favicon ? brandAssetUrl("favicon", meta.slots.favicon) : DEFAULT_BRAND_ASSETS.favicon;
  const markSrc = resolveBrandSrc(meta, "mark", "light");

  const resetAll = () => {
    setError(null);
    const fd = new FormData();
    fd.set("slot", "all");
    start(async () => {
      const res = await resetBrandAsset(fd);
      if (res.error) setError(res.error);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-2">
        {BRAND_SLOTS.map((slot) => (
          <SlotCard key={slot} slot={slot} meta={meta} />
        ))}
      </div>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-extrabold text-ink-950">Canlı önizleme</h2>
            <p className="mt-0.5 text-xs text-text-muted">Yayındaki marka: açık zemin, koyu zemin, tarayıcı sekmesi ve mobil ana ekran.</p>
          </div>
          {hasCustom ? (
            <ConfirmDialog
              title="Tüm marka varsayılana dönsün mü?"
              description="Yüklenen tüm logo, sembol ve favicon dosyaları yayından kalkar."
              confirmLabel="Hepsini sıfırla"
              onConfirm={resetAll}
              trigger={
                <button
                  type="button"
                  disabled={pending}
                  className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-danger-500 hover:text-danger-500"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Tüm markayı varsayılana döndür
                </button>
              }
            />
          ) : null}
        </div>
        {error ? <p role="alert" className="mt-2 text-xs font-semibold text-danger-500">{error}</p> : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="grid place-items-center rounded-[var(--radius-card)] border border-line bg-white p-6">
            <img src={resolveBrandSrc(meta, "horizontal", "light")} alt="Açık zeminde logo" className="h-12 max-w-full object-contain" />
          </div>
          <div className="grid place-items-center rounded-[var(--radius-card)] bg-[#0b1220] p-6">
            <img src={resolveBrandSrc(meta, "horizontal", "dark")} alt="Koyu zeminde logo" className="h-12 max-w-full object-contain" />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-text-faint">Tarayıcı sekmesi</p>
            {(["light", "dark"] as const).map((mode) => (
              <div
                key={mode}
                className={`flex items-center gap-2 rounded-t-lg px-3 py-2 text-xs ${mode === "dark" ? "bg-[#202124] text-[#e8eaed]" : "border border-line bg-[#f1f3f4] text-[#202124]"}`}
              >
                <img src={faviconSrc} alt="" className="h-4 w-4" />
                <span className="truncate">EmlakSoft — Türkiye’nin emlak işletim sistemi</span>
                <span className="ml-auto opacity-50">{mode === "dark" ? "koyu sekme" : "açık sekme"}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <div className="rounded-[2rem] border border-line bg-gradient-to-b from-sky-200 to-indigo-300 p-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col items-center gap-1">
                  <img src={markSrc === DEFAULT_BRAND_ASSETS.markLight && !meta.slots.favicon ? DEFAULT_BRAND_ASSETS.appleTouch : faviconSrc} alt="" className="h-12 w-12 rounded-[0.85rem] bg-white object-cover shadow" />
                  <span className="text-xs font-semibold text-white drop-shadow">EmlakSoft</span>
                </div>
                {[0, 1].map((i) => (
                  <div key={i} className="h-12 w-12 rounded-[0.85rem] bg-white/40" aria-hidden />
                ))}
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-text-muted">
              <Smartphone className="h-4 w-4" /> Mobil ana ekran simgesi
            </p>
          </div>
        </div>
      </section>

    </div>
  );
}
