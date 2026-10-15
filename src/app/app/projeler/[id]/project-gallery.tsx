"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormSelect } from "@/components/ui/form-controls";
import { useToast } from "@/components/app/toast-provider";
import { deleteProjectMedia, setProjectMediaCover, uploadProjectMedia } from "@/app/actions/project-sales";

export type GalleryItem = { id: string; kind: "image" | "floorplan"; url: string | null; isCover: boolean; caption: string | null };

const MAX_EDGE = 1920;

/** Yüklemeden önce tarayıcıda küçült (≤1920 px, JPEG %85): mobil veride hızlı, sunucuya ≤4 MB. */
async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("blob");
  return { blob, width, height };
}

/**
 * PF-04 — Proje galerisi (fotoğraf + kat planı). Görseller özel kovada; panelde ve paylaşım sayfasında kısa ömürlü
 * imzalı bağlantıyla görünür. İlk fotoğraf kapak olur; kapak ve silme düğmeleri her zaman görünür (dokunmatik).
 */
export function ProjectGallery({
  projectId,
  items,
  available,
  canEdit,
}: {
  projectId: string;
  items: GalleryItem[];
  available: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [kind, setKind] = useState<"image" | "floorplan">("image");
  const [pending, start] = useTransition();

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, 20);
    let ok = 0;
    for (let i = 0; i < list.length; i += 1) {
      setBusy(`${i + 1}/${list.length} yükleniyor…`);
      try {
        const { blob, width, height } = await shrink(list[i]!);
        const fd = new FormData();
        fd.set("project_id", projectId);
        fd.set("kind", kind);
        fd.set("width", String(width));
        fd.set("height", String(height));
        fd.set("file", new File([blob], "gorsel.jpg", { type: "image/jpeg" }));
        const res = await uploadProjectMedia(fd);
        if (res.error) {
          push(`${list[i]!.name}: ${res.error}`, "err");
          if (res.error.includes("etkin değil")) break;
        } else ok += 1;
      } catch {
        push(`${list[i]!.name}: görsel okunamadı (JPEG, PNG ya da WebP seçin)`, "err");
      }
    }
    setBusy(null);
    if (ok > 0) {
      push(`${ok} görsel eklendi`, "ok");
      router.refresh();
    }
  }

  const act = (fn: () => Promise<{ error?: string }>, okMsg: string) =>
    start(async () => {
      const res = await fn();
      if (res.error) push(res.error, "err");
      else {
        push(okMsg, "ok");
        router.refresh();
      }
    });

  return (
    <section aria-labelledby="proje-galeri" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="proje-galeri" className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
            <ImageIcon className="h-4 w-4 text-brand-600" /> Galeri
          </h2>
          <p className="mt-1 text-sm text-text-muted">Proje görselleri ve kat planları paylaşım sayfasında görünür.</p>
        </div>
        {available && canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <FormSelect
              aria-label="Görsel türü"
              value={kind}
              onChange={(e) => setKind(e.target.value === "floorplan" ? "floorplan" : "image")}
              className="w-auto"
            >
              <option value="image">Fotoğraf</option>
              <option value="floorplan">Kat planı</option>
            </FormSelect>
            <label className="focus-within:ring-brand-300 btn btn-primary inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-xs font-bold focus-within:ring-2 touch:h-11">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
              {busy ?? "Görsel ekle"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={Boolean(busy)}
                className="sr-only"
                onChange={(e) => {
                  void upload(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        ) : null}
      </div>

      {!available ? (
        <p className="mt-3 rounded-[var(--radius-control)] bg-amber-400/12 px-3 py-2 text-sm font-medium text-amber-700">
          Bu özellik bu ortamda henüz etkin değil (veritabanı güncellemesi bekleniyor).
        </p>
      ) : items.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
          Henüz görsel yok. Cephe, örnek daire ve kat planı görselleri satış hızını belirgin artırır.
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m) => (
            <li key={m.id} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-canvas">
              <div className="relative aspect-[4/3] bg-line/40">
                {m.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- özel kovadan kısa ömürlü imzalı adres (next/image önbelleği imzayı tutamaz)
                  <img src={m.url} alt={m.caption ?? (m.kind === "floorplan" ? "Kat planı" : "Proje görseli")} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full place-items-center text-xs text-text-faint">Görsel yüklenemedi</span>
                )}
                {m.isCover ? (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-ink-950/75 px-2 py-0.5 text-xs font-bold text-white">
                    <Star className="h-3 w-3" fill="currentColor" /> Kapak
                  </span>
                ) : m.kind === "floorplan" ? (
                  <span className="absolute left-2 top-2 rounded-full bg-surface/90 px-2 py-0.5 text-xs font-bold text-ink-950">Kat planı</span>
                ) : null}
              </div>
              {canEdit ? (
                <div className="flex items-center justify-end gap-1 p-1.5">
                  {!m.isCover && m.kind === "image" ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={pending}
                      onClick={() => act(() => setProjectMediaCover(projectId, m.id), "Kapak değişti")}
                    >
                      <Star /> Kapak yap
                    </Button>
                  ) : null}
                  <ConfirmDialog
                    title="Görsel silinsin mi?"
                    description="Görsel galeriden ve paylaşım sayfasından kaldırılır."
                    confirmLabel="Sil"
                    onConfirm={async () => {
                      const res = await deleteProjectMedia(projectId, m.id);
                      if (res.error) push(res.error, "err");
                      else router.refresh();
                    }}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label="Görseli sil">
                        <Trash2 className="text-danger-500" />
                      </Button>
                    }
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
