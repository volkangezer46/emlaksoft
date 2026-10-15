"use client";

import { useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/app/toast-provider";
import { listingSharePhotos, recordListingShare } from "@/app/actions/listing-share";
import { buildShareText } from "@/lib/listing-share";
import { RECORD_BAR_CELL } from "@/lib/record-actionbar";
import { cn } from "@/lib/utils";

type Variant = "hero" | "bar" | "row";

const VARIANT_CLASS: Record<Variant, string> = {
  hero: "h-auto gap-1.5 border border-white/15 bg-white/5 px-3.5 py-2 text-sm text-white hover:bg-white/10 hover:text-white touch:min-h-11 disabled:opacity-70",
  bar: `${RECORD_BAR_CELL} h-auto touch:h-auto [&>svg]:h-5 [&>svg]:w-5`,
  row: "h-8 gap-1.5 border border-hairline-strong bg-surface px-2.5 text-xs text-ink-950 hover:bg-canvas touch:min-h-11 disabled:opacity-70",
};

/**
 * Fotoğraflı yerel paylaşım (MP7, Web Share Level 2). Dokununca yayındaki ilanın filigranlı public fotoğrafları
 * (en çok 10, ~15 MB) hazırlanır ve telefonun paylaşım sayfası açılır: WhatsApp, Instagram, Telegram'a foto + metin
 * + vitrin bağlantısı tek seferde gider.
 *
 * Geri düşüşler: dosya paylaşımı yoksa yalnız metin+bağlantı paylaşılır; Web Share hiç yoksa metin panoya kopyalanır.
 * Hazırlık uzun sürüp tarayıcı kullanıcı etkileşimini düşürürse (Safari) dosyalar hazır tutulur ve "tekrar dokunun"
 * denir; ikinci dokunuş anında paylaşır. Ağır kod (indirme/küçültme) yalnız tıklamada yüklenir.
 * İYS: tanıtım iletisi ticari sayılır — not `title` ipucunda.
 */
export function ShareListingSheet({
  propertyIds,
  title,
  text,
  url,
  variant = "hero",
  label = "Paylaş",
  surface = "portfoy",
  note,
}: {
  propertyIds: string[];
  title: string;
  text?: string | null;
  url?: string | null;
  variant?: Variant;
  label?: string;
  surface?: "portfoy" | "sunum";
  note?: string | null;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const filesRef = useRef<File[] | null>(null);
  const shareText = buildShareText({ text, url });

  async function share(files: File[]) {
    const withFiles = files.length > 0 && typeof navigator.canShare === "function" && navigator.canShare({ files });
    if (typeof navigator.share === "function") {
      try {
        if (withFiles) await navigator.share({ files, title, text: shareText });
        else await navigator.share({ title, text: shareText, ...(url ? { url } : {}) });
        filesRef.current = null;
        setReady(false);
        void recordListingShare(propertyIds, { photos: withFiles ? files.length : 0, surface });
        if (!withFiles && files.length === 0) push("Paylaşılabilir fotoğraf yok; metin ve bağlantı paylaşıldı.", "ok");
        return;
      } catch (e) {
        const name = (e as DOMException | null)?.name;
        if (name === "AbortError") return;
        if (name === "NotAllowedError") {
          // Hazırlık sırasında kullanıcı etkileşimi düştü: dosyalar hazır, ikinci dokunuş anında paylaşır.
          filesRef.current = files;
          setReady(true);
          push("Fotoğraflar hazır. Paylaşmak için tekrar dokunun.", "ok");
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      push("Bu tarayıcı fotoğraf paylaşımını desteklemiyor; ilan metni ve bağlantı panoya kopyalandı.", "ok");
    } catch {
      push("Paylaşım bu tarayıcıda desteklenmiyor.", "err");
    }
  }

  async function onClick() {
    if (busy) return;
    if (ready && filesRef.current) {
      await share(filesRef.current);
      return;
    }
    setBusy(true);
    try {
      let files: File[] = [];
      const canShareFiles = typeof navigator.canShare === "function";
      if (canShareFiles) {
        const res = await listingSharePhotos(propertyIds);
        if (!res.ok) push(res.error, "err");
        else if (res.ids.length > 0) {
          const { prepareListingFiles } = await import("@/lib/share-listing-files");
          files = await prepareListingFiles(res.ids, title);
        }
      }
      await share(files);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      icon={Share2}
      loading={busy}
      onClick={onClick}
      title={note ?? "Fotoğraflar ve bağlantıyla paylaş"}
      className={cn(VARIANT_CLASS[variant], ready && variant !== "bar" && "ring-2 ring-mint-400")}
    >
      {busy ? "Hazırlanıyor…" : ready ? "Şimdi paylaş" : label}
    </Button>
  );
}
