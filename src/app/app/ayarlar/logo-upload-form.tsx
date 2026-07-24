"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { Building2, Check, Loader2, Trash2, Upload } from "lucide-react";
import { uploadTenantLogo, deleteTenantLogo } from "@/app/actions/tenant-logo";

export function LogoUploadForm({
  currentUrl,
  officeName,
}: {
  currentUrl: string | null;
  officeName: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok?: boolean; error?: string } | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Local preview
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    // Upload
    const fd = new FormData();
    fd.set("logo", file);
    setResult(null);
    startTransition(async () => {
      const res = await uploadTenantLogo(fd);
      setResult(res);
      if (res.ok && res.url) setPreview(res.url);
      if (res.error) setPreview(currentUrl); // revert preview on error
    });
  }

  function handleDelete() {
    if (!confirm("Logo silinsin mi?")) return;
    setResult(null);
    startTransition(async () => {
      const res = await deleteTenantLogo();
      setResult(res);
      if (res.ok) setPreview(null);
    });
  }

  return (
    <div className="flex items-center gap-5">
      {/* Önizleme */}
      <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-line bg-canvas">
        {preview ? (
          <Image
            src={preview}
            alt={`${officeName} logosu`}
            fill
            className="object-contain p-1"
            unoptimized={preview.startsWith("data:")}
          />
        ) : (
          <Building2 className="h-8 w-8 text-text-faint" />
        )}
        {pending && (
          <div className="absolute inset-0 flex items-center justify-center bg-canvas/80">
            <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
          </div>
        )}
      </div>

      {/* Aksiyonlar */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink-950">Ofis logosu</p>
        <p className="text-xs text-text-muted">PNG, JPG, WebP veya SVG · maks. 2 MB</p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink-950 transition hover:border-brand-300 hover:bg-surface disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            {preview ? "Değiştir" : "Yükle"}
          </button>

          {preview && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-2 text-xs font-semibold text-danger-500 transition hover:border-danger-500/30 hover:bg-danger-500/5 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Sil
            </button>
          )}
        </div>

        {result?.ok && (
          <p className="flex items-center gap-1 text-xs font-semibold text-mint-600">
            <Check className="h-3.5 w-3.5" /> Kaydedildi
          </p>
        )}
        {result?.error && (
          <p className="text-xs text-danger-500">{result.error}</p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
        className="sr-only"
        onChange={handleFile}
        aria-label="Logo yükle"
      />
    </div>
  );
}
