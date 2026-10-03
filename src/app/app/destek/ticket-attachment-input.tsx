"use client";

import { useState } from "react";
import { FileCheck2, Paperclip, ShieldCheck } from "lucide-react";
import {
  prepareTicketAttachmentUploadDescriptor,
  TICKET_ATTACHMENT_ACCEPT,
  TICKET_ATTACHMENT_BUCKET,
  TICKET_ATTACHMENT_MAX_FILES,
  type TicketAttachmentVisibility,
} from "@/lib/ticket-attachments";

type SessionResponse = {
  ok?: boolean;
  error?: string;
  bucket?: string;
  sessions?: Array<{
    id: string;
    path: string;
    token: string;
    fileName: string;
    mimeType: string;
    size: number;
  }>;
};

export type TicketFileUploadResult = {
  ok: boolean;
  uploaded: number;
  error?: string;
};

/**
 * 10 MB dosyaları Vercel Function gövdesinden geçirmeden private Storage'a
 * yollar; finalize endpoint'i nesneyi tekrar indirip magic-byte + SHA denetimi
 * yapmadan metadata oluşturmaz.
 */
export async function uploadTicketFiles(input: {
  ticketId: string;
  messageId?: string | null;
  visibility: TicketAttachmentVisibility;
  files: File[];
}): Promise<TicketFileUploadResult> {
  if (input.files.length === 0) return { ok: true, uploaded: 0 };
  if (input.files.length > TICKET_ATTACHMENT_MAX_FILES) {
    return { ok: false, uploaded: 0, error: `Bir defada en fazla ${TICKET_ATTACHMENT_MAX_FILES} dosya ekleyebilirsiniz.` };
  }

  for (const file of input.files) {
    const prepared = prepareTicketAttachmentUploadDescriptor({ name: file.name, type: file.type, size: file.size });
    if (!prepared.ok) return { ok: false, uploaded: 0, error: prepared.error };
  }

  try {
    const sessionResponse = await fetch("/api/ticket-attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketId: input.ticketId,
        messageId: input.messageId ?? null,
        visibility: input.visibility,
        files: input.files.map((file) => ({ name: file.name, type: file.type, size: file.size })),
      }),
    });
    const sessionJson = (await sessionResponse.json().catch(() => ({}))) as SessionResponse;
    if (!sessionResponse.ok || !sessionJson.ok || !sessionJson.sessions?.length) {
      return { ok: false, uploaded: 0, error: sessionJson.error ?? "Güvenli dosya yükleme başlatılamadı." };
    }

    // supabase-js (~240 KB) yalnız yükleme anında indirilir; sayfa açılışını şişirmez.
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const uploadedSessionIds: string[] = [];
    let uploadError: string | undefined;
    for (let index = 0; index < sessionJson.sessions.length; index += 1) {
      const session = sessionJson.sessions[index]!;
      const file = input.files[index]!;
      const { error } = await supabase.storage
        .from(sessionJson.bucket ?? TICKET_ATTACHMENT_BUCKET)
        .uploadToSignedUrl(session.path, session.token, file, {
          contentType: session.mimeType,
          cacheControl: "0",
        });
      if (error) {
        uploadError = "Dosyalardan biri güvenli depoya yüklenemedi.";
        continue;
      }
      uploadedSessionIds.push(session.id);
    }

    if (uploadedSessionIds.length === 0) {
      return { ok: false, uploaded: 0, error: uploadError ?? "Dosyalar yüklenemedi." };
    }

    const finalizeResponse = await fetch("/api/ticket-attachments/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionIds: uploadedSessionIds }),
    });
    const finalizeJson = (await finalizeResponse.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      results?: Array<{ ok: boolean; error?: string }>;
    };
    const uploaded = finalizeJson.results?.filter((result) => result.ok).length ?? 0;
    const firstError = finalizeJson.results?.find((result) => !result.ok)?.error;
    if (!finalizeResponse.ok || !finalizeJson.ok || uploadError) {
      return {
        ok: false,
        uploaded,
        error:
          firstError ??
          uploadError ??
          finalizeJson.error ??
          (uploaded > 0 ? "Bazı dosyalar yüklendi; bazıları güvenlik denetiminden geçmedi." : "Dosya doğrulanamadı."),
      };
    }
    return { ok: true, uploaded };
  } catch {
    return { ok: false, uploaded: 0, error: "Dosya yükleme bağlantısı kurulamadı." };
  }
}

export function TicketAttachmentInput({
  id,
  disabled,
  compact = false,
}: {
  id: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className={`focus-ring press inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 ${
          compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-xs"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        <Paperclip className="h-3.5 w-3.5" aria-hidden /> Dosya ekle
      </label>
      <input
        id={id}
        name="files"
        type="file"
        multiple
        accept={TICKET_ATTACHMENT_ACCEPT}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          setError(undefined);
          if (files.length > TICKET_ATTACHMENT_MAX_FILES) {
            event.currentTarget.value = "";
            setNames([]);
            setError(`En fazla ${TICKET_ATTACHMENT_MAX_FILES} dosya seçebilirsiniz.`);
            return;
          }
          for (const file of files) {
            const checked = prepareTicketAttachmentUploadDescriptor({ name: file.name, type: file.type, size: file.size });
            if (!checked.ok) {
              event.currentTarget.value = "";
              setNames([]);
              setError(checked.error);
              return;
            }
          }
          setNames(files.map((file) => file.name));
        }}
      />
      {names.length ? (
        <div className="flex flex-wrap gap-1.5" aria-live="polite">
          {names.map((name) => (
            <span key={name} className="inline-flex max-w-56 items-center gap-1 rounded-full bg-mint-500/10 px-2 py-1 text-xs font-semibold text-mint-700">
              <FileCheck2 className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{name}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-text-faint">
          <ShieldCheck className="h-3 w-3 text-mint-600" aria-hidden /> PDF, JPEG, PNG, WebP, TXT veya CSV · en fazla 10 MB · 5 dosya
        </p>
      )}
      {error ? <p className="text-xs font-medium text-danger-600" role="alert">{error}</p> : null}
    </div>
  );
}
