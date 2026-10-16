"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, FileUp, Loader2, Sparkles, TriangleAlert, UploadCloud } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { entryHref } from "@/lib/finance/entry-workspace";
import { useToast } from "@/components/app/toast-provider";
import { BRIDGE_HEADER } from "@/lib/listing-control/worker/bridge-request";
import { cn } from "@/lib/utils";

/**
 * Finans > Belgeler yükleme alanı (FN5): sürükle-bırak, çoklu seçim (en çok 10) ve mobilde kameradan çekim.
 * Her dosya `/api/app/finans/belge` ucuna ayrı gider (en çok 3 eşzamanlı). Fiş okuma açıksa dönen değerler YALNIZ
 * öneridir: "Fişten kayıt" kayıt sayfasını önceden doldurur, kullanıcı Kaydet demeden hareket oluşmaz.
 */

export const BELGE_ENDPOINT = "/api/app/finans/belge";
export const BELGE_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf";
const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const CONCURRENCY = 3;

export type OcrSuggestion = { amount?: number; date?: string; vatRate?: number; vendor?: string };

type UploadResponse = { ok: true; id: string; ocr?: OcrSuggestion; ocrSkipped?: "size" } | { ok: false; error: string };

type QueueItem = {
  key: string;
  name: string;
  status: "waiting" | "uploading" | "done" | "error";
  error?: string;
  id?: string;
  ocr?: OcrSuggestion;
  ocrSkipped?: "size";
};

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);
const dateTr = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
};

/** Önerinin kısa metni: "₺1.250,50 · 12.05.2026 · KDV %20 · Satıcı". */
export function suggestionText(s: OcrSuggestion | null | undefined): string | null {
  if (!s) return null;
  const parts = [
    s.amount != null ? money(s.amount) : null,
    s.date ? dateTr(s.date) : null,
    s.vatRate != null ? `KDV %${s.vatRate}` : null,
    s.vendor ?? null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * "Fişten kayıt": kayıt sayfasının (`/app/finans/kayit`) Gider sekmesini ekin kimliği ve okunan önerilerle (tutar, tarih,
 * KDV, satıcı) önceden dolu açan bağlantı. Kayıt yalnız kullanıcı Kaydet deyince oluşur; ek kayda bağlanır.
 */
export function entryHrefFromAttachment(attachmentId: string, ocr?: OcrSuggestion | null, direction: "in" | "out" = "out"): string {
  return entryHref({
    tab: direction === "in" ? "gelir" : "gider",
    attachmentId,
    amount: ocr?.amount ?? null,
    date: ocr?.date ?? null,
    vatRate: ocr?.vatRate ?? null,
    partyName: ocr?.vendor ?? null,
  });
}

function clientError(file: File): string | null {
  if (!TYPES.has(file.type)) return "Yalnız JPEG, PNG, WEBP görsel ya da PDF yüklenebilir.";
  if (file.size <= 0) return "Boş dosya yüklenemez.";
  if (file.size > MAX_BYTES) return "Dosya en çok 10 MB olabilir.";
  return null;
}

async function uploadOne(file: File): Promise<UploadResponse> {
  const fd = new FormData();
  fd.set("file", file);
  try {
    const res = await fetch(BELGE_ENDPOINT, { method: "POST", body: fd, headers: { [BRIDGE_HEADER]: "1" } });
    const json = (await res.json().catch(() => null)) as UploadResponse | null;
    if (json && typeof json === "object" && "ok" in json) return json;
    return { ok: false, error: "Yükleme tamamlanamadı. Tekrar deneyin." };
  } catch {
    return { ok: false, error: "Bağlantı kesildi. İnternetinizi kontrol edip tekrar deneyin." };
  }
}

let keySeq = 0;

export function UploadDropzone({ canUpload, compact = false }: { canUpload: boolean; compact?: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const busy = queue.some((q) => q.status === "waiting" || q.status === "uploading");

  function patch(key: string, next: Partial<QueueItem>) {
    setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, ...next } : q)));
  }

  async function start(list: FileList | File[] | null) {
    if (!list || !canUpload) return;
    let files = Array.from(list);
    if (files.length === 0) return;
    if (files.length > MAX_FILES) {
      push(`Tek seferde en çok ${MAX_FILES} dosya yüklenebilir; ilk ${MAX_FILES} dosya alındı.`, "info");
      files = files.slice(0, MAX_FILES);
    }
    const items: Array<QueueItem & { file: File }> = files.map((file) => {
      keySeq += 1;
      const err = clientError(file);
      return { key: `u${keySeq}`, name: file.name || "Belge", status: err ? "error" : "waiting", error: err ?? undefined, file };
    });
    setQueue((prev) => [...items.map(({ file: _f, ...rest }) => rest), ...prev.filter((q) => q.status !== "done" || q.ocr)].slice(0, 20));

    const work = items.filter((i) => i.status === "waiting");
    let ok = 0;
    let cursor = 0;
    async function worker() {
      while (cursor < work.length) {
        const item = work[cursor++]!;
        patch(item.key, { status: "uploading" });
        const res = await uploadOne(item.file);
        if (res.ok) {
          ok += 1;
          patch(item.key, { status: "done", id: res.id, ocr: res.ocr && suggestionText(res.ocr) ? res.ocr : undefined, ocrSkipped: res.ocrSkipped });
        } else {
          patch(item.key, { status: "error", error: res.error });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, worker));
    const failed = items.length - ok;
    if (ok > 0) {
      push(failed > 0 ? `${ok} belge fiş kutusuna eklendi, ${failed} belge yüklenemedi.` : `${ok} belge fiş kutusuna eklendi.`, failed > 0 ? "info" : "ok");
      router.refresh();
    } else if (failed > 0) {
      push("Belgeler yüklenemedi. Ayrıntı listede.", "err");
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void start(e.dataTransfer.files);
  }

  if (!canUpload) return null;

  return (
    <section aria-label="Belge yükle" className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "group relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-[var(--radius-card)] border-2 border-dashed px-4 text-center transition",
          compact ? "py-4 sm:flex-row sm:justify-between sm:text-left" : "py-7",
          dragging ? "border-brand-500 bg-brand-500/8" : "border-line bg-surface hover:border-brand-300",
        )}
      >
        <div className={cn("flex items-center gap-3", compact ? "" : "flex-col")}>
          <span className={cn("grid place-items-center rounded-full bg-brand-500/10 text-brand-600 transition group-hover:scale-105", compact ? "h-10 w-10" : "h-12 w-12")}>
            <UploadCloud className={compact ? "h-5 w-5" : "h-6 w-6"} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-950">{dragging ? "Bırakın, yükleyelim" : "Fiş ve faturaları buraya sürükleyin"}</p>
            <p className="text-xs text-text-muted">JPEG, PNG, WEBP ya da PDF · dosya başına 10 MB · tek seferde {MAX_FILES} dosya</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="secondary" icon={FileUp} loading={busy} onClick={() => fileRef.current?.click()} className="touch:h-11">
            Dosya seç
          </Button>
          <Button type="button" variant="ghost" icon={Camera} disabled={busy} onClick={() => cameraRef.current?.click()} className="touch:h-11">
            Kamerayla çek
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={BELGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void start(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void start(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {queue.length > 0 ? (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface" aria-live="polite">
          {queue.map((q) => (
            <li key={q.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs animate-in fade-in">
              {q.status === "uploading" || q.status === "waiting" ? (
                <Loader2 className="h-4 w-4 animate-spin text-text-faint" aria-hidden="true" />
              ) : q.status === "done" ? (
                <CheckCircle2 className="h-4 w-4 text-success-600" aria-hidden="true" />
              ) : (
                <TriangleAlert className="h-4 w-4 text-danger-600" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium text-ink-950">{q.name}</span>
              {q.status === "waiting" ? <span className="text-text-faint">Sırada</span> : null}
              {q.status === "uploading" ? <span className="text-text-muted">Yükleniyor…</span> : null}
              {q.status === "error" ? <span className="w-full text-danger-600 sm:w-auto">{q.error}</span> : null}
              {q.status === "done" && !q.ocr ? (
                <span className="text-text-muted">
                  {q.ocrSkipped === "size" ? "Fiş kutusuna eklendi · görsel fiş okuma için çok büyük (en çok ~8 MB); bilgileri elle girin" : "Fiş kutusuna eklendi"}
                </span>
              ) : null}
              {q.status === "done" && q.ocr && q.id ? (
                <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-brand-700">
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                    Öneri: {suggestionText(q.ocr)}
                  </span>
                  <ButtonLink href={entryHrefFromAttachment(q.id, q.ocr)} size="sm" variant="secondary" className="touch:h-11">
                    Fişten kayıt
                  </ButtonLink>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
