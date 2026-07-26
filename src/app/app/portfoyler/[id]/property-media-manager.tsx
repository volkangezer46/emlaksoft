"use client";

import { useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import Image from "next/image";
import { AlertCircle, Camera, Check, Copy, Film, ImagePlus, Link2, Loader2, RefreshCw, ScanText, Sparkles, Star, Trash2, Upload, View, X } from "lucide-react";
import {
  addPropertyMediaUrl,
  applyDocFieldsToProperty,
  deletePropertyMedia,
  ocrPropertyMediaDocument,
  setCoverPropertyMedia,
  uploadPropertyMedia,
  type MediaResult,
  type PropertyDocFields,
} from "@/app/actions/property-media";

export type MediaItem = {
  id: string;
  kind: "image" | "video" | "tour";
  storage_path: string | null;
  external_url: string | null;
  is_cover: boolean;
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

type UploadStatus = "queued" | "uploading" | "done" | "error";

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
  uploading: "Yükleniyor…",
  done: "Yüklendi",
  error: "Hata",
};

export function PropertyMediaManager({
  propertyId,
  media,
  canEdit,
}: {
  propertyId: string;
  media: MediaItem[];
  canEdit: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const keySeq = useRef(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  // Son parti kameradan mı geldi? → yükleme bitince "Bir daha çek" göster (art arda çekim akışı)
  const [lastFromCamera, setLastFromCamera] = useState(false);
  const [, startTransition] = useTransition();

  const uploading = queue.some((q) => q.status === "queued" || q.status === "uploading");

  function patchQueue(key: string, patch: Partial<QueueItem>) {
    setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  }

  /** Tek dosyayı (gerekirse küçülterek) yükler; kuyruğa durumunu işler. */
  async function uploadOne(item: QueueItem) {
    patchQueue(item.key, { status: "uploading", error: undefined });
    try {
      const file = await resizeImageForUpload(item.file);
      const fd = new FormData();
      fd.set("property_id", propertyId);
      fd.set("file", file);
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
    setQueue((prev) => [...prev.filter((q) => q.status === "error" || q.status === "uploading"), ...items]);
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

  const images = media.filter((m) => m.kind === "image");
  const links = media.filter((m) => m.kind !== "image");

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
          <p className="text-xs text-text-muted">
            {images.length} fotoğraf · {links.length} video/tur — paylaşım sayfasında gösterilir
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
                  {q.status === "uploading" ? (
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

        {images.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((m) => (
              <div key={m.id} className="group relative aspect-[4/3] overflow-hidden rounded-[14px] border border-line bg-canvas">
                <Image
                  src={`/api/property-media/${m.id}`}
                  alt="Portföy görseli"
                  fill
                  sizes="(max-width: 640px) 50vw, 25vw"
                  className="object-cover"
                  unoptimized
                />
                {m.is_cover ? (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-ink-950/80 px-2 py-0.5 text-[11px] font-bold text-white">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Kapak
                  </span>
                ) : null}
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
                        onClick={() => {
                          const fd = new FormData();
                          fd.set("id", m.id);
                          fd.set("property_id", propertyId);
                          startTransition(() => setCoverPropertyMedia(fd));
                        }}
                        className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[8px] bg-white/90 text-ink-950 hover:bg-white"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      title="Sil"
                      onClick={() => {
                        if (!confirm("Görsel silinsin mi?")) return;
                        const fd = new FormData();
                        fd.set("id", m.id);
                        fd.set("property_id", propertyId);
                        startTransition(() => deletePropertyMedia(fd));
                      }}
                      className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[8px] bg-danger-500 text-white hover:bg-danger-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
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
