"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Globe, MessageCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import { regenerateProjectShareLink, saveProjectShare } from "@/app/actions/project-sales";

/**
 * PF-04 — Proje paylaşım sayfası: galeri, konum, teslim tarihi ve müsait daire listesi tek bağlantıda. Varsayılan
 * kapalı; arama motorlarına kapalı (noindex). "Fiyatları göster" kapalıysa sayfa "Fiyat için arayın" der.
 * WhatsApp'ta kişi seçtiren paylaşım (ticari ileti: kişinin İYS izni olduğundan emin olun).
 */
export function ProjectShareCard({
  projectId,
  projectName,
  available,
  enabled: initialEnabled,
  showPrices: initialShowPrices,
  url: initialUrl,
  availableUnits,
  canEdit,
}: {
  projectId: string;
  projectName: string;
  available: boolean;
  enabled: boolean;
  showPrices: boolean;
  url: string | null;
  availableUnits: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [showPrices, setShowPrices] = useState(initialShowPrices);
  const [url, setUrl] = useState(initialUrl);

  const save = (next: { enabled: boolean; showPrices: boolean }) => {
    const prev = { enabled, showPrices };
    setEnabled(next.enabled);
    setShowPrices(next.showPrices);
    start(async () => {
      const res = await saveProjectShare(projectId, next);
      if (res.error) {
        setEnabled(prev.enabled);
        setShowPrices(prev.showPrices);
        push(res.error, "err");
        return;
      }
      if (res.url) setUrl(res.url);
      push(next.enabled ? "Paylaşım sayfası açık" : "Paylaşım sayfası kapatıldı; link artık açılmaz", "ok");
      router.refresh();
    });
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      push("Link kopyalandı", "ok");
    } catch {
      push("Link kopyalanamadı; elle seçip kopyalayın", "err");
    }
  };

  const waHref = url
    ? `https://wa.me/?text=${encodeURIComponent(`${projectName} — müsait daireler ve güncel bilgiler: ${url}`)}`
    : null;

  return (
    <section
      aria-labelledby="proje-paylasim"
      className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="proje-paylasim" className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
            <Globe className="h-4 w-4 text-brand-600" /> Paylaşım sayfası
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Galeri, konum ve {availableUnits} müsait daire tek bağlantıda. Arama motorlarına kapalıdır.
          </p>
        </div>
        {available && canEdit ? (
          <Switch
            checked={enabled}
            disabled={pending}
            onCheckedChange={(v) => save({ enabled: v, showPrices })}
            aria-label="Paylaşım sayfası"
          />
        ) : null}
      </div>

      {!available ? (
        <p className="mt-3 rounded-[var(--radius-control)] bg-amber-400/12 px-3 py-2 text-sm font-medium text-amber-700">
          Bu özellik bu ortamda henüz etkin değil (veritabanı güncellemesi bekleniyor).
        </p>
      ) : enabled && url ? (
        <div className="motion-enter mt-4 space-y-3">
          <div className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs">
            <span className="min-w-0 flex-1 truncate font-mono text-text-muted">{url}</span>
            <Button variant="ghost" size="xs" onClick={copy} aria-label="Linki kopyala">
              <Copy /> Kopyala
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring press inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-xs font-bold text-ink-950 transition hover:border-brand-300 touch:min-h-11"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Sayfayı aç
            </a>
            {waHref ? (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                title="Ticari ileti: alıcıyı WhatsApp'ta siz seçersiniz; kişinin İYS izni olduğundan emin olun."
                className="focus-ring press inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-mint-500/30 bg-mint-500/10 px-3 text-xs font-bold text-mint-700 transition hover:bg-mint-500/20 touch:min-h-11"
              >
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp&apos;ta paylaş
              </a>
            ) : null}
            {canEdit ? (
              <ConfirmDialog
                title="Link yenilensin mi?"
                description="Daha önce gönderdiğiniz link çalışmaz olur; yeni linki yeniden paylaşmanız gerekir."
                confirmLabel="Linki yenile"
                onConfirm={async () => {
                  const res = await regenerateProjectShareLink(projectId);
                  if (res.error) push(res.error, "err");
                  else {
                    if (res.url) setUrl(res.url);
                    push("Yeni link hazır", "ok");
                    router.refresh();
                  }
                }}
                trigger={
                  <Button variant="ghost" size="sm">
                    <RefreshCw /> Linki yenile
                  </Button>
                }
              />
            ) : null}
          </div>
          {canEdit ? (
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-950">Fiyatları göster</span>
                <span className="block text-xs text-text-muted">Kapalıyken daire satırında &quot;Fiyat için arayın&quot; yazar.</span>
              </span>
              <Switch
                checked={showPrices}
                disabled={pending}
                onCheckedChange={(v) => save({ enabled, showPrices: v })}
                aria-label="Fiyatları göster"
              />
            </label>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-text-muted">
          {canEdit ? "Açtığınızda müşteriye gönderebileceğiniz bir link oluşur." : "Paylaşım sayfası kapalı."}
        </p>
      )}
    </section>
  );
}
