"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Droplets, ImageOff, Loader2, Save } from "lucide-react";
import {
  DEFAULT_WATERMARK,
  WATERMARK_MODES,
  WATERMARK_MODE_LABEL,
  WATERMARK_POSITION_LABEL,
  WATERMARK_LIMITS,
  sanitizeWatermarkSettings,
  type WatermarkMode,
  type WatermarkPosition,
  type WatermarkSettings,
} from "@/lib/watermark";
import {
  buildMarkCanvas,
  drawWatermarkOnContext,
  effectiveWatermarkMode,
  loadWatermarkLogo,
} from "@/lib/watermark-canvas";
import { saveWatermarkSettings, type WatermarkSettingsResult } from "@/app/actions/watermark-settings";

const PREVIEW_W = 900;
const PREVIEW_H = 600;

/** Konum ızgarası — 3x3 hücrenin 5'i kullanılır (köşeler + orta). */
const POSITION_GRID: (WatermarkPosition | null)[] = [
  "sol-ust",
  null,
  "sag-ust",
  null,
  "orta",
  null,
  "sol-alt",
  null,
  "sag-alt",
];

/** Gerçek fotoğraf yoksa çizilen yerleşik örnek (degrade + ufuk çizgisi). */
function drawFallbackScene(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, PREVIEW_W, PREVIEW_H);
  g.addColorStop(0, "#1f2a44");
  g.addColorStop(0.55, "#3d5a80");
  g.addColorStop(1, "#98c1d9");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);

  // Basit bina siluetleri — filigranın koyu/açık zeminde okunurluğu görülsün
  ctx.fillStyle = "rgba(12, 18, 32, 0.45)";
  const bars = [
    [60, 330, 120, 270],
    [200, 250, 90, 350],
    [310, 380, 140, 220],
    [470, 300, 110, 300],
    [600, 200, 130, 400],
    [750, 360, 110, 240],
  ];
  for (const [x, y, w, h] of bars) ctx.fillRect(x, y, w, h);

  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.font = "600 22px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Örnek görsel", 28, 28);
}

export function WatermarkForm({
  initial,
  officeName,
  logoUrl,
  sampleMediaId,
}: {
  initial: WatermarkSettings;
  officeName: string;
  logoUrl: string | null;
  sampleMediaId: string | null;
}) {
  const [settings, setSettings] = useState<WatermarkSettings>(initial);
  const [logoStatus, setLogoStatus] = useState<"loading" | "ok" | "yok">(logoUrl ? "loading" : "yok");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Kaynaklar state'te tutulur (ref DEĞİL): render sırasında ref okumak saflık
  // kuralını bozar ve yüklendiklerinde yeniden çizim tetiklenmez.
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);
  const [sceneImg, setSceneImg] = useState<HTMLImageElement | null>(null);

  const [state, formAction, pending] = useActionState<WatermarkSettingsResult, FormData>(
    saveWatermarkSettings,
    {},
  );

  const patch = (p: Partial<WatermarkSettings>) =>
    setSettings((prev) => sanitizeWatermarkSettings({ ...prev, ...p }));

  // Logo + örnek fotoğraf yükleme (bir kez)
  useEffect(() => {
    let alive = true;
    void loadWatermarkLogo(logoUrl).then((img) => {
      if (!alive) return;
      setLogoImg(img);
      setLogoStatus(img ? "ok" : "yok");
    });
    if (sampleMediaId) {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (alive && img.naturalWidth > 0) setSceneImg(img);
      };
      // 404 (taslak portföy) veya ağ hatası → yerleşik örnek görsel kullanılır
      img.onerror = () => {};
      img.src = `/api/property-media/${sampleMediaId}`;
    }
    return () => {
      alive = false;
    };
  }, [logoUrl, sampleMediaId]);

  const markText = (settings.text || officeName || "").trim();

  // Canlı önizleme — ayar her değiştiğinde yeniden çizilir
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
    const scene = sceneImg;
    if (scene && scene.naturalWidth > 0) {
      // object-cover davranışı
      const sRatio = scene.naturalWidth / scene.naturalHeight;
      const tRatio = PREVIEW_W / PREVIEW_H;
      let sw = scene.naturalWidth;
      let sh = scene.naturalHeight;
      if (sRatio > tRatio) sw = scene.naturalHeight * tRatio;
      else sh = scene.naturalWidth / tRatio;
      ctx.drawImage(
        scene,
        (scene.naturalWidth - sw) / 2,
        (scene.naturalHeight - sh) / 2,
        sw,
        sh,
        0,
        0,
        PREVIEW_W,
        PREVIEW_H,
      );
    } else {
      drawFallbackScene(ctx);
    }

    if (!settings.enabled) return;
    const mark = buildMarkCanvas(settings, { logo: logoImg, text: markText });
    if (!mark) return;
    drawWatermarkOnContext(ctx, PREVIEW_W, PREVIEW_H, mark, settings);
  }, [settings, markText, logoImg, sceneImg]);

  const appliedMode = effectiveWatermarkMode(settings, { logo: logoImg, text: markText });
  const logoWanted = settings.mode !== "text";
  const logoMissing = logoWanted && logoStatus === "yok";

  return (
    <form action={formAction} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Gizli alanlar — durum state'ten gelir, action FormData okur */}
      <input type="hidden" name="enabled" value={settings.enabled ? "true" : "false"} />
      <input type="hidden" name="mode" value={settings.mode} />
      <input type="hidden" name="position" value={settings.position} />
      <input type="hidden" name="opacity" value={String(settings.opacity)} />
      <input type="hidden" name="scale" value={String(settings.scale)} />
      <input type="hidden" name="marginPct" value={String(settings.marginPct ?? 3)} />
      <input type="hidden" name="text" value={settings.text ?? ""} />

      {/* --- Sol: ayarlar --- */}
      <div className="space-y-5">
        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-[16px] border border-line bg-canvas p-4">
          <span>
            <span className="block font-display font-bold text-ink-950">Filigran açık</span>
            <span className="mt-0.5 block text-xs text-text-muted">
              Açıkken bundan sonra yüklenen her fotoğrafa ofis damgası basılır.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            aria-label="Filigranı aç/kapat"
            onClick={() => patch({ enabled: !settings.enabled })}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
              settings.enabled ? "bg-mint-500" : "bg-ink-950/15"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-[var(--shadow-xs)] transition-all ${
                settings.enabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </label>

        <fieldset>
          <legend className="text-xs font-bold uppercase tracking-[0.08em] text-text-faint">Damga türü</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {WATERMARK_MODES.map((m: WatermarkMode) => (
              <button
                key={m}
                type="button"
                onClick={() => patch({ mode: m })}
                className={`rounded-[10px] border px-3.5 py-2 text-sm font-semibold transition ${
                  settings.mode === m
                    ? "border-brand-400 bg-brand-600/10 text-brand-600"
                    : "border-line bg-canvas text-text-muted hover:border-brand-300"
                }`}
              >
                {WATERMARK_MODE_LABEL[m]}
              </button>
            ))}
          </div>
          {logoMissing ? (
            <p className="mt-2 flex items-start gap-1.5 rounded-[10px] bg-amber-400/12 px-3 py-2 text-xs font-medium text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {logoUrl
                ? "Ofis logosu tarayıcıya yüklenemedi (erişim/CORS). Filigran otomatik olarak METİN moduna düşer."
                : "Ofis logosu yüklü değil — Ayarlar › Marka & kimlik bölümünden logo yükleyin. Şimdilik metin basılır."}
            </p>
          ) : null}
        </fieldset>

        <fieldset>
          <legend className="text-xs font-bold uppercase tracking-[0.08em] text-text-faint">Konum</legend>
          <div className="mt-2 grid w-[168px] grid-cols-3 gap-1.5 rounded-[12px] border border-line bg-canvas p-1.5">
            {POSITION_GRID.map((p, i) =>
              p ? (
                <button
                  key={p}
                  type="button"
                  title={WATERMARK_POSITION_LABEL[p]}
                  aria-label={WATERMARK_POSITION_LABEL[p]}
                  aria-pressed={settings.position === p}
                  onClick={() => patch({ position: p })}
                  className={`grid h-12 place-items-center rounded-[9px] border transition ${
                    settings.position === p
                      ? "border-brand-400 bg-brand-600/12"
                      : "border-line-strong/40 bg-surface hover:border-brand-300"
                  }`}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-[3px] ${
                      settings.position === p ? "bg-brand-600" : "bg-ink-950/20"
                    }`}
                  />
                </button>
              ) : (
                <span key={`bos-${i}`} className="h-12" />
              ),
            )}
          </div>
          <p className="mt-1.5 text-xs text-text-muted">{WATERMARK_POSITION_LABEL[settings.position]}</p>
        </fieldset>

        <div className="space-y-4">
          <label className="block">
            <span className="flex items-center justify-between text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
              Şeffaflık <span className="font-display text-sm normal-case tracking-normal text-ink-950">%{settings.opacity}</span>
            </span>
            <input
              type="range"
              min={WATERMARK_LIMITS.opacity.min}
              max={WATERMARK_LIMITS.opacity.max}
              step={1}
              value={settings.opacity}
              onChange={(e) => patch({ opacity: Number(e.target.value) })}
              className="mt-2 w-full accent-[var(--brand-600)]"
            />
          </label>
          <label className="block">
            <span className="flex items-center justify-between text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
              Boyut <span className="font-display text-sm normal-case tracking-normal text-ink-950">genişliğin %{settings.scale}&apos;i</span>
            </span>
            <input
              type="range"
              min={WATERMARK_LIMITS.scale.min}
              max={WATERMARK_LIMITS.scale.max}
              step={1}
              value={settings.scale}
              onChange={(e) => patch({ scale: Number(e.target.value) })}
              className="mt-2 w-full accent-[var(--brand-600)]"
            />
          </label>
          <label className="block">
            <span className="flex items-center justify-between text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
              Kenar boşluğu <span className="font-display text-sm normal-case tracking-normal text-ink-950">%{settings.marginPct ?? 3}</span>
            </span>
            <input
              type="range"
              min={WATERMARK_LIMITS.marginPct.min}
              max={WATERMARK_LIMITS.marginPct.max}
              step={1}
              value={settings.marginPct ?? 3}
              onChange={(e) => patch({ marginPct: Number(e.target.value) })}
              className="mt-2 w-full accent-[var(--brand-600)]"
            />
          </label>
        </div>

        <label className="block text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
          Filigran metni
          <input
            value={settings.text ?? ""}
            onChange={(e) => setSettings((prev) => ({ ...prev, text: e.target.value.slice(0, 80) }))}
            placeholder={officeName || "Ofis adı"}
            maxLength={80}
            className="mt-2 block w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold normal-case tracking-normal text-ink-950 outline-none focus:border-brand-400"
          />
          <span className="mt-1 block text-[11px] font-medium normal-case tracking-normal text-text-muted">
            Boş bırakılırsa ofis adı kullanılır: <strong>{officeName || "—"}</strong>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button
            type="submit"
            disabled={pending}
            className="btn-shine inline-flex items-center gap-1.5 rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Ayarı kaydet
          </button>
          <button
            type="button"
            onClick={() => setSettings({ ...DEFAULT_WATERMARK, enabled: settings.enabled })}
            className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-text-muted transition hover:text-ink-950"
          >
            Varsayılana dön
          </button>
          {state.ok ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-mint-700">
              <Check className="h-4 w-4" /> Kaydedildi
            </span>
          ) : null}
          {state.error ? <span className="text-sm font-medium text-danger-500">{state.error}</span> : null}
        </div>
      </div>

      {/* --- Sağ: canlı önizleme --- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Droplets className="h-4 w-4 text-brand-600" /> Canlı önizleme
          </h3>
          <span className="rounded-full bg-ink-950/6 px-2.5 py-1 text-[11px] font-bold text-text-muted">
            {sceneImg ? "Gerçek ilan fotoğrafı" : "Örnek görsel"}
          </span>
        </div>
        <div className="overflow-hidden rounded-[16px] border border-line bg-canvas">
          <canvas
            ref={canvasRef}
            width={PREVIEW_W}
            height={PREVIEW_H}
            className="block h-auto w-full"
            aria-label="Filigran önizlemesi"
          />
        </div>
        <p className="flex items-start gap-1.5 text-xs text-text-muted">
          {settings.enabled ? (
            appliedMode ? (
              <>
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-600" />
                Uygulanacak damga: <strong>{WATERMARK_MODE_LABEL[appliedMode]}</strong>. Damga yalnızca
                yüklenen kopyaya basılır; bilgisayarınızdaki orijinal dosya değişmez.
              </>
            ) : (
              <>
                <ImageOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                Basılacak bir logo veya metin yok — logo yükleyin ya da filigran metni yazın.
              </>
            )
          ) : (
            <>
              <ImageOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" />
              Filigran kapalı. Fotoğraflar damgasız yüklenir.
            </>
          )}
        </p>
      </div>
    </form>
  );
}
