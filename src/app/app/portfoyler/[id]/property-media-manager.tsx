"use client";

import { useRef, useState, useTransition } from "react";
import { useActionState } from "react";
import Image from "next/image";
import { Film, ImagePlus, Link2, Loader2, Star, Trash2, Upload, View } from "lucide-react";
import {
  addPropertyMediaUrl,
  deletePropertyMedia,
  setCoverPropertyMedia,
  uploadPropertyMedia,
  type MediaResult,
} from "@/app/actions/property-media";

export type MediaItem = {
  id: string;
  kind: "image" | "video" | "tour";
  storage_path: string | null;
  external_url: string | null;
  is_cover: boolean;
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const images = media.filter((m) => m.kind === "image");
  const links = media.filter((m) => m.kind !== "image");

  const [urlState, urlAction, urlPending] = useActionState<MediaResult, FormData>(
    addPropertyMediaUrl,
    {},
  );

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    // Paralel yükleme (3'lü gruplar) — 10 fotoğraf seri ~30sn yerine ~10sn
    const list = Array.from(files);
    const CHUNK = 3;
    for (let i = 0; i < list.length; i += CHUNK) {
      const results = await Promise.all(
        list.slice(i, i + CHUNK).map((file) => {
          const fd = new FormData();
          fd.set("property_id", propertyId);
          fd.set("file", file);
          return uploadPropertyMedia(fd);
        }),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        setUploadError(failed.error);
        break;
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

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
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={onFileChange}
            />
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
        {uploadError ? <p className="mb-3 text-sm font-medium text-danger-500">{uploadError}</p> : null}

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
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-ink-950/80 px-2 py-0.5 text-[10px] font-bold text-white">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Kapak
                  </span>
                ) : null}
                {canEdit ? (
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-ink-950/80 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
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
                        className="grid h-7 w-7 place-items-center rounded-[8px] bg-white/90 text-ink-950 hover:bg-white"
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
                      className="grid h-7 w-7 place-items-center rounded-[8px] bg-danger-500 text-white hover:bg-danger-600"
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
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border border-line text-danger-500 hover:border-danger-500/40"
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
    </section>
  );
}
