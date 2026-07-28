"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Link2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import { bulkDeleteDocuments, deleteDocument } from "@/app/actions/documents";
import {
  CATEGORY_LABEL,
  KIND_LABEL,
  SOURCE_CHIP,
  SOURCE_LABEL,
  formatBytes,
  type DocumentRow,
} from "@/lib/documents";

/** Uzantı grubuna göre satır ikonu. */
const KIND_ICON = {
  gorsel: ImageIcon,
  pdf: FileText,
  ofis: FileSpreadsheet,
  diger: FileIcon,
} as const;

/**
 * Toplu indirmede tarayıcı "birden çok dosya indir" iznini tetiklemesin ve
 * yetkili uçlar aynı anda 50 istekle dolmasın diye dosyalar SIRAYLA indirilir.
 */
const DOWNLOAD_GAP_MS = 700;

const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

export function DocumentList({ rows }: { rows: DocumentRow[] }) {
  const { push } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);

  // Sayfa/filtre değişince (yeni satır dizisi) seçim ve açık önizleme taşınmasın.
  // useEffect yerine "render sırasında state düzeltme" deseni: effect ile
  // yapılsaydı bir kare boyunca ESKİ seçim yeni satırlarla birlikte görünürdü
  // (ve lint kuralı cascading render olarak haklı biçimde uyarıyor).
  const signature = rows.map((r) => r.key).join("|");
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setSelected(new Set());
    setLightboxKey(null);
  }

  const images = useMemo(() => rows.filter((r) => r.kind === "gorsel" && r.previewUrl), [rows]);
  const lightboxIndex = lightboxKey ? images.findIndex((i) => i.key === lightboxKey) : -1;

  const selectedRows = rows.filter((r) => selected.has(r.key));
  const deletableSelected = selectedRows.filter((r) => r.canDelete);
  const downloadableSelected = selectedRows.filter((r) => r.downloadUrl);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.key)));
  }

  /**
   * Sıralı toplu indirme. ZIP YOK: sunucuda arşivleme paketi (archiver/jszip)
   * bulunmuyor ve yalnız bu ekran için bağımlılık eklemek, zip'i üretecek
   * belleği/CPU'yu da serverless fonksiyona yüklemek demekti. Sıralı indirme
   * aynı sonucu sıfır bağımlılıkla veriyor.
   */
  async function bulkDownload() {
    if (downloadableSelected.length === 0) return;
    setBusy(true);
    push(`${downloadableSelected.length} dosya sırayla indiriliyor…`, "info");
    for (const row of downloadableSelected) {
      const a = document.createElement("a");
      a.href = row.downloadUrl!;
      a.download = row.name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, DOWNLOAD_GAP_MS));
    }
    setBusy(false);
    push("İndirme kuyruğu tamamlandı.", "ok");
  }

  function runBulkDelete() {
    startTransition(async () => {
      const res = await bulkDeleteDocuments(deletableSelected.map((r) => r.key));
      if (res.error && !res.ok) push(res.error, "err");
      else if (res.error) push(res.error, "info");
      else push(`${res.deleted} belge kaldırıldı.`, "ok");
      setSelected(new Set());
    });
  }

  function runDelete(row: DocumentRow) {
    startTransition(async () => {
      const res = await deleteDocument(row.source, row.id);
      if (res.error) push(res.error, "err");
      else push(row.source === "sozlesme" ? "Sözleşme iptal edildi." : "Belge kaldırıldı.", "ok");
    });
  }

  return (
    <div className="space-y-3">
      {/* --- Toplu işlem çubuğu --- */}
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-2.5">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-text-muted">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            aria-label="Sayfadaki tüm belgeleri seç"
            className="h-4 w-4 rounded border-line accent-[var(--brand-600)]"
          />
          Tümünü seç
        </label>
        <span className="text-xs text-text-faint">
          {selected.size > 0 ? `${selected.size} belge seçildi` : `${rows.length} belge listeleniyor`}
        </span>
        {selected.size > 0 ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={Download}
              loading={busy}
              disabled={downloadableSelected.length === 0}
              onClick={bulkDownload}
            >
              İndir ({downloadableSelected.length})
            </Button>
            {deletableSelected.length > 0 ? (
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="danger" icon={Trash2} loading={pending}>
                    Kaldır ({deletableSelected.length})
                  </Button>
                }
                title={`${deletableSelected.length} belge kaldırılsın mı?`}
                description={
                  "Müşteri dosyası ve portföy medyası kalıcı olarak silinir. Anlaşma evrağında yalnız dosya bağlantısı temizlenir, madde listede kalır. Sözleşme silinmez, iptal edilir. Bu işlem geri alınamaz."
                }
                confirmLabel="Evet, kaldır"
                onConfirm={runBulkDelete}
              />
            ) : null}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="focus-ring text-xs font-semibold text-text-muted underline-offset-2 hover:text-ink-950 hover:underline"
            >
              Seçimi temizle
            </button>
          </div>
        ) : null}
      </div>

      {/* --- Liste --- */}
      <ul className="divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        {rows.map((row) => {
          const Icon = KIND_ICON[row.kind];
          const isSelected = selected.has(row.key);
          const isImage = row.kind === "gorsel" && Boolean(row.previewUrl);
          return (
            <li
              key={row.key}
              className={`grid gap-3 px-4 py-3 transition md:grid-cols-[auto_1fr_auto] md:items-center ${
                isSelected ? "bg-brand-600/[0.04]" : "hover:bg-brand-600/[0.02]"
              }`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(row.key)}
                  aria-label={`${row.name} seç`}
                  className="h-4 w-4 rounded border-line accent-[var(--brand-600)]"
                />
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-canvas text-text-muted">
                  <Icon className="h-5 w-5" />
                </span>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SOURCE_CHIP[row.source]}`}>
                    {SOURCE_LABEL[row.source]}
                  </span>
                  <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                    {CATEGORY_LABEL[row.category]}
                  </span>
                  <span className="text-[10px] font-medium text-text-faint">{KIND_LABEL[row.kind]}</span>
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-ink-950" title={row.name}>
                  {row.name}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-muted">
                  {row.relatedHref && row.relatedLabel ? (
                    <Link href={row.relatedHref} className="font-semibold text-brand-600 hover:underline">
                      {row.relatedLabel}
                    </Link>
                  ) : (
                    <span className="text-text-faint">İlişkili kayıt yok</span>
                  )}
                  <span aria-hidden>·</span>
                  <span title="Dosya boyutu">{formatBytes(row.size)}</span>
                  <span aria-hidden>·</span>
                  <span>{row.uploaderName ?? "Yükleyen bilinmiyor"}</span>
                  <span aria-hidden>·</span>
                  <time dateTime={row.createdAt}>{dateFmt.format(new Date(row.createdAt))}</time>
                  {row.label ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-text-faint">{row.label}</span>
                    </>
                  ) : null}
                </p>
              </div>

              <div className="flex items-center justify-end gap-1.5">
                {isImage ? (
                  <button
                    type="button"
                    onClick={() => setLightboxKey(row.key)}
                    aria-label={`${row.name} önizle`}
                    title="Önizle"
                    className="focus-ring press grid h-8 w-8 place-items-center rounded-[8px] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                ) : row.previewUrl ? (
                  <a
                    href={row.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${row.name} yeni sekmede aç`}
                    title={row.source === "sozlesme" ? "Sözleşmeyi aç" : "Yeni sekmede aç"}
                    className="focus-ring press grid h-8 w-8 place-items-center rounded-[8px] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                  >
                    {row.source === "sozlesme" || row.source === "evrak" ? (
                      <Link2 className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </a>
                ) : null}

                {row.downloadUrl ? (
                  <a
                    href={row.downloadUrl}
                    download={row.name}
                    aria-label={`${row.name} indir`}
                    title="İndir"
                    className="focus-ring press grid h-8 w-8 place-items-center rounded-[8px] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                ) : null}

                {row.canDelete ? (
                  <ConfirmDialog
                    trigger={
                      <button
                        type="button"
                        aria-label={`${row.name} ${row.source === "sozlesme" ? "iptal et" : "kaldır"}`}
                        title={row.source === "sozlesme" ? "Sözleşmeyi iptal et" : "Kaldır"}
                        className="focus-ring press grid h-8 w-8 place-items-center rounded-[8px] border border-line text-text-muted transition hover:border-danger-500/50 hover:text-danger-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    }
                    title={row.source === "sozlesme" ? "Sözleşme iptal edilsin mi?" : "Belge kaldırılsın mı?"}
                    description={
                      row.source === "sozlesme"
                        ? `“${row.name}” iptal edilecek. Sözleşme kaydı silinmez, durumu “İptal” olur.`
                        : row.source === "evrak"
                          ? `“${row.name}” maddesindeki dosya bağlantısı temizlenecek. Evrak maddesi listede kalır.`
                          : `“${row.name}” kalıcı olarak silinecek. Bu işlem geri alınamaz.`
                    }
                    confirmLabel={row.source === "sozlesme" ? "İptal et" : "Kaldır"}
                    onConfirm={() => runDelete(row)}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {lightboxIndex >= 0 ? (
        <Lightbox images={images} index={lightboxIndex} onIndex={(i) => setLightboxKey(images[i].key)} onClose={() => setLightboxKey(null)} />
      ) : null}
    </div>
  );
}

/**
 * Görsel önizleme — paketsiz, portal ile body'ye basılır.
 * `GalleryLightbox` yeniden kullanılamadı: o bileşen kaynağı sabit olarak
 * `/api/property-media/[id]` kuruyor; belge merkezinde görseller iki farklı
 * yetkili uçtan gelir. Klavye/odak davranışı (Esc, ok tuşları, scroll kilidi)
 * aynı desende.
 */
function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: DocumentRow[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const count = images.length;
  const prev = useCallback(() => onIndex((index - 1 + count) % count), [index, count, onIndex]);
  const next = useCallback(() => onIndex((index + 1) % count), [index, count, onIndex]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [prev, next, onClose]);

  const current = images[index];

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${current.name} önizleme`}
      tabIndex={-1}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex flex-col bg-ink-950/95 outline-none backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate text-sm font-semibold text-white/85">
          {current.name}
          <span className="ml-2 text-white/45">
            {index + 1} / {count}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {current.downloadUrl ? (
            <a
              href={current.downloadUrl}
              download={current.name}
              className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              aria-label="Bu görseli indir"
            >
              <Download className="h-5 w-5" />
            </a>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Önizlemeyi kapat (Esc)"
            className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </span>
      </div>

      <div className="relative flex flex-1 items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
        {/* Yetkili uçtan gelen, ölçüsü bilinmeyen belge görseli — next/image
            optimizasyonu burada kazanç sağlamaz, düz <img> kullanılıyor. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current.key}
          src={current.previewUrl ?? ""}
          alt={current.name}
          className="max-h-full max-w-full object-contain"
        />
        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label="Önceki görsel"
              className="focus-ring absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Sonraki görsel"
              className="focus-ring absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
