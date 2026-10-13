"use client";

import Link from "@/components/ui/smart-link";
import { FilePlus2, FileText, Image as ImageIcon, Inbox, Link2, ReceiptText, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AttachmentPreviewButton } from "./attachment-preview";
import { LinkAttachmentButton } from "./link-dialog";
import { openEntryFromAttachment, suggestionText, type OcrSuggestion } from "./upload-dropzone";

/**
 * Fiş kutusu ve tüm belgeler listesi (FN5). Fiş kutusu = harekete ya da açık kaleme bağlı OLMAYAN ekler.
 * Her kart: önizle, bağla, "Fişten kayıt" (yeni kayıt penceresi; kayıt yalnız Kaydet ile) ve bağlıysa kayda gider;
 * gelir hareketine bağlıysa "Fatura kes" kısayolu (mevcut e-Fatura serbest fatura akışı, önceden doldurulmuş).
 */

export type InboxLink = {
  kind: "entry" | "open_item";
  title: string;
  amount: number | null;
  incoming: boolean;
  href: string;
  invoiceHref: string | null;
};

export type InboxItem = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
  ocrStatus: string;
  ocr: OcrSuggestion | null;
  link: InboxLink | null;
};

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);
const dateTimeFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" });

function sizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function ReceiptInbox({
  items,
  canLink,
  canCreate,
}: {
  items: InboxItem[];
  canLink: boolean;
  canCreate: boolean;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Belgeler">
      {items.map((it) => (
        <InboxCard key={it.id} item={it} canLink={canLink} canCreate={canCreate} />
      ))}
    </ul>
  );
}

function InboxCard({ item, canLink, canCreate }: { item: InboxItem; canLink: boolean; canCreate: boolean }) {
  const isImage = item.fileType.startsWith("image/");
  const suggestion = suggestionText(item.ocr);
  const Icon = isImage ? ImageIcon : FileText;
  return (
    <li
      className={cn(
        "group flex flex-col gap-3 rounded-[var(--radius-card)] border bg-surface p-3 shadow-[var(--elev-1)] transition hover:-translate-y-0.5 hover:shadow-[var(--elev-3)] motion-reduce:transform-none",
        item.link ? "border-line" : "border-brand-300/60",
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-control)]", isImage ? "tone-info" : "tone-neutral")}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-950" title={item.fileName}>
            {item.fileName}
          </p>
          <p className="text-xs text-text-muted">
            {[dateTimeFmt.format(new Date(item.createdAt)), sizeLabel(item.fileSize), isImage ? "Görsel" : "PDF"].filter(Boolean).join(" · ")}
          </p>
        </div>
        {item.link ? (
          <Badge variant="success" size="sm" dot>
            Bağlı
          </Badge>
        ) : (
          <Badge variant="info" size="sm" dot>
            Kutuda
          </Badge>
        )}
      </div>

      {suggestion ? (
        <p className="flex items-start gap-1.5 rounded-[var(--radius-control)] bg-brand-500/8 px-2.5 py-1.5 text-xs text-brand-700">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">Okunan öneri:</span> {suggestion}
          </span>
        </p>
      ) : item.ocrStatus === "failed" ? (
        <p className="text-xs text-text-faint">Fiş okunamadı; bilgileri elle girebilirsiniz.</p>
      ) : null}

      {item.link ? (
        <Link href={item.link.href} className="focus-ring flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs hover:border-brand-300">
          {item.link.kind === "entry" ? <ReceiptText className="h-4 w-4 text-text-faint" aria-hidden="true" /> : <Link2 className="h-4 w-4 text-text-faint" aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate">
            <span className="text-text-muted">{item.link.kind === "entry" ? "Hareket: " : "Açık kalem: "}</span>
            <span className="font-semibold text-ink-950">{item.link.title}</span>
          </span>
          {item.link.amount != null ? (
            <span className={cn("numeric shrink-0 font-semibold", item.link.incoming ? "text-success-600" : "text-ink-950")}>{money(item.link.amount)}</span>
          ) : null}
        </Link>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <AttachmentPreviewButton id={item.id} name={item.fileName} />
        {!item.link && canLink ? <LinkAttachmentButton id={item.id} name={item.fileName} /> : null}
        {!item.link && canCreate ? (
          <Button type="button" size="sm" variant={suggestion ? "primary" : "secondary"} icon={Inbox} onClick={() => openEntryFromAttachment(item.id, item.ocr)} className="touch:h-11">
            Fişten kayıt
          </Button>
        ) : null}
        {item.link?.invoiceHref ? (
          <ButtonLink href={item.link.invoiceHref} size="sm" variant="secondary" icon={FilePlus2} className="touch:h-11">
            Fatura kes
          </ButtonLink>
        ) : null}
      </div>
    </li>
  );
}
