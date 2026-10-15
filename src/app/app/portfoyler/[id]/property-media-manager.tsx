"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useActionState } from "react";
import Image from "next/image";
import { AlertCircle, ArrowDownToLine, ArrowLeft, ArrowRight, Camera, Check, ChevronsLeft, ChevronsRight, Copy, Download, Droplets, FileLock2, Film, GripVertical, ImageIcon, ImagePlus, LayoutPanelTop, Link2, Loader2, LockKeyhole, RefreshCw, ScanText, Sparkles, Star, Tag, Trash2, Upload, View, X } from "lucide-react";
import {
  addPropertyMediaUrl,
  applyDocFieldsToProperty,
  bulkDeletePropertyMedia,
  deletePropertyMedia,
  finalizePropertyMediaUpload,
  ocrPropertyMediaDocument,
  preparePropertyMediaUpload,
  reorderPropertyMedia,
  setCoverPropertyMedia,
  setPropertyMediaDocument,
  updatePropertyMediaMeta,
  type MediaResult,
  type PropertyDocFields,
} from "@/app/actions/property-media";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Button, buttonClass } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FLOOR_PLAN_TAG, CAPTION_MAX, ROOM_TAGS, ROOM_TAG_LABEL, isFloorPlan, mediaAltText, mediaShortLabel } from "@/lib/media/room-tags";
import { uploadToDirectFileTarget } from "@/lib/direct-file-upload-client";
import { DEFAULT_WATERMARK, type WatermarkSettings } from "@/lib/watermark";
import { applyWatermarkToFile, loadWatermarkLogo } from "@/lib/watermark-canvas";
import { assessPhoto, suggestCover, type PhotoIssue } from "@/lib/field-capture/photo-quality";

export type MediaItem = {
  id: string;
  kind: "image" | "video" | "tour";
  storage_path: string | null;
  external_url: string | null;
  is_cover: boolean;
  has_watermark?: boolean | null;
  sort_order?: number | null;
  /** KVKK P0-9: belge (tapu, yetki belgesi...) — public yüzeylerde gösterilmez. Sunucu etkin değeri hesaplar. */
  is_document?: boolean | null;
  /** Yüklemede ölçülen piksel boyutu (eski kayıtta yok → kalite uyarısı üretilmez). */
  width?: number | null;
  height?: number | null;
  /** Oda etiketi (`kat_plani` = kat planı) ve açıklama; sütunlar yoksa (migration öncesi) gelmez. */
  room_tag?: string | null;
  caption?: string | null;
};

/** Yükleme türü: ilan fotoğrafı, kat planı (ayrı sekmede gösterilir) ya da belge (dışarıda gösterilmez). */
type UploadKind = "photo" | "floorplan" | "document";

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
  /** Yükleme türü "Belge" seçiliyken kuyruğa girdi (yeniden denemede de korunur). */
  asDocument: boolean;
  /** Yükleme türü "Kat planı" seçiliyken kuyruğa girdi (PNG çizim JPEG'e çevrilmez, kayıt kat planı etiketi alır). */
  asFloorPlan: boolean;
  /** Yüklenen son dosyanın ölçüsü ve kalite uyarısı (düşük çözünürlük / dikey / panorama). */
  dims?: { width: number; height: number };
  warning?: string | null;
};

/** Yüklenecek son dosyanın piksel boyutu (EXIF yönü uygulanmış). Ölçülemezse null — yükleme yine sürer. */
async function measureImage(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/")) return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return bitmap.width > 0 && bitmap.height > 0 ? { width: bitmap.width, height: bitmap.height } : null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

const ISSUE_BADGE: Record<PhotoIssue, string> = {
  low_resolution: "Düşük çözünürlük",
  portrait: "Dikey",
  panorama: "Çok geniş",
};

/** Uzun kenar bu değeri aşan görseller yüklemeden önce küçültülür (süre + kota; portal fotoğrafları için yeterli). */
const MAX_UPLOAD_DIM = 2048;
/** Aynı anda en çok bu kadar dosya yüklenir (sıralı yükleme 2 PNG'de ~3,2 sn sürüyordu). */
const UPLOAD_CONCURRENCY = 3;
/** Yalnızca statik görseller küçültülür — GIF animasyonu canvas'ta kaybolur. */
const RESIZABLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Tuvalde şeffaf piksel var mı (seyrek örnekleme; tam opak PNG fotoğraf JPEG'e çevrilebilir). */
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4 * 16) if (data[i] < 255) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Görseli istemcide hazırlar: uzun kenar 2048 px'i aşıyorsa canvas ile küçültür; şeffaflığı olmayan PNG
 * fotoğrafı JPEG'e (0,85) sıkıştırır (ekran görüntüsü/telefon PNG'leri MB'larca; yükleme süresini bu belirler).
 * EXIF yönü kaybolmasın diye `createImageBitmap(..., { imageOrientation: "from-image" })`
 * kullanılır; desteklemeyen/başarısız tarayıcıda ORİJİNAL dosya döner
 * (sunucu limiti 15 MB zaten koruyor) — asla yanlış yönde küçültme yapılmaz. Belgeler (tapu) olduğu gibi kalır.
 */
async function resizeImageForUpload(original: File, asDocument = false, keepPng = false): Promise<File> {
  if (asDocument || !RESIZABLE_TYPES.includes(original.type)) return original;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(original, { imageOrientation: "from-image" });
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const isPng = original.type === "image/png";
    // Kat planı çizgileri JPEG'de bulanıklaşır: PNG kat planı yalnız büyükse küçültülür, PNG kalır.
    if (longEdge <= MAX_UPLOAD_DIM && (!isPng || keepPng)) return original;

    const scale = longEdge > MAX_UPLOAD_DIM ? MAX_UPLOAD_DIM / longEdge : 1;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(bitmap, 0, 0, w, h);

    // Şeffaf PNG korunur; opak PNG ve JPEG/WebP çıktısı JPEG'e sıkıştırılır.
    const outType = isPng && (keepPng || hasTransparency(ctx, w, h)) ? "image/png" : "image/jpeg";
    if (outType === "image/png" && scale === 1) return original;
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
  documentFlagAvailable = true,
  metaAvailable = false,
  pendingFiles,
  onPendingQueued,
}: {
  /** Başka yerden gelen dosyalar (telefonun Paylaş menüsü, /app/paylas-al): kullanıcı dokununca kuyruğa girer. */
  pendingFiles?: File[];
  onPendingQueued?: () => void;
  propertyId: string;
  media: MediaItem[];
  canEdit: boolean;
  /** `property_media.is_document` sütunu var mı (migration öncesi işaret anahtarları gizlenir, ad kuralı geçerli). */
  documentFlagAvailable?: boolean;
  /** `property_media.room_tag` / `caption` sütunları var mı (migration öncesi etiket, açıklama ve kat planı gizlenir). */
  metaAvailable?: boolean;
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
  // Yükleme türü: Fotoğraf (paylaşımda gösterilir) / Belge (tapu, yetki belgesi — dışarıda gösterilmez)
  const [uploadKind, setUploadKind] = useState<UploadKind>("photo");
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
      const resized = await resizeImageForUpload(item.file, item.asDocument, item.asFloorPlan);
      // Filigran boyutlandırmadan SONRA basılır: damga son çözünürlüğe göre
      // ölçeklenir, küçültme damgayı bulanıklaştırmaz.
      let file = resized;
      let stamped = false;
      // Belgeye filigran basılmaz (okunurluk; zaten dışarıda gösterilmez).
      if (watermark.enabled && !item.asDocument) {
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
      // Kalite: yüklenen SON dosya ölçülür (belgede uyarı yok — okunurluk ayrı konu).
      const dims = await measureImage(file);
      const warning = dims && !item.asDocument && !item.asFloorPlan ? assessPhoto(dims).warning : null;
      if (dims) patchQueue(item.key, { dims, warning });
      const prepared = await preparePropertyMediaUpload({
        propertyId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        hasWatermark: stamped,
        isDocument: item.asDocument,
      });
      if (!prepared.ok) {
        patchQueue(item.key, { status: "error", error: prepared.error });
        return;
      }

      const uploaded = await uploadToDirectFileTarget(prepared.upload, file);
      if (!uploaded.ok) {
        patchQueue(item.key, { status: "error", error: uploaded.error });
        return;
      }

      const finalized = await finalizePropertyMediaUpload(
        propertyId,
        prepared.upload.sessionId,
        item.asDocument,
        dims,
        item.asFloorPlan ? FLOOR_PLAN_TAG : null,
      );
      if (!finalized.ok) {
        patchQueue(item.key, { status: "error", error: finalized.error });
        return;
      }
      patchQueue(item.key, { status: "done" });
    } catch {
      patchQueue(item.key, { status: "error", error: "Yükleme başarısız — bağlantıyı kontrol edin." });
    }
  }

  /**
   * Seçilen dosyaları kuyruğa ekler ve PARALEL yükler (en çok UPLOAD_CONCURRENCY eşzamanlı; her satır kendi
   * ilerlemesini gösterir). Sıralı yükleme her dosyada hazırla → yükle → kesinleştir turlarını art arda bekletiyordu.
   */
  async function enqueueFiles(files: File[], fromCamera: boolean) {
    if (files.length === 0) return;
    setLastFromCamera(fromCamera);
    const items: QueueItem[] = files.map((file) => ({
      key: `q${++keySeq.current}`,
      file,
      name: file.name || "fotoğraf.jpg",
      status: "queued",
      asDocument: uploadKind === "document",
      asFloorPlan: uploadKind === "floorplan" && metaAvailable,
    }));
    // Önceki partinin biten satırları temizlenir, hatalılar yeniden dene için kalır
    setQueue((prev) => [
      ...prev.filter((q) => q.status === "error" || q.status === "uploading" || q.status === "stamping"),
      ...items,
    ]);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const item = items[next++];
        await uploadOne(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, items.length) }, worker));
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
  const ocrReturnFocusRef = useRef<HTMLElement | null>(null);
  const [ocrGuven, setOcrGuven] = useState<string | null>(null);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [ocrPending, startOcr] = useTransition();
  const [applyPending, startApply] = useTransition();

  function runOcr(mediaId: string) {
    setOcrBusyId(mediaId);
    ocrReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOcrOpen(true);
    requestAnimationFrame(() => document.getElementById("ocr-paneli")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
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

  // KVKK P0-9: belge işaretli görseller ayrı bölümde; public yüzeylerde (paylaşım, sunum, vitrin...) gösterilmez.
  const allImages = media.filter((m) => m.kind === "image");
  const serverImages = allImages.filter((m) => !m.is_document);
  const documents = allImages.filter((m) => m.is_document);
  const links = media.filter((m) => m.kind !== "image");
  const imageKey = allImages.map((m) => `${m.id}:${m.room_tag ?? ""}`).join(",");

  // ---------------------------------------------------------------------
  // Sıralama: masaüstünde sürükle-bırak (HTML5 draggable), dokunmatikte seçili görselin ok düğmeleri
  // (Başa al / Öne al / Geri al / Sona al). `order` yalnız kullanıcı sıra değiştirdiğinde dolar; sunucu
  // listesi değişince (kaydedildi/silindi) sıfırlanır ve tek doğruluk kaynağı yine sunucudur.
  // Fotoğraflar ve kat planları kendi listesi içinde sıralanır; kat planları yayında ayrı sekmededir.
  // ---------------------------------------------------------------------
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const byId = new Map(allImages.map((m) => [m.id, m]));
  const photoById = new Map(serverImages.map((m) => [m.id, m]));
  const orderedPublic = order
    ? [
        ...order.map((id) => photoById.get(id)).filter((m): m is MediaItem => Boolean(m)),
        ...serverImages.filter((m) => !order.includes(m.id)),
      ]
    : serverImages;
  const images = orderedPublic.filter((m) => !isFloorPlan(m));
  const floorPlans = orderedPublic.filter((m) => isFloorPlan(m));

  /** Yeni sırayı kalıcı yazar (belgeler ve video/tur bağlantıları listenin sonuna alınır). */
  function saveOrder(ids: string[]) {
    const same = ids.every((id, i) => serverImages[i]?.id === id);
    if (same) return;
    setSavingOrder(true);
    setOrderError(null);
    startTransition(async () => {
      const r = await reorderPropertyMedia(propertyId, [...ids, ...documents.map((d) => d.id), ...links.map((l) => l.id)]);
      setSavingOrder(false);
      if (r.error) {
        setOrderError(r.error);
        setOrder(null); // başarısızsa sunucu sırasına geri dön
      }
    });
  }

  /** Sürüklenen görseli hedefin yerine taşır (canlı önizleme; yalnız aynı liste içinde). */
  function moveOver(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const dragged = byId.get(dragId);
    const target = byId.get(targetId);
    if (!dragged || !target || isFloorPlan(dragged) !== isFloorPlan(target)) return;
    const current = [...images, ...floorPlans].map((m) => m.id);
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

  /** Bırakınca sırayı kalıcı yazar. */
  function commitOrder() {
    // onDrop + onDragEnd arka arkaya tetiklenir; ikinci çağrı sessizce düşer.
    if (!dragId) return;
    setDragId(null);
    saveOrder([...images, ...floorPlans].map((m) => m.id));
  }

  /**
   * Dokunmatik/klavye sıralama: seçili görseli kendi listesinde taşır. "first"/"last" uçlara, sayı kadar adım.
   * Art arda dokunuşlar tek kayda birleşir (700 ms sessizlikten sonra yazılır).
   */
  function moveItem(id: string, step: number | "first" | "last") {
    const item = byId.get(id);
    if (!item || item.is_document) return;
    const list = (isFloorPlan(item) ? floorPlans : images).map((m) => m.id);
    const from = list.indexOf(id);
    if (from < 0) return;
    const to =
      step === "first" ? 0 : step === "last" ? list.length - 1 : Math.max(0, Math.min(list.length - 1, from + step));
    if (to === from) return;
    const nextList = [...list];
    nextList.splice(from, 1);
    nextList.splice(to, 0, id);
    const next = isFloorPlan(item)
      ? [...images.map((m) => m.id), ...nextList]
      : [...nextList, ...floorPlans.map((m) => m.id)];
    setOrder(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveOrder(next), 700);
  }

  // ---------------------------------------------------------------------
  // Çoklu seçim + toplu işlemler
  // ---------------------------------------------------------------------
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [metaPending, startMeta] = useTransition();

  // Sunucu listesi değişince (yükleme/silme/sıra kaydı) yerel sıra ve seçim
  // sıfırlanır. useEffect DEĞİL, render sırasında ayarlama: React'in önerdiği
  // "prop değişince state türet" deseni (fazladan render turu yok).
  const [syncedKey, setSyncedKey] = useState(imageKey);
  if (syncedKey !== imageKey) {
    setSyncedKey(imageKey);
    setOrder(null);
    const alive = new Set(allImages.map((m) => m.id));
    setSelected((prev) => prev.filter((id) => alive.has(id)));
  }

  const selectedSet = new Set(selected);
  const allSelected = allImages.length > 0 && selected.length === allImages.length;
  const single = selected.length === 1 ? byId.get(selected[0]) ?? null : null;

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

  /** Seçili (ya da tek) görselleri Belge / Fotoğraf olarak işaretler (KVKK P0-9). */
  function markDocument(ids: string[], isDocument: boolean) {
    if (ids.length === 0) return;
    setBulkError(null);
    startTransition(async () => {
      const r = await setPropertyMediaDocument(propertyId, ids, isDocument);
      if (r.error) setBulkError(r.error);
      else setSelected([]);
    });
  }

  /** Oda etiketi / açıklama / kat planı yazar (tek görsel düzenleyici ve toplu "Kat planı yap"). */
  function saveMeta(ids: string[], input: { roomTag?: string | null; caption?: string | null }, clearSelection = false) {
    if (ids.length === 0) return;
    setBulkError(null);
    startMeta(async () => {
      const r = await updatePropertyMediaMeta(propertyId, ids, input);
      if (r.error) setBulkError(r.error);
      else if (clearSelection) setSelected([]);
    });
  }

  function makeCover(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("property_id", propertyId);
    startTransition(() => setCoverPropertyMedia(fd));
  }

  const unstamped = orderedPublic.filter((m) => !m.has_watermark).length;
  // Kapak önerisi yalnız ölçülmüş fotoğraflardan (boyut yoksa öneri yok) ve yalnız düzenleyene.
  const coverSuggestion = canEdit ? suggestCover(images) : null;
  const zipHref = `/api/property-media/zip/${propertyId}`;

  /** Fotoğraf / kat planı kartı (belge kartı ayrı bölümde). */
  function renderImageCard(m: MediaItem, i: number) {
    const plan = isFloorPlan(m);
    const label = mediaShortLabel(m);
    const draggableCard = canEdit && !plan;
    return (
      <div
        key={m.id}
        draggable={draggableCard}
        onDragStart={(e) => {
          if (!draggableCard) return;
          e.dataTransfer.setData("text/plain", m.id);
          e.dataTransfer.effectAllowed = "move";
          setDragId(m.id);
        }}
        onDragOver={(e) => {
          if (!dragId || plan) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          moveOver(m.id);
        }}
        onDrop={(e) => {
          e.preventDefault();
          commitOrder();
        }}
        onDragEnd={commitOrder}
        className={`group relative aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] border transition ${
          plan ? "bg-white" : "bg-canvas"
        } ${
          dragId === m.id
            ? "border-brand-300 opacity-40"
            : selectedSet.has(m.id)
              ? "border-brand-400 ring-2 ring-brand-400/35"
              : "border-line"
        } ${draggableCard ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        <Image
          src={`/api/property-media/${m.id}/download`}
          alt={mediaAltText(m, plan ? "Kat planı" : `Portföy fotoğrafı ${i + 1}`)}
          fill
          sizes="(max-width: 640px) 50vw, 25vw"
          className={plan ? "object-contain p-1" : "object-cover"}
          unoptimized
          draggable={false}
        />
        {canEdit ? (
          <>
            {/* Kartın tamamı seçim etiketidir: telefonda görsele dokunmak seçer (sıra/etiket paneli açılır). */}
            <label className="absolute inset-0 z-[5] cursor-pointer">
              <span className="absolute left-1 top-1 grid h-9 w-9 place-items-center touch:h-11 touch:w-11">
                <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] bg-ink-950/55 backdrop-blur-sm">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(m.id)}
                    onChange={() => toggleSelect(m.id)}
                    aria-label={`${plan ? "Kat planını" : "Görseli"} seç${label ? ` (${label})` : ""}`}
                    className="h-4 w-4 accent-[var(--brand-600)] touch:h-5 touch:w-5"
                  />
                </span>
              </span>
            </label>
            {draggableCard ? (
              <span
                aria-hidden
                className="hover-action absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-[var(--radius-control)] bg-ink-950/55 text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100 [@media(hover:none)]:hidden"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </>
        ) : null}
        {/* Sıra numarası + etiket — sürükleyerek/oklarla değiştirilen düzen görünür olsun */}
        <span className="pointer-events-none absolute bottom-2 left-2 z-10 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-ink-950/65 px-2 py-0.5 text-xs font-bold text-white backdrop-blur-sm">
          <span>{i + 1}</span>
          {label ? <span className="truncate font-semibold">· {label}</span> : null}
        </span>
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 flex -translate-x-1/2 flex-wrap justify-center gap-1">
          {m.is_cover && !plan ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-ink-950/80 px-2 py-0.5 text-xs font-bold text-white">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Kapak
            </span>
          ) : null}
          {canEdit && !m.has_watermark ? (
            <span
              title="Bu görsel filigransız yüklendi. Ayar değişse bile eski görseller yeniden damgalanmaz — yeniden yükleyerek damgalayabilirsiniz."
              className="inline-flex items-center gap-1 rounded-full bg-amber-400/85 px-2 py-0.5 text-xs font-bold text-ink-950"
            >
              <Droplets className="h-3 w-3" /> Filigran yok
            </span>
          ) : null}
          {canEdit && !plan
            ? (() => {
                const q = assessPhoto(m);
                return q.issues.length > 0 ? (
                  <span
                    title={q.warning ?? undefined}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-400/85 px-2 py-0.5 text-xs font-bold text-ink-950"
                  >
                    <AlertCircle className="h-3 w-3" aria-hidden /> {ISSUE_BADGE[q.issues[0]]}
                  </span>
                ) : null;
              })()
            : null}
        </div>
        {canEdit ? (
          // Dokunmatikte gizli: aynı eylemler seçim panelinde 44 px hedeflerle (görsele dokunmak seçer).
          <div className="hover-action absolute inset-x-0 bottom-0 z-10 flex items-center justify-end gap-1 bg-gradient-to-t from-ink-950/80 to-transparent p-2 opacity-0 transition group-hover:opacity-100 [@media(hover:none)]:hidden">
            <button
              type="button"
              title="AI ile oku (tapu/yetki belgesi)"
              aria-label="AI ile oku (tapu/yetki belgesi)"
              disabled={ocrPending}
              onClick={() => runOcr(m.id)}
              className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] bg-white/90 text-brand-600 hover:bg-white disabled:opacity-60 touch:min-h-11 touch:min-w-11"
            >
              {ocrBusyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanText className="h-3.5 w-3.5" />}
            </button>
            {!m.is_cover && !plan ? (
              <button
                type="button"
                title="Kapak yap"
                aria-label="Kapak yap"
                onClick={() => makeCover(m.id)}
                className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] bg-white/90 text-ink-950 hover:bg-white touch:min-h-11 touch:min-w-11"
              >
                <Star className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {documentFlagAvailable ? (
              <button
                type="button"
                title="Belge olarak işaretle (dışarıda gösterilmez)"
                aria-label="Belge olarak işaretle (dışarıda gösterilmez)"
                onClick={() => markDocument([m.id], true)}
                className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] bg-white/90 text-ink-950 hover:bg-white touch:min-h-11 touch:min-w-11"
              >
                <FileLock2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <ConfirmDialog
              trigger={
                <button
                  type="button"
                  title="Sil"
                  aria-label="Sil"
                  className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] bg-danger-500 text-white hover:bg-danger-600 touch:min-h-11 touch:min-w-11"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              }
              title={plan ? "Kat planı silinsin mi?" : "Görsel silinsin mi?"}
              description={plan ? "Bu kat planı kalıcı olarak silinir." : "Bu görsel kalıcı olarak silinir."}
              confirmLabel="Sil"
              formAction={deletePropertyMedia}
              hiddenFields={{ id: m.id, property_id: propertyId }}
            />
          </div>
        ) : null}
      </div>
    );
  }


  const [urlState, urlAction, urlPending] = useActionState<MediaResult, FormData>(
    addPropertyMediaUrl,
    {},
  );

  const uploadKinds: { value: UploadKind; label: string; icon: typeof ImageIcon; title: string }[] = [
    { value: "photo", label: "Fotoğraf", icon: ImageIcon, title: "İlan fotoğrafı: paylaşım, sunum ve vitrinde gösterilir." },
    ...(metaAvailable
      ? [
          {
            value: "floorplan" as const,
            label: "Kat planı",
            icon: LayoutPanelTop,
            title: "Kat planı: vitrin, paylaşım ve sunumda fotoğraflardan ayrı 'Kat planı' sekmesinde gösterilir.",
          },
        ]
      : []),
    {
      value: "document",
      label: "Belge",
      icon: FileLock2,
      title: "Tapu, yetki belgesi, kimlik gibi belgeler: paylaşım, sunum ve vitrinde ASLA gösterilmez.",
    },
  ];
  const uploadLabel = uploadKind === "document" ? "Belge yükle" : uploadKind === "floorplan" ? "Kat planı yükle" : "Fotoğraf yükle";
  const publicCount = images.length + floorPlans.length;

  return (
    <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <ImagePlus className="h-4 w-4 text-brand-600" /> Medya galerisi
          </h2>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
            {images.length} fotoğraf{floorPlans.length > 0 ? ` · ${floorPlans.length} kat planı` : ""} · {documents.length} belge ·{" "}
            {links.length} video/tur — fotoğraflar paylaşımda gösterilir, belgeler gösterilmez
            {canEdit ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
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
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {canEdit && pendingFiles && pendingFiles.length > 0 ? (
            <Button
              icon={Upload}
              onClick={() => {
                void enqueueFiles(pendingFiles, false);
                onPendingQueued?.();
              }}
              disabled={uploading}
            >
              Paylaşılan {pendingFiles.length} fotoğrafı yükle
            </Button>
          ) : null}
          {canEdit ? (
            <>
              <input
                aria-label="Fotoğraf seç"
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
                aria-label="Kamerayla fotoğraf çek"
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => onFileChange(e, true)}
              />
              {/* Yükleme türü (KVKK P0-9): Belge seçilirse kayıt ilk andan "dışarıda gösterilmez" işaretli doğar;
                  Kat planı seçilirse kayıt kat planı etiketiyle doğar (yayında ayrı sekme, kapak olmaz). */}
              <div
                role="radiogroup"
                aria-label="Yükleme türü"
                className="inline-flex max-w-full rounded-[var(--radius-control)] border border-line bg-canvas p-0.5 text-xs font-semibold"
              >
                {uploadKinds.map((k) => {
                  const active = uploadKind === k.value;
                  const Icon = k.icon;
                  return (
                    <button
                      key={k.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setUploadKind(k.value)}
                      disabled={uploading}
                      title={k.title}
                      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--radius-control)] px-2.5 py-1.5 touch:min-h-11 ${
                        active ? "bg-surface text-ink-950 shadow-sm" : "text-text-muted hover:text-ink-950"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden /> {k.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                disabled={uploading}
                className="hidden min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 [@media(hover:none)]:inline-flex"
              >
                <Camera className="h-4 w-4" /> Kamera ile çek
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="btn-shine inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-3.5 py-2 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-60 touch:min-h-11"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploadLabel}
              </button>
            </>
          ) : null}
          {publicCount > 0 ? (
            // Toplu indirme (PF-09): sıralı ZIP; belge, video ve tur bağlantıları girmez. Filigranlı seçenek
            // yüklenirken damgalanmamış görsellere ofis filigranını ZIP'teki kopyada basar.
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={buttonClass({ variant: "outline", size: "md" })}>
                  <Download className="h-4 w-4" aria-hidden /> İndir
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-[15rem]">
                <DropdownMenuItem asChild>
                  <a href={zipHref} className="touch:min-h-11">
                    <ArrowDownToLine className="h-4 w-4" aria-hidden /> Tüm fotoğraflar (ZIP)
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`${zipHref}?filigran=1`} className="touch:min-h-11">
                    <Droplets className="h-4 w-4" aria-hidden /> Filigranlı fotoğraflar (ZIP)
                  </a>
                </DropdownMenuItem>
                <p className="px-2.5 pb-1 pt-1.5 text-xs text-text-muted">
                  Galeri sırasıyla, en çok 60 görsel. Belgeler ZIP&apos;e eklenmez.
                </p>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {/* Telefonda seçim paneli ekranın altına sabitlenir: son satırlar panelin arkasında kalmasın diye alt boşluk. */}
      <div className={`p-4 sm:p-5 ${canEdit && single && !single.is_document ? "pb-72 lg:pb-5" : ""}`}>
        {queue.length > 0 ? (
          <div className="mb-4 space-y-1.5">
            {queue.map((q) => (
              <div key={q.key}>
              <div
                className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs"
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
                    className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-control)] border border-line px-2 py-1 font-semibold text-ink-950 hover:bg-surface disabled:opacity-60"
                  >
                    <RefreshCw className="h-3 w-3" /> Yeniden dene
                  </button>
                ) : null}
              </div>
              {q.warning ? (
                <p role="status" className="mt-1 flex items-start gap-1.5 px-3 text-xs font-medium text-amber-700">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {q.warning}
                </p>
              ) : null}
              </div>
            ))}
            {!uploading ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {lastFromCamera && queue.some((q) => q.status === "done") ? (
                  <button
                    type="button"
                    onClick={() => cameraRef.current?.click()}
                    className="hidden items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700 [@media(hover:none)]:inline-flex"
                  >
                    <Camera className="h-4 w-4" /> Bir daha çek
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setQueue([])}
                  className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-ink-950"
                >
                  Listeyi temizle
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {allImages.length === 0 && links.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">
            Henüz medya yok. Fotoğraf yükleyin veya video/360° tur bağlantısı ekleyin.
          </p>
        ) : null}

        {allImages.length > 0 && canEdit ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-950 touch:min-h-11">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? [] : allImages.map((m) => m.id))}
                className="h-4 w-4 accent-[var(--brand-600)] touch:h-5 touch:w-5"
              />
              Tümünü seç
            </label>
            <span className="text-xs text-text-muted">
              {selected.length > 0 ? (
                `${selected.length} görsel seçili`
              ) : (
                <>
                  <span className="[@media(hover:none)]:hidden">Sıralamak için sürükleyip bırakın ya da bir görsel seçin</span>
                  <span className="hidden [@media(hover:none)]:inline">Sıralamak ve etiketlemek için bir görsel seçin</span>
                </>
              )}
            </span>
            <span className="flex-1" />
            {single && !single.is_cover && !single.is_document && !isFloorPlan(single) ? (
              <Button variant="secondary" size="sm" icon={Star} onClick={() => makeCover(single.id)}>
                Kapak yap
              </Button>
            ) : null}
            {selected.length > 0 && metaAvailable ? (
              <>
                {selected.some((id) => !byId.get(id)?.is_document && !isFloorPlan(byId.get(id) ?? {})) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={LayoutPanelTop}
                    loading={metaPending}
                    title="Seçilenler yayında fotoğraflardan ayrı 'Kat planı' sekmesinde gösterilir."
                    onClick={() =>
                      saveMeta(
                        selected.filter((id) => !byId.get(id)?.is_document && !isFloorPlan(byId.get(id) ?? {})),
                        { roomTag: FLOOR_PLAN_TAG },
                        true,
                      )
                    }
                  >
                    Kat planı yap ({selected.filter((id) => !byId.get(id)?.is_document && !isFloorPlan(byId.get(id) ?? {})).length})
                  </Button>
                ) : null}
                {selected.some((id) => isFloorPlan(byId.get(id) ?? {})) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={ImageIcon}
                    loading={metaPending}
                    onClick={() => saveMeta(selected.filter((id) => isFloorPlan(byId.get(id) ?? {})), { roomTag: null }, true)}
                  >
                    Fotoğrafa çevir ({selected.filter((id) => isFloorPlan(byId.get(id) ?? {})).length})
                  </Button>
                ) : null}
              </>
            ) : null}
            {selected.length > 0 && documentFlagAvailable ? (
              <>
                {selected.some((id) => !byId.get(id)?.is_document) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={FileLock2}
                    onClick={() => markDocument(selected.filter((id) => !byId.get(id)?.is_document), true)}
                    title="Seçilenler paylaşım, sunum ve vitrinde gösterilmez."
                  >
                    Belge yap ({selected.filter((id) => !byId.get(id)?.is_document).length})
                  </Button>
                ) : null}
                {selected.some((id) => byId.get(id)?.is_document) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={ImageIcon}
                    onClick={() => markDocument(selected.filter((id) => byId.get(id)?.is_document), false)}
                    title="Seçilenler ilan fotoğrafı olur ve paylaşımda gösterilir."
                  >
                    Fotoğraf yap ({selected.filter((id) => byId.get(id)?.is_document).length})
                  </Button>
                ) : null}
              </>
            ) : null}
            {selected.length > 0 ? (
              <ConfirmDialog
                trigger={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/10 px-3 py-1.5 text-xs font-semibold text-danger-500 hover:bg-danger-500/15 touch:min-h-11"
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
            {selected.length > 0 ? (
              <Button variant="ghost" size="icon" icon={X} aria-label="Seçimi kaldır" onClick={() => setSelected([])} />
            ) : null}
            {savingOrder ? (
              <span role="status" className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sıra kaydediliyor…
              </span>
            ) : null}
          </div>
        ) : null}

        {canEdit && single && !single.is_document ? (
          <SelectedMediaPanel
            key={`${single.id}:${single.room_tag ?? ""}:${single.caption ?? ""}`}
            item={single}
            position={(isFloorPlan(single) ? floorPlans : images).findIndex((m) => m.id === single.id)}
            total={(isFloorPlan(single) ? floorPlans : images).length}
            metaAvailable={metaAvailable}
            pending={metaPending}
            onMove={(step) => moveItem(single.id, step)}
            onSaveMeta={(input) => saveMeta([single.id], input)}
            onClose={() => setSelected([])}
            actions={
              <>
                {!single.is_cover && !isFloorPlan(single) ? (
                  <Button variant="ghost" size="icon" icon={Star} aria-label="Kapak yap" title="Kapak yap" onClick={() => makeCover(single.id)} />
                ) : null}
                <ConfirmDialog
                  trigger={
                    <button
                      type="button"
                      aria-label="Sil"
                      title="Sil"
                      className={buttonClass({ variant: "ghost", size: "icon", className: "text-danger-500" })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  }
                  title={isFloorPlan(single) ? "Kat planı silinsin mi?" : "Görsel silinsin mi?"}
                  description="Bu görsel kalıcı olarak silinir."
                  confirmLabel="Sil"
                  formAction={deletePropertyMedia}
                  hiddenFields={{ id: single.id, property_id: propertyId }}
                />
              </>
            }
          />
        ) : null}

        {orderError || bulkError ? (
          <p role="alert" className="mb-3 text-sm font-medium text-danger-500">{orderError ?? bulkError}</p>
        ) : null}

        {coverSuggestion ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs">
            <Star className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            <span className="min-w-0 flex-1 font-medium text-ink-950">
              Kapak önerisi: {coverSuggestion.reason} ({images.findIndex((m) => m.id === coverSuggestion.id) + 1}. fotoğraf)
            </span>
            <Button variant="secondary" size="sm" icon={Star} onClick={() => makeCover(coverSuggestion.id)}>
              Kapak yap
            </Button>
          </div>
        ) : null}

        {images.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((m, i) => renderImageCard(m, i))}
          </div>
        ) : null}

        {/* PF-01 / PUB-9: kat planları ayrı şeritte; yayında (vitrin, paylaşım, sunum, broşür) ayrı sekmede gösterilir. */}
        {floorPlans.length > 0 ? (
          <div className="mt-5">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-ink-950">
              <LayoutPanelTop className="h-4 w-4 text-brand-600" aria-hidden /> Kat planları ({floorPlans.length})
            </h3>
            <p className="mb-3 text-xs text-text-muted">
              Vitrin, paylaşım linki ve sunumda fotoğraflardan ayrı &quot;Kat planı&quot; sekmesinde gösterilir; kapak olmaz.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {floorPlans.map((m, i) => renderImageCard(m, i))}
            </div>
          </div>
        ) : null}

        {/* KVKK P0-9: belgeler ayrı bölümde, kilit rozetiyle; public yüzeylere çıkmaz. */}
        {documents.length > 0 ? (
          <div className="mt-5">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-ink-950">
              <LockKeyhole className="h-4 w-4 text-text-muted" /> Belgeler ({documents.length})
            </h3>
            <p className="mb-3 text-xs text-text-muted">
              Tapu, yetki belgesi gibi belgeler yalnız ofis içinde görünür; paylaşım linki, sunum, vitrin ve portallarda
              gösterilmez.
              {documentFlagAvailable
                ? ""
                : " Şimdilik dosya adına göre ayrıldı; işaretleme veritabanı güncellemesinden sonra açılır."}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {documents.map((m) => (
                <div
                  key={m.id}
                  className={`group relative aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] border bg-canvas ${
                    selectedSet.has(m.id) ? "border-brand-400 ring-2 ring-brand-400/35" : "border-line"
                  }`}
                >
                  <Image
                    src={`/api/property-media/${m.id}/download`}
                    alt="Portföy belgesi"
                    fill
                    sizes="(max-width: 640px) 50vw, 25vw"
                    className="object-cover"
                    unoptimized
                    draggable={false}
                  />
                  {canEdit ? (
                    <label className="absolute left-1 top-1 z-10 grid h-9 w-9 cursor-pointer place-items-center touch:h-11 touch:w-11">
                      <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] bg-ink-950/55 backdrop-blur-sm">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(m.id)}
                          onChange={() => toggleSelect(m.id)}
                          aria-label="Belgeyi seç"
                          className="h-4 w-4 accent-[var(--brand-600)] touch:h-5 touch:w-5"
                        />
                      </span>
                    </label>
                  ) : null}
                  <span className="absolute left-1/2 top-2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink-950/80 px-2 py-0.5 text-xs font-bold text-white">
                    <LockKeyhole className="h-3 w-3" /> Dışarıda gösterilmez
                  </span>
                  {canEdit ? (
                    <div className="hover-action absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-ink-950/80 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        title="AI ile oku (tapu/yetki belgesi)"
                        disabled={ocrPending}
                        onClick={() => runOcr(m.id)}
                        className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] bg-white/90 text-brand-600 hover:bg-white disabled:opacity-60 touch:min-h-11 touch:min-w-11"
                      >
                        {ocrBusyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanText className="h-3.5 w-3.5" />}
                      </button>
                      {documentFlagAvailable ? (
                        <button
                          type="button"
                          title="Fotoğraf yap (paylaşımda gösterilir)"
                          aria-label="Fotoğraf yap (paylaşımda gösterilir)"
                          onClick={() => markDocument([m.id], false)}
                          className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] bg-white/90 text-ink-950 hover:bg-white touch:min-h-11 touch:min-w-11"
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <ConfirmDialog
                        trigger={
                          <button
                            type="button"
                            title="Sil"
                            aria-label="Sil"
                            className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] bg-danger-500 text-white hover:bg-danger-600 touch:min-h-11 touch:min-w-11"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        }
                        title="Belge silinsin mi?"
                        description="Bu belge kalıcı olarak silinir."
                        confirmLabel="Sil"
                        formAction={deletePropertyMedia}
                        hiddenFields={{ id: m.id, property_id: propertyId }}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {canEdit && publicCount > 0 && unstamped > 0 && watermark.enabled ? (
          <p className="mt-2 text-xs text-text-faint">
            {unstamped} görsel filigransız. Filigran yükleme anında basıldığı için eski görseller
            geriye dönük damgalanmaz — istersen o fotoğrafları silip yeniden yükleyebilirsin.
          </p>
        ) : null}

        {links.length > 0 ? (
          <div className="mt-4 space-y-2">
            {links.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
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
                    className="grid h-7 w-7 min-h-9 min-w-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line text-danger-500 hover:border-danger-500/40 touch:min-h-11 touch:min-w-11"
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
              <select name="kind" defaultValue="video" className="mt-1.5 block rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold outline-none focus:border-brand-400">
                <option value="video">Video</option>
                <option value="tour">360° Sanal tur</option>
              </select>
            </label>
            <label className="min-w-[220px] flex-1 text-xs font-medium text-text-muted">
              Bağlantı (YouTube, Matterport, Kuula vb.)
              <div className="mt-1.5 flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-canvas px-3">
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
              className="rounded-[var(--radius-control)] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-60"
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
          id="ocr-paneli"
          role="region"
          aria-label="Belgeden okunan bilgiler"
          className="m-5 scroll-mt-24 rounded-[var(--radius-panel)] border border-brand-300 bg-surface p-5"
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
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted hover:text-ink-950 touch:min-h-11 touch:min-w-11"
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
                        className="mt-1.5 block w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm font-semibold text-ink-950 outline-none focus:border-brand-400"
                      />
                    </label>
                  ))}
                </div>

                <p className="mt-3 text-xs text-text-faint">
                  Ada, parsel ve yüzölçümü portföy alanlarına yazılır; diğer tapu bilgileri iç notlara
                  &quot;Tapu bilgileri (AI)&quot; bloğu olarak eklenir.
                </p>

                {applyErr ? <p className="mt-2 text-sm font-medium text-danger-500">{applyErr}</p> : null}
                {applyMsg ? <p className="mt-2 text-sm font-medium text-mint-700">{applyMsg}</p> : null}

                <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
                  <button
                    type="button"
                    onClick={copyOcr}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3.5 py-2 text-sm font-semibold text-ink-950 hover:bg-canvas"
                  >
                    {copied ? <Check className="h-4 w-4 text-mint-600" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Kopyalandı" : "Kopyala"}
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={applyOcr}
                      disabled={applyPending}
                      className="btn-shine inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-3.5 py-2 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-60"
                    >
                      {applyPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Portföye uygula
                    </button>
                  ) : null}
                </div>
              </>
            )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Tek seçili fotoğraf / kat planı paneli: dokunmatik sıralama (Başa al, Öne al, Arkaya al, Sona al; ≥44 px hedef),
 * kapak/silme ve oda etiketi + açıklama. Telefonda (< lg) ekranın altına, mobil alt gezinmenin üstüne sabitlenir:
 * aşağıdaki bir fotoğrafa dokunan kullanıcı paneli görmek için yukarı kaydırmak zorunda kalmaz. Masaüstünde galeri
 * üstünde satır içi durur. Etiket seçimi anında kaydedilir; açıklama "Kaydet" ile (Enter da kaydeder). `key` seçili
 * kaydın kimliği + değerleriyle verilir: sunucudan yeni değer gelince alanlar kendiliğinden tazelenir.
 */
function SelectedMediaPanel({
  item,
  position,
  total,
  metaAvailable,
  pending,
  actions,
  onMove,
  onSaveMeta,
  onClose,
}: {
  item: MediaItem;
  position: number;
  total: number;
  metaAvailable: boolean;
  pending: boolean;
  /** Başlık satırındaki ek eylemler (Kapak yap, Sil). */
  actions?: ReactNode;
  onMove: (step: number | "first" | "last") => void;
  onSaveMeta: (input: { roomTag?: string | null; caption?: string | null }) => void;
  onClose: () => void;
}) {
  const plan = isFloorPlan(item);
  const [caption, setCaption] = useState(item.caption ?? "");
  const captionDirty = caption.trim() !== (item.caption ?? "").trim();
  const atStart = position <= 0;
  const atEnd = position >= total - 1;
  const noun = plan ? "kat planı" : "fotoğraf";
  const moves: { label: string; icon: typeof ArrowLeft; step: number | "first" | "last"; disabled: boolean }[] = [
    { label: "Başa al", icon: ChevronsLeft, step: "first", disabled: atStart },
    { label: "Öne al", icon: ArrowLeft, step: -1, disabled: atStart },
    { label: "Arkaya al", icon: ArrowRight, step: 1, disabled: atEnd },
    { label: "Sona al", icon: ChevronsRight, step: "last", disabled: atEnd },
  ];

  return (
    <div
      role="region"
      aria-label={`Seçili ${noun}: sıra ve etiket`}
      className="fixed inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-30 max-h-[60dvh] overflow-y-auto overscroll-contain rounded-[var(--radius-card)] border border-brand-300/60 bg-surface p-3 shadow-[var(--elev-2)] lg:static lg:mb-3 lg:max-h-none lg:overflow-visible lg:bg-brand-600/5 lg:shadow-none"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-bold text-ink-950">
          {plan ? "Kat planı" : "Fotoğraf"} {position + 1} / {total}
          <span className="ml-1 hidden font-medium text-text-muted sm:inline">
            — sırası {plan ? "kat planları" : "fotoğraflar"} içinde değişir
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <Button variant="ghost" size="icon" icon={X} aria-label="Seçimi kapat" onClick={onClose} />
        </div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap" role="group" aria-label="Sırayı değiştir">
        {moves.map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.label}
              type="button"
              disabled={m.disabled}
              onClick={() => onMove(m.step)}
              aria-label={m.label}
              title={m.label}
              className={buttonClass({ variant: "secondary", size: "sm", className: "w-full min-w-0 sm:w-auto" })}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          );
        })}
      </div>
      {metaAvailable ? (
        <form
          className="mt-2 grid gap-2 sm:grid-cols-[minmax(10rem,13rem)_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (captionDirty) onSaveMeta({ caption: caption.trim() || null });
          }}
        >
          <label className="text-xs font-semibold text-text-muted">
            <span className="mb-1 flex items-center gap-1">
              <Tag className="h-3.5 w-3.5" aria-hidden /> Oda etiketi
            </span>
            <select
              value={item.room_tag ?? ""}
              disabled={pending}
              onChange={(e) => onSaveMeta({ roomTag: e.target.value || null })}
              className="surface-sunken w-full rounded-[var(--radius-control)] border border-hairline px-3 py-[0.4375rem] text-sm font-semibold text-ink-950 focus:border-brand-400 focus:outline-none touch:min-h-11 touch:text-base"
            >
              <option value="">Etiket yok</option>
              {ROOM_TAGS.map((t) => (
                <option key={t} value={t}>
                  {ROOM_TAG_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2 sm:contents">
            <label className="min-w-0 text-xs font-semibold text-text-muted">
              <span className="mb-1 flex items-center justify-between gap-2">
                <span>Açıklama (vitrinde alt yazı)</span>
                <span className="font-medium tabular-nums text-text-faint">
                  {Array.from(caption).length}/{CAPTION_MAX}
                </span>
              </span>
              <Input
                value={caption}
                maxLength={CAPTION_MAX}
                enterKeyHint="done"
                placeholder={plan ? "ör. Zemin kat planı" : "ör. Deniz manzaralı salon"}
                onChange={(e) => setCaption(e.target.value)}
              />
            </label>
            <Button type="submit" variant="navy" size="md" loading={pending} disabled={!captionDirty}>
              Kaydet
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-2 text-xs text-text-muted">
          Oda etiketi, açıklama ve kat planı ayrımı veritabanı güncellemesinden sonra açılır.
        </p>
      )}
    </div>
  );
}
