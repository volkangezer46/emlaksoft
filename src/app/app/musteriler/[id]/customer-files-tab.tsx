"use client";

import { useState, useRef } from "react";
import { Upload, Loader2, FileText, Image, Trash2, Download } from "lucide-react";
import { uploadCustomerFile, deleteCustomerFile } from "@/app/actions/customer-files";
import { useToast } from "@/components/app/toast-provider";
import { useRouter } from "next/navigation";

type FileRow = {
  id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  storage_path: string;
  label: string | null;
  created_at: string;
  uploader: { full_name?: string } | { full_name?: string }[] | null;
};

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i)) + " " + sizes[i];
}

function uploaderName(u: FileRow["uploader"]) {
  if (!u) return "Sistem";
  return Array.isArray(u) ? u[0]?.full_name ?? "—" : u.full_name ?? "—";
}

export function CustomerFilesTab({ customerId, files }: { customerId: string; files: FileRow[] }) {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { push } = useToast();
  const router = useRouter();

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const fd = new FormData();
    fd.set("customer_id", customerId);
    fd.set("file", file);

    const res = await uploadCustomerFile(fd);
    setUploading(false);

    if (res.ok) {
      push("Dosya yüklendi", "ok");
      router.refresh();
      if (fileInputRef.current) fileInputRef.current.value = "";
    } else {
      push(res.error ?? "Yükleme başarısız", "err");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Bu dosya silinsin mi?")) return;
    setDeleting(id);
    const res = await deleteCustomerFile(id);
    setDeleting(null);
    if (res.ok) {
      push("Dosya silindi", "ok");
      router.refresh();
    } else {
      push(res.error ?? "Silme başarısız", "err");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold text-ink-950">Dosyalar</h3>
          <p className="text-xs text-text-muted">Kimlik, sözleşme, fotoğraf ve belgeler</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700">
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Yükleniyor…
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Dosya yükle
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
            disabled={uploading}
            onChange={handleUpload}
          />
        </label>
      </div>

      {files.length === 0 ? (
        <div className="grid place-items-center rounded-[16px] border border-line bg-canvas px-6 py-12 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-[14px] bg-brand-600/10 text-brand-600">
            <FileText className="h-7 w-7" />
          </span>
          <h4 className="mt-3 font-display text-base font-bold text-ink-950">Henüz dosya yok</h4>
          <p className="mt-1 text-sm text-text-muted">İlk belgeyi yükleyin</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((f) => {
            const isImage = f.file_type.startsWith("image/");
            const Icon = isImage ? Image : FileText;
            return (
              <div
                key={f.id}
                className="relative overflow-hidden rounded-[14px] border border-line bg-surface p-4 transition hover:border-brand-300"
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-brand-600/10 text-brand-600">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-950" title={f.file_name}>
                      {f.file_name}
                    </p>
                    {f.label ? <p className="mt-0.5 text-xs text-text-muted">{f.label}</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-text-faint">
                      <span>{formatBytes(f.file_size)}</span>
                      <span>·</span>
                      <span>{uploaderName(f.uploader)}</span>
                      <span>·</span>
                      <span>{new Date(f.created_at).toLocaleDateString("tr-TR")}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <a
                    href={`/api/customer-files/${f.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-[8px] border border-line bg-canvas px-2.5 py-1.5 text-xs font-semibold text-ink-950 hover:border-brand-300"
                  >
                    <Download className="h-3.5 w-3.5" />
                    İndir
                  </a>
                  <button
                    type="button"
                    disabled={deleting === f.id}
                    onClick={() => handleDelete(f.id)}
                    className="inline-flex items-center gap-1 rounded-[8px] border border-line bg-canvas px-2.5 py-1.5 text-xs font-semibold text-danger-600 hover:border-danger-300 disabled:opacity-50"
                  >
                    {deleting === f.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Sil
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
