"use client";

import { Button } from "@/components/ui/button";
import { useId, useState, useTransition } from "react";
import { AlertTriangle, Copy, ExternalLink, Eye, Loader2, Monitor, Smartphone, Tablet } from "lucide-react";
import { createSiteContentPreviewLink } from "./preview-actions";

const WIDTHS = [
  { id: "desktop", label: "Masaüstü", px: 1280, icon: Monitor },
  { id: "tablet", label: "Tablet", px: 820, icon: Tablet },
  { id: "mobile", label: "Mobil", px: 390, icon: Smartphone },
] as const;
type WidthId = (typeof WIDTHS)[number]["id"];

const ttlLabel = (h: number) => (h % 24 === 0 ? (h === 24 ? "24 saat" : `${h / 24} gün`) : `${h} saat`);

/**
 * Gerçek önizleme: kayıtlı taslak, canlı ana sayfayla AYNI işlevle (renderHome), gerçek paket/deneme verisiyle ve
 * "TASLAK" şeridiyle /onizleme/ana-sayfa adresinde çizilir. Bağlantı imzalı ve sürelidir; taslak değişince geçersiz olur.
 * Kaydedilmemiş değişiklikler önizlemeye girmez (önce "Taslağı kaydet").
 */
export function RealPreview({ enabled, dirty, ttlOptions, defaultTtl }: { enabled: boolean; dirty: boolean; ttlOptions: readonly number[]; defaultTtl: number }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [width, setWidth] = useState<WidthId>("desktop");
  const [ttl, setTtl] = useState<number>(defaultTtl);
  const [shared, setShared] = useState<{ url: string; until: string; copied: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ttlId = useId();

  const open = () =>
    start(async () => {
      setErr(null);
      const res = await createSiteContentPreviewLink(defaultTtl);
      if (!res.ok) return setErr(res.error);
      setFrame(res.path);
    });

  const share = () =>
    start(async () => {
      setErr(null);
      const res = await createSiteContentPreviewLink(ttl);
      if (!res.ok) return setErr(res.error);
      const url = `${window.location.origin}${res.path}`;
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        copied = false;
      }
      const until = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(res.expiresAt));
      setShared({ url, until, copied });
    });

  const px = WIDTHS.find((w) => w.id === width)!.px;

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-label="Gerçek önizleme">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-extrabold text-ink-950">Gerçek önizleme</h2>
          <p className="text-xs text-text-muted">Kayıtlı taslak, ana sayfanın kendisiyle aynı düzende ve gerçek paket ile deneme bilgisiyle gösterilir.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary" size="sm" disabled={!enabled || pending} onClick={open}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />} Gerçek önizleme
          </Button>
          <label htmlFor={ttlId} className="sr-only">Paylaşım süresi</label>
          <select
            id={ttlId}
            className="focus-ring surface-sunken h-9 rounded-[var(--radius-control)] border border-hairline px-2 text-sm text-ink-950 disabled:opacity-60"
            disabled={!enabled}
            value={ttl}
            onChange={(e) => {
              const n = Number(e.target.value);
              setTtl(ttlOptions.includes(n) ? n : defaultTtl);
            }}
          >
            {ttlOptions.map((h) => <option key={h} value={h}>{ttlLabel(h)} geçerli</option>)}
          </select>
          <Button type="button" variant="outline" size="sm" disabled={!enabled || pending} onClick={share}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Bağlantıyı paylaş
          </Button>
        </div>
      </div>

      {!enabled ? (
        <p role="status" className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-amber-700">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Önizleme bağlantısı kapalı: sunucuda imza anahtarı (PLATFORM_SECRETS_KEY veya CRON_SECRET) tanımlı değil.
        </p>
      ) : dirty ? (
        <p role="status" className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-amber-700">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Kaydedilmemiş değişiklikler önizlemede görünmez; önce “Taslağı kaydet”. Kayıttan sonra eski bağlantılar geçersiz olur.
        </p>
      ) : null}
      {err ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-danger-500">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {err}
        </p>
      ) : null}
      {shared ? (
        <div role="status" className="mt-2 rounded-[var(--radius-card)] border border-line p-2 text-xs text-text-muted">
          <p className="font-semibold text-ink-950">{shared.copied ? "Bağlantı panoya kopyalandı." : "Bağlantıyı kopyalayın:"} {shared.until} tarihine kadar, taslak değişmedikçe oturum açmadan açılır; arama motorlarına kapalıdır.</p>
          <input readOnly aria-label="Paylaşılan önizleme bağlantısı" value={shared.url} onFocus={(e) => e.currentTarget.select()} className="mt-1 w-full truncate rounded border border-hairline bg-transparent px-2 py-1 font-mono text-xs" />
        </div>
      ) : null}

      {frame ? (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Önizleme genişliği">
            {WIDTHS.map((w) => (
              <Button key={w.id} type="button" variant="outline" size="sm" aria-pressed={width === w.id} onClick={() => setWidth(w.id)}>
                <w.icon className="h-3.5 w-3.5" aria-hidden="true" /> {w.label} ({w.px})
              </Button>
            ))}
            <a href={frame} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-700 underline">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Yeni sekmede aç
            </a>
          </div>
          <div className="overflow-auto rounded-[var(--radius-card)] border border-line bg-ink-950/5">
            <iframe title="Ana sayfa taslak önizlemesi" src={frame} style={{ width: px, height: 760 }} className="mx-auto block max-w-none border-0 bg-white" />
          </div>
        </div>
      ) : null}
    </section>
  );
}
