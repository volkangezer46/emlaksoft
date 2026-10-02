"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  LockKeyhole,
  Paperclip,
  Trash2,
} from "lucide-react";
import {
  deleteTicketAttachment,
  type TicketAttachmentActionResult,
} from "@/app/actions/ticket-attachments";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  attachmentDownloadHref,
  formatAttachmentSize,
  type TicketAttachmentMime,
  type TicketAttachmentVisibility,
} from "@/lib/ticket-attachments";
import { cn } from "@/lib/utils";

export type TicketAttachmentDisplay = {
  id: string;
  message_id: string | null;
  uploaded_by: string | null;
  uploaded_by_kind: "tenant" | "staff" | "system";
  visibility: TicketAttachmentVisibility;
  file_name: string;
  mime_type: TicketAttachmentMime;
  file_size: number;
  scan_status: "signature_verified" | "blocked";
  created_at: string;
};

function FileKindIcon({ mime }: { mime: TicketAttachmentMime }) {
  if (mime.startsWith("image/")) return <FileImage className="h-4 w-4" aria-hidden />;
  if (mime === "text/csv") return <FileSpreadsheet className="h-4 w-4" aria-hidden />;
  return <FileText className="h-4 w-4" aria-hidden />;
}

function AttachmentRow({
  attachment,
  canDelete,
  compact,
}: {
  attachment: TicketAttachmentDisplay;
  canDelete: boolean;
  compact: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<TicketAttachmentActionResult, FormData>(
    deleteTicketAttachment,
    {},
  );

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state.ok]);

  const internal = attachment.visibility === "internal";
  return (
    <li
      className={cn(
        "group flex min-w-0 items-center gap-2 rounded-[10px] border px-2.5 py-2",
        internal ? "border-amber-400/30 bg-amber-400/[0.06]" : "border-line bg-canvas/65",
        compact ? "max-w-full sm:max-w-80" : "w-full",
      )}
    >
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-[8px]",
          internal ? "bg-amber-400/15 text-amber-700" : "bg-brand-600/10 text-brand-700",
        )}
      >
        <FileKindIcon mime={attachment.mime_type} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-xs font-semibold text-ink-950">{attachment.file_name}</span>
          {internal ? <LockKeyhole className="h-3 w-3 shrink-0 text-amber-700" aria-label="İç ek" /> : null}
        </span>
        <span className="block text-[10px] text-text-faint">
          {formatAttachmentSize(attachment.file_size)} · güvenlik doğrulandı
        </span>
        {state.error ? (
          <span className="mt-0.5 block text-[10px] font-semibold text-danger-600" role="alert">
            {state.error}
          </span>
        ) : null}
      </span>
      <a
        href={attachmentDownloadHref(attachment.id)}
        className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-text-muted transition hover:bg-brand-600/10 hover:text-brand-700"
        aria-label={`${attachment.file_name} dosyasını indir`}
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
      </a>
      {canDelete ? (
        <ConfirmDialog
          trigger={
            <button
              type="button"
              disabled={pending}
              className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-600 disabled:opacity-50"
              aria-label={`${attachment.file_name} dosyasını sil`}
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
            </button>
          }
          title="Dosya silinsin mi?"
          description={`“${attachment.file_name}” güvenli depodan kaldırılacak. Bu işlem geri alınamaz.`}
          confirmLabel="Dosyayı sil"
          tone="danger"
          formAction={action}
          hiddenFields={{ attachment_id: attachment.id }}
        />
      ) : null}
    </li>
  );
}

export function TicketAttachmentList({
  attachments,
  currentUserId,
  canDeleteAll = false,
  compact = true,
  label = "Ek dosyalar",
}: {
  attachments: TicketAttachmentDisplay[];
  currentUserId?: string | null;
  canDeleteAll?: boolean;
  compact?: boolean;
  label?: string;
}) {
  const visible = attachments.filter(
    (attachment) => attachment.scan_status === "signature_verified",
  );
  if (visible.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.07em] text-text-faint">
        <Paperclip className="h-3 w-3" aria-hidden /> {label} · {visible.length}
      </p>
      <ul className={cn("gap-2", compact ? "flex flex-wrap" : "grid") }>
        {visible.map((attachment) => (
          <AttachmentRow
            key={attachment.id}
            attachment={attachment}
            compact={compact}
            canDelete={canDeleteAll || Boolean(currentUserId && attachment.uploaded_by === currentUserId)}
          />
        ))}
      </ul>
    </div>
  );
}
