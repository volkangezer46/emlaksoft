"use client";

import { useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import Image from "next/image";
import { AlertCircle, Camera, Check, Copy, Droplets, Film, GripVertical, ImagePlus, Link2, Loader2, RefreshCw, ScanText, Sparkles, Star, Trash2, Upload, View, X } from "lucide-react";
import {
  addPropertyMediaUrl,
  applyDocFieldsToProperty,
  bulkDeletePropertyMedia,
  deletePropertyMedia,
  ocrPropertyMediaDocument,
  reorderPropertyMedia,
  setCoverPropertyMedia,
  uploadPropertyMedia,
  type MediaResult,
  type PropertyDocFields,
} from "@/app/actions/property-media";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DEFAULT_WATERMARK, type WatermarkSettings } from "@/lib/watermark";
import { applyWatermarkToFile, loadWatermarkLogo } from "@/lib/watermark-canvas";

export type MediaItem = {
  id: string;
  kind: "image" | "video" | "tour";
  storage_path: string | null;
  external_url: string | null;
  is_cover: boolean;
  has_watermark?: boolean | null;
  sort_order?: number | null;
};

/** OCR sonuç dialogundaki düzenlenebilir alanlar (C8). */
const OCR_FIELDS: { key: keyof PropertyDocFields; label: string }[] = [
  { key: "ada", label: "Ada" },
  { key: "parsel", label: "Parsel" },
  { key: "bagimsiz_bolum", label: "Bağımsız bölüm" },
  { key: "il", label: "İl" },
  { key: "ilce", label: "İlçe" },
  { key: "mahalle", label: "Mahalle" },
  { key: "yuzolcumu_m2", label: "Yüzölçümü (m²)" },
  { key: "malik_ad_soyad", label: "Malik ad soyad" },
  { key: "tapu_tarihi", label: "Tapu tarihi" },
];

const GUVEN_STYLE: Record<string, string> = {
  "yüksek": "bg-mint-500/15 text-mint-700",
  "orta": "bg-amber-400/20 text-amber-700",
  "düşük": "bg-danger-500/10 text-danger-500",
};

// ---------------------------------------------------------------------------
// Yükleme kuyruğu + istemci tarafı yeniden boyutlandırma (saha çekimi deneyimi)
// ---------------------------------------------------------------------------

type UploadStatus = "queued" | "stamping" | "uploading" | "done" | "error";

type QueueItem = {
  key: string;
  file: File;
  name: string;
  status: UploadStatus;
  error?: string;
};

/** Uzun kenar bu değeri aşan görseller yüklemeden önce küçültülür (süre + kota). */
const MAX_UPLOAD_DIM = 2560;
/** Yalnızca statik görseller küçültülür — GIF animasyonu canvas'ta kaybolur. */
const RESIZABLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Büyük görseli canvas ile maks 2560px uzun kenara indirir.
 * EXIF yönü kaybolmasın diye `createImageBitmap(..., { imageOrientation: "from-image" })`
 * kullanılır; desteklemeyen/başarısız tarayıcıda ORİJİNAL dosya döner
 * (sunucu limiti 15 MB zaten koruyor) — asla yanlış yönde küçültme yapılmaz.
 */
async function resizeImageForUpload(original: File): Promise<File> {
  if (!RESIZABLE_TYPES.includes(original.type)) return original;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(original, { imageOrientation: "from-image" });
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= MAX_UPLOAD_DIM) return original;

    const scale = MAX_UPLOAD_DIM / longEdge;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(bitmap, 0, 0, w, h);

    // PNG şeffaflığı korunur; JPEG/WebP çıktısı JPEG'e sıkıştırılır.
    const outType = original.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outType, 0.85),
    );
    // Küçültme kazanç sağlamadıysa orijinali gönder.
    if (!blob || blob.size >= original.size) return original;

    const name =
      outType === "image/jpeg" ? original.name.replace(/\.[^.]+$/, "") + ".jpg" : original.name;
    return new File([blob], name, { type: outType });
  } catch {
    return original;
  } finally {
    bitmap?.close();
  }
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  queued: "Kuyrukta",
  stamping: "Filigran basılıyor…",
  uploading: "Yükleniyor…",
  done: "Yüklendi",
  error: "Hata",
};

export function PropertyMediaManager({
  propertyId,
  media,
  canEdit,
  watermark = DEFAULT_WATERMARK,
  officeName = "",
  logoUrl = null,
}: {
  propertyId: string;
  media: MediaItem[];
  canEdit: boolean;
  /** Ofis filigran ayarı (Ayarlar › Fotoğraf filigranı) */
  watermark?: WatermarkSettings;
  officeName?: string;
  logoUrl?: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const keySeq = useRef(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  // Son parti kameradan mı geldi? → yükleme bitince "Bir daha çek" göster (art arda çekim akışı)
  const [lastFromCamera, setLastFromCamera] = useState(false);
  const [, startTransition] = useTransition();

  // Filigran logosu bir kez yüklenip önbelleğe alınır (20 fotoğrafta 20 istek olmasın).
  // Promise saklanır: art arda yüklemelerde ikinci çağrı aynı sonucu bekler.
  const logoPromiseRef = useRef<Promise<HTMLImageElement | null> | null>(null);
  function getLogo() {
    if (!logoPromiseRef.current) logoPromiseRef.current = loadWatermarkLogo(logoUrl);
    return logoPromiseRef.current;
  }

  const uploading = queue.some(
    (q) => q.status === "queued" || q.status === "uploading" || q.status === "stamping",
  );

  function patchQueue(key: string, patch: Partial<QueueItem>) {
    setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  }

  /** Tek dosyayı (gerekirse küçülterek + filigranlayarak) yükler; kuyruğa durumunu işler. */
  async function uploadOne(item: QueueItem) {
    patchQueue(item.key, { status: "uploading", error: undefined });
    try {
      const resized = await resizeImageForUpload(item.file);
      // Filigran boyutlandırmadan SONRA basılır: damga son çözünürlüğe göre
      // ölçeklenir, küçültme damgayı bulanıklaştırmaz.
      let file = resized;
      let stamped = false;
      if (watermark.enabled) {
        patchQueue(item.key, { status: "stamping" });
        const logo = watermark.mode === "text" ? null : await getLogo();
        const res = await applyWatermarkToFile(resized, watermark, {
          logo,
          text: (watermark.text || officeName || "").trim(),
        });
        file = res.file;
        stamped = res.applied;
        patchQueue(item.key, { status: "uploading" });
      }
      const fd = new FormData();
      fd.set("property_id", propertyId);
      fd.set("file", file);
      fd.set("has_watermark", stamped ? "1" : "0");
      const r = await uploadPropertyMedia(fd);
      if (r.error) {
        patchQueue(item.key, { status: "error", error: r.error });
      } else {
        patchQueue(item.key, { status: "done" });
      }
    } catch {
      patchQueue(item.key, { status: "error", error: "Yükleme başarısız — bağlantıyı kontrol edin." });
    }
  }

  /** Seçilen dosyaları kuyruğa ekler ve SIRAYLA yükler (ilerleme satırları için). */
  async function enqueueFiles(files: File[], fromCamera: boolean) {
    if (files.length === 0) return;
    setLastFromCamera(fromCamera);
    const items: QueueItem[] = files.map((file) => ({
      key: `q${++keySeq.current}`,
      file,
      name: file.name || "fotoğraf.jpg",
      status: "queued",
    }));
    // Önceki partinin biten satırları temizlenir, hatalılar yeniden dene için kalır
    setQueue((prev) => [
      ...prev.filter((q) => q.status === "error" || q.status === "uploading" || q.status === "stamping"),
      ...items,
    ]);
    for (const item of items) {
      await uploadOne(item);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>, fromCamera: boolean) {
    const files = Array.from(e.target.files ?? []);
    // Aynı dosya tekrar seçilebilsin / kamera art arda çekebilsin diye input hemen sıfırlanır
    e.target.value = "";
    void enqueueFiles(files, fromCamera);
  }

  function retryItem(key: string) {
    const item = queue.find((q) => q.key === key);
    if (!item || uploading) return;
    void uploadOne(item);
  }

  // C8: Belge OCR — "AI ile oku"
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrBusyId, setOcrBusyId] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrValues, setOcrValues] = useState<Record<string, string>>({});
  const [ocrGuven, setOcrGuven] = useState<string | null>(null);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [ocrPending, startOcr] = useTransition();
  const [applyPending, startApply] = useTransition();

  function runOcr(mediaId: string) {
    setOcrBusyId(mediaId);
    setOcrOpen(true);
    setOcrError(null);
    setOcrValues({});
    setOcrGuven(null);
    setOcrNote(null);
    setApplyMsg(null);
    setApplyErr(null);
    setCopied(false);
    startOcr(async () => {
      const r = await ocrPropertyMediaDocument(mediaId);
      setOcrBusyId(null);
      if (r.error || !r.fields) {
        setOcrError(r.error ?? "Belge okunamadı.");
        return;
      }
      const vals: Record<string, string> = {};
      for (const f of OCR_FIELDS) {
        const v = r.fields[f.key];
        vals[f.key] = v == null ? "" : String(v);
      }
      setOcrValues(vals);
      setOcrGuven(r.guven ?? null);
      setOcrNote(r.note ?? null);
    });
  }

  function applyOcr() {
    setApplyErr(null);
    setApplyMsg(null);
    const sqmNum = Number(String(ocrValues.yuzolcumu_m2 ?? "").replace(",", "."));
    const payload = {
      ada: ocrValues.ada?.trim() || null,
      parsel: ocrValues.parsel?.trim() || null,
      bagimsiz_bolum: ocrValues.bagimsiz_bolum?.trim() || null,
      il: ocrValues.il?.trim() || null,
      ilce: ocrValues.ilce?.trim() || null,
      mahalle: ocrValues.mahalle?.trim() || null,
      yuzolcumu_m2: Number.isFinite(sqmNum) && sqmNum > 0 ? sqmNum : null,
      malik_ad_soyad: ocrValues.malik_ad_soyad?.trim() || null,
      tapu_tarihi: ocrValues.tapu_tarihi?.trim() || null,
    };
    startApply(async () => {
      const r = await applyDocFieldsToProperty(propertyId, payload);
      if (r.error) {
        setApplyErr(r.error);
        return;
      }
      const parts: string[] = [];
      if (r.applied?.length) parts.push(`Güncellenen alanlar: ${r.applied.join(", ")}`);
      if (r.noted?.length) parts.push(`İç notlara eklendi: ${r.noted.join(", ")}`);
      setApplyMsg(parts.join(" · ") || "Uygulandı.");
    });
  }

  async function copyOcr() {
    const lines = OCR_FIELDS.filter((f) => (ocrValues[f.key] ?? "").trim())
      .map((f) => `${f.label}: ${ocrValues[f.key].trim()}`);
    if (ocrGuven) lines.push(`Güven: ${ocrGuven}`);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* pano erişimi reddedildi — sessiz geç */
    }
  }

  const serverImages = media.filter((m) => m.kind === "image");
  const links = media.filter((m) => m.kind !== "image");
  const imageKey = serverImages.map((m) => m.id).join(",");

  // ---------------------------------------------------------------------
  // Sürükle-bırak sıralama (anlaşma tahtasıyla AYNI teknik: HTML5 native
  // draggable + dataTransfer; ek paket yok). `order` yalnızca kullanıcı
  // sürüklediğinde dolar; sunucu listesi değişince (kaydedildi/silindi)
  // sıfırlanır ve tek doğruluk kaynağı yine sunucu olur.
  // ---------------------------------------------------------------------
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  const byId = new Map(serverImages.map((m) => [m.id, m]));
  const images = order
    ? [
        ...order.map((id) => byId.get(id)).filter((m): m is MediaItem => Boolean(m)),
        ...serverImages.filter((m) => !order.includes(m.id)),
      ]
    : serverImages;

  /** Sürüklenen görseli hedefin yerine taşır (canlı önizleme). */
  function moveOver(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const current = images.map((m) => m.id);
    const from = current.indexOf(dragId);
    const to = current.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    // Çıkarma sonrası hedefin indeksi kayabilir → yeniden bulunur.
    // Aşağı sürüklerken hedefin ARDINA, yukarı sürüklerken ÖNÜNE bırakılır.
    const t = next.indexOf(targetId);
    next.splice(from < to ? t + 1 : t, 0, moved);
    setOrder(next);
  }

  /** Bırakınca sırayı kalıcı yazar (video/tur bağlantıları listenin sonuna alınır). */
  function commitOrder() {
    // onDrop + onDragEnd arka arkaya tetiklenir; ikinci çağrı sessizce düşer.
    if (!dragId) return;
    const ids = images.map((m) => m.id);
    const same = ids.every((id, i) => serverImages[i]?.id === id);
    setDragId(null);
    if (same) return;
    setSavingOrder(true);
    setOrderError(null);
    startTransition(async () => {
      const r = await reorderPropertyMedia(propertyId, [...ids, ...links.map((l) => l.id)]);
      setSavingOrder(false);
      if (r.error) {
        setOrderError(r.error);
        setOrder(null); // başarısızsa sunucu sırasına geri dön
      }
    });
  }

  // ---------------------------------------------------------------------
  // Çoklu seçim + toplu işlemler
  // ---------------------------------------------------------------------
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Sunucu listesi değişince (yükleme/silme/sıra kaydı) yerel sıra ve seçim
  // sıfırlanır. useEffect DEĞİL, render sırasında ayarlama: React'in önerdiği
  // "prop değişince state türet" deseni (fazladan render turu yok).
  const [syncedKey, setSyncedKey] = useState(imageKey);
  if (syncedKey !== imageKey) {
    setSyncedKey(imageKey);
    setOrder(null);
    const alive = new Set(serverImages.map((m) => m.id));
    setSelected((prev) => prev.filter((id) => alive.has(id)));
  }

  const selectedSet = new Set(selected);
  const allSelected = images.length > 0 && selected.length === images.length;

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function bulkDelete() {
    const ids = [...selected];
    setBulkError(null);
    startTransition(async () => {
      const r = await bulkDeletePropertyMedia(propertyId, ids);
      if (r.error) setBulkError(r.error);
      else setSelected([]);
    });
  }

  function makeCover(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("property_id", propertyId);
    startTransition(() => setCoverPropertyMedia(fd));
  }

  const unstamped = images.filter((m) => !m.has_watermark).length;

  const [urlState, urlAction, urlPending] = useActionState<MediaResult, FormData>(
    addPropertyMediaUrl,
    {},
  );

  return (
    <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <ImagePlus className="h-4 w-4 text-brand-600" /> Medya galerisi
          </h2>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
            {images.length} fotoğraf · {links.length} video/tur — paylaşım sayfasında gösterilir
            {canEdit ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  watermark.enabled ? "bg-mint-500/15 text-mint-700" : "bg-ink-950/6 text-text-muted"
                }`}
                title={
                  watermark.enabled
                    ? "Yüklenen fotoğraflara ofis filigranı basılır (Ayarlar › Fotoğraf filigranı)."
                    : "Filigran kapalı — Ayarlar › Fotoğraf filigranı bölümünden açabilirsiniz."
                }
              >
                <Droplets className="h-3 w-3" /> Filigran {watermark.enabled ? "açık" : "kapalı"}
              </span>
            ) : null}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => onFileChange(e, false)}
            />
            {/* Saha çekimi: arka kamerayı doğrudan açar. UA yerine CSS ile yalnız
                dokunmatik cihazda görünür (hover-action deseniyle aynı yaklaşım). */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onFileChange(e, true)}
            />
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={uploading}
              className="hidden items-center gap-1.5 rounded-[10px] bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 [@media(hover:none)]:inline-flex"
            >
              <Camera className="h-4 w-4" /> Kamera ile çek
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="btn-shine inline-flex items-center gap-1.5 rounded-[10px] bg-ink-950 px-3.5 py-2 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Fotoğraf yükle
            </button>
          </div>
        ) : null}
      </div>

      <div className="p-5">
        {queue.length > 0 ? (
          <div className="mb-4 space-y-1.5">
            {queue.map((q) => (
              <div
                key={q.key}
                className="flex items-center gap-2 rounded-[10px] border border-line bg-canvas px-3 py-2 text-xs"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center">
                  {q.status === "uploading" || q.status === "stamping" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />
                  ) : q.status === "done" ? (
                    <Check className="h-3.5 w-3.5 text-mint-600" />
                  ) : q.status === "error" ? (
                    <AlertCircle className="h-3.5 w-3.5 text-danger-500" />
                  ) : (
                    <Upload className="h-3.5 w-3.5 text-text-faint" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold text-ink-950">{q.name}</span>
                <span
                  className={
                    q.status === "error"
                      ? "font-medium text-danger-500"
                      : q.status === "done"
                        ? "font-medium text-mint-700"
                        : "text-text-muted"
                  }
                >
                  {q.status === "error" ? q.error ?? STATUS_LABEL.error : STATUS_LABEL[q.status]}
                </span>
                {q.status === "error" ? (
                  <button
                    type="button"
                    onClick={() => retryItem(q.key)}
                    disabled={uploading}
                    className="inline-flex shrink-0 items-center gap-1 rounded-[8px] border border-line px-2 py-1 font-semibold text-ink-950 hover:bg-surface disabled:opacity-60"
                  >
                    <RefreshCw className="h-3 w-3" /> Yeniden dene
                  </button>
                ) : null}
              </div>
            ))}
            {!uploading ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {lastFromCamera && queue.some((q) => q.status === "done") ? (
                  <button
                    type="button"
                    onClick={() => cameraRef.current?.click()}
                    className="hidden items-center gap-1.5 rounded-[10px] bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700 [@media(hover:none)]:inline-flex"
                  >
                    <Camera className="h-4 w-4" /> Bir daha çek
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setQueue([])}
                  className="rounded-[10px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-ink-950"
                >
                  Listeyi temizle
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {images.length === 0 && links.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">
            Henüz medya yok. Fotoğraf yükleyin veya video/360° tur bağlantısı ekleyin.
          </p>
        ) : null}

        {images.length > 0 && canEdit ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-canvas px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-950">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? [] : images.map((m) => m.id))}
                className="h-4 w-4 accent-[var(--brand-600)]"
              />
              Tümünü seç
            </label>
            <span className="text-xs text-text-muted">
              {selected.length > 0 ? `${selected.length} görsel seçili` : "Sıralamak için sürükleyip bırakın"}
            </span>
            <span className="flex-1" />
            {selected.length === 1 && !byId.get(selected[0])?.is_cover ? (
              <button
                type="button"
                onClick={() => makeCover(selected[0])}
                className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950 hover:border-brand-300"
              >
                <Star className="h-3.5 w-3.5 text-amber-500" /> Kapak yap
              </button>
            ) : null}
            {selected.length > 0 ? (
              <ConfirmDialog
                trigger={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-[9px] border border-danger-500/30 bg-danger-500/10 px-3 py-1.5 text-xs font-semibold text-danger-500 hover:bg-danger-500/15"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Seçilenleri sil ({selected.length})
                  </button>
                }
                title="Seçili görseller silinsin mi?"
                description={`${selected.length} görsel kalıcı olarak silinir. Kapak silinirse kalan ilk görsel otomatik kapak olur.`}
                confirmLabel="Kalıcı sil"
                onConfirm={bulkDelete}
              />
            ) : null}
            {savingOrder ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sıra kaydediliyor…
              </span>
            ) : null}
          </div>
        ) : null}

        {orderError || bulkError ? (
          <p className="mb-3 text-sm font-medium text-danger-500">{orderError ?? bulkError}</p>
        ) : null}

        {images.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((m, i) => (
              <div
                key={m.id}
                draggable={canEdit}
                onDragStart={(e) => {
                  if (!canEdit) return;
                  e.dataTransfer.setData("text/plain", m.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragId(m.id);
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  moveOver(m.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  commitOrder();
                }}
                onDragEnd={commitOrder}
                className={`group relative aspect-[4/3] overflow-hidden rounded-[14px] border bg-canvas transition ${
                  dragId === m.id
                    ? "border-brand-300 opacity-40"
                    : selectedSet.has(m.id)
                      ? "border-brand-400 ring-2 ring-brand-400/35"
                      : "border-line"
                } ${canEdit ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
                <Image
                  src={`/api/property-media/${m.id}`}
                  alt="Portföy görseli"
                  fill
                  sizes="(max-width: 640px) 50vw, 25vw"
                  className="object-cover"
                  unoptimized
                  draggable={false}
                />
                {canEdit ? (
                  <>
                    <label className="absolute left-2 top-2 z-10 grid h-7 w-7 cursor-pointer place-items-center rounded-[8px] bg-ink-950/55 backdrop-blur-sm">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(m.id)}
                        onChange={() => toggleSelect(m.id)}
                        aria-label="Görseli seç"
                        className="h-4 w-4 accent-[var(--brand-600)]"
                      />
                    </label>
                    <span className="hover-action absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-[8px] bg-ink-950/55 text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100">
                      <GripVertical className="h-3.5 w-3.5" />
                    </span>
                  </>
                ) : null}
                {/* Sıra numarası — sürükleyerek değiştirilen düzen görünür olsun */}
                <span className="absolute bottom-2 left-2 z-10 rounded-full bg-ink-950/60 px-2 py-0.5 text-[11px] font-bold text-white backdrop-blur-sm">
                  {i + 1}
                </span>
                <div className="absolute left-1/2 top-2 z-10 flex -translate-x-1/2 flex-wrap justify-center gap-1">
                  {m.is_cover ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-ink-950/80 px-2 py-0.5 text-[11px] font-bold text-white">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Kapak
                    </span>
                  ) : null}
                  {canEdit && !m.has_watermark ? (
                    <span
                      title="Bu görsel filigransız yüklendi. Ayar değişse bile eski görseller yeniden damgalanmaz — yeniden yükleyerek damgalayabilirsiniz."
                      className="inline-flex items-center gap-1 rounded-full bg-amber-400/85 px-2 py-0.5 text-[11px] font-bold text-ink-950"
                    >
                      <Droplets className="h-3 w-3" /> Filigran yok
                    </span>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="hover-action absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-ink-950/80 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      title="AI ile oku (tapu/yetki belgesi)"
                      disabled={ocrPending}
                      onClick={() => runOcr(m.id)}
                      className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[8px] bg-white/90 text-brand-600 hover:bg-white disabled:opacity-60"
                    >
                      {ocrBusyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanText className="h-3.5 w-3.5" />}
                    </button>
                    {!m.is_cover ? (
                      <button
                        type="button"
                        title="Kapak yap"
                        onClick={() => makeCover(m.id)}
                        className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[8px] bg-white/90 text-ink-950 hover:bg-white"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <ConfirmDialog
                      trigger={
                        <button
                          type="button"
                          title="Sil"
                          className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[8px] bg-danger-500 text-white hover:bg-danger-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      }
                      title="Görsel silinsin mi?"
                      description="Bu görsel kalıcı olarak silinir."
                      confirmLabel="Sil"
                      formAction={deletePropertyMedia}
                      hiddenFields={{ id: m.id, property_id: propertyId }}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {canEdit && images.length > 0 && unstamped > 0 && watermark.enabled ? (
          <p className="mt-2 text-[11px] text-text-faint">
            {unstamped} görsel filigransız. Filigran yükleme anında basıldığı için eski görseller
            geriye dönük damgalanmaz — istersen o fotoğrafları silip yeniden yükleyebilirsin.
          </p>
        ) : null}

        {links.length > 0 ? (
          <div className="mt-4 space-y-2">
            {links.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-[12px] border border-line bg-canvas px-3 py-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-brand-600/10 text-brand-600">
                  {m.kind === "tour" ? <View className="h-4 w-4" /> : <Film className="h-4 w-4" />}
                </span>
                <a
                  href={m.external_url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-600"
                >
                  {m.kind === "tour" ? "360° Sanal tur" : "Video"} · {m.external_url}
                </a>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("id", m.id);
                      fd.set("property_id", propertyId);
                      startTransition(() => deletePropertyMedia(fd));
                    }}
                    className="grid h-7 w-7 min-h-9 min-w-9 shrink-0 place-items-center rounded-[8px] border border-line text-danger-500 hover:border-danger-500/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {canEdit ? (
          <form action={urlAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
            <input type="hidden" name="property_id" value={propertyId} />
            <label className="text-xs font-medium text-text-muted">
              Tür
              <select name="kind" defaultValue="video" className="mt-1.5 block rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold outline-none focus:border-brand-400">
                <option value="video">Video</option>
                <option value="tour">360° Sanal tur</option>
              </select>
            </label>
            <label className="min-w-[220px] flex-1 text-xs font-medium text-text-muted">
              Bağlantı (YouTube, Matterport, Kuula vb.)
              <div className="mt-1.5 flex items-center gap-1.5 rounded-[10px] border border-line bg-canvas px-3">
                <Link2 className="h-4 w-4 text-text-faint" />
                <input
                  name="external_url"
                  placeholder="https://..."
                  className="w-full bg-transparent py-2.5 text-sm outline-none"
                />
              </div>
            </label>
            <button
              type="submit"
              disabled={urlPending}
              className="rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-60"
            >
              {urlPending ? "Ekleniyor…" : "Bağlantı ekle"}
            </button>
            {urlState.error ? <p className="w-full text-sm font-medium text-danger-500">{urlState.error}</p> : null}
          </form>
        ) : null}
      </div>

      {/* C8: Belge OCR sonuç dialogu */}
      {ocrOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setOcrOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-[20px] border border-line bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 font-display font-bold text-ink-950">
                  <Sparkles className="h-4 w-4 text-brand-600" /> Belgeden okunan bilgiler
                </h3>
                <p className="mt-0.5 text-xs text-text-muted">
                  AI çıktısıdır, hata içerebilir — uygulamadan önce kontrol edip düzeltin. Bulunamayan alanlar boş bırakılır.
                </p>
              </div>
              <button
                type="button"
                aria-label="Kapat"
                onClick={() => setOcrOpen(false)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-line text-text-muted hover:text-ink-950"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {ocrPending ? (
              <div className="flex items-center gap-2 py-10 text-sm text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> Belge okunuyor…
              </div>
            ) : ocrError ? (
              <p className="py-6 text-sm font-medium text-danger-500">{ocrError}</p>
            ) : (
              <>
                {ocrGuven ? (
                  <p className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-bold ${GUVEN_STYLE[ocrGuven] ?? "bg-ink-950/6 text-text-muted"}`}>
                      Güven: {ocrGuven}
                    </span>
                    {ocrNote ? <span className="text-text-muted">{ocrNote}</span> : null}
                  </p>
                ) : null}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {OCR_FIELDS.map((f) => (
                    <label key={f.key} className="text-xs font-medium text-text-muted">
                      {f.label}
                      <input
                        value={ocrValues[f.key] ?? ""}
                        onChange={(e) => setOcrValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder="—"
                        className="mt-1.5 block w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm font-semibold text-ink-950 outline-none focus:border-brand-400"
                      />
                    </label>
                  ))}
                </div>

                <p className="mt-3 text-[11px] text-text-faint">
                  Ada, parsel ve yüzölçümü portföy alanlarına yazılır; diğer tapu bilgileri iç notlara
                  &quot;Tapu bilgileri (AI)&quot; bloğu olarak eklenir.
                </p>

                {applyErr ? <p className="mt-2 text-sm font-medium text-danger-500">{applyErr}</p> : null}
                {applyMsg ? <p className="mt-2 text-sm font-medium text-mint-700">{applyMsg}</p> : null}

                <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
                  <button
                    type="button"
                    onClick={copyOcr}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3.5 py-2 text-sm font-semibold text-ink-950 hover:bg-canvas"
                  >
                    {copied ? <Check className="h-4 w-4 text-mint-600" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Kopyalandı" : "Kopyala"}
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={applyOcr}
                      disabled={applyPending}
                      className="btn-shine inline-flex items-center gap-1.5 rounded-[10px] bg-ink-950 px-3.5 py-2 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-60"
                    >
                      {applyPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Portföye uygula
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
