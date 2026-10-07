"use client";

import { useState } from "react";
import { ExternalLink, MoreVertical, XCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ClosePortalDialog } from "./portal-dialogs";

/**
 * Portal ilan satırının ikincil eylemleri (⋮): ilanı portalda aç, ilanı kapat.
 * Satırda yalnız birincil eylem (Teyit) görünür; kapatma formu menü kapansa da açık kalır (denetimli diyalog).
 */
export function PortalRowMore({
  listingId,
  label,
  portalUrl,
  isLive,
}: {
  listingId: string;
  label: string;
  portalUrl: string | null;
  isLive: boolean;
}) {
  const [closeOpen, setCloseOpen] = useState(false);
  if (!portalUrl && !isLive) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Diğer işlemler: ${label}`}
            title="Diğer işlemler"
            className="focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-transparent text-text-muted transition hover:border-border-interactive hover:bg-surface-hover hover:text-brand-700 touch:h-11 touch:w-11"
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {portalUrl ? (
            <DropdownMenuItem asChild>
              <a href={portalUrl} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" /> İlanı portalda aç
              </a>
            </DropdownMenuItem>
          ) : null}
          {isLive ? (
            <>
              {portalUrl ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem danger onSelect={() => setCloseOpen(true)}>
                <XCircle aria-hidden="true" /> İlanı kapat…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {isLive ? <ClosePortalDialog listingId={listingId} label={label} open={closeOpen} onOpenChange={setCloseOpen} /> : null}
    </>
  );
}
