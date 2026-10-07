"use client";

import { useRef, useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { CalendarPlus, MoreVertical, Share2, Trash2 } from "lucide-react";
import { deleteCustomer, getCustomerDeleteImpact, type CustomerDeleteImpact } from "@/app/actions/customers";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useInlinePanel } from "@/components/ui/inline-panel";
import { CUSTOMER_PORTAL_PANEL_ID, setPortalTarget } from "./customer-portal-panel";
import { describeDeleteImpact } from "./delete-impact";

/** Satır içi silme onayı (bağlı kayıt etkisiyle). */
function DeleteConfirm({ customerId, impact, onCancel }: { customerId: string; impact: CustomerDeleteImpact | null; onCancel: () => void }) {
  const lines = describeDeleteImpact(impact);
  return (
    <div className="flex flex-col items-end gap-1">
      {lines.length > 0 ? <p className="max-w-[14rem] text-right text-xs text-danger-500">Bağlı: {lines.join(", ")}</p> : null}
      <div className="flex items-center gap-1">
        <form action={deleteCustomer}>
          <input type="hidden" name="id" value={customerId} />
          <input type="hidden" name="confirm_linked" value="1" />
          <button type="submit" className="rounded-[var(--radius-control)] bg-danger-500 px-2 py-1 text-xs font-bold text-white hover:bg-danger-600">
            Sil
          </button>
        </form>
        <button
          type="button"
          onClick={onCancel}
          autoFocus
          className="rounded-[var(--radius-control)] px-1.5 py-1 text-xs font-semibold text-text-muted hover:text-ink-950"
        >
          Vazgeç
        </button>
      </div>
    </div>
  );
}

function useCustomerDelete(customerId: string) {
  const [confirming, setConfirming] = useState(false);
  const [impact, setImpact] = useState<CustomerDeleteImpact | null>(null);
  const [pending, startTransition] = useTransition();
  const begin = () =>
    startTransition(async () => {
      setImpact(await getCustomerDeleteImpact([customerId]));
      setConfirming(true);
    });
  return { confirming, impact, pending, begin, cancel: () => setConfirming(false) };
}

/**
 * Müşteri satırının ikincil eylemleri (⋮): randevu oluştur, müşteri portalı linki, sil. Satırda yalnız birincil
 * eylemler (Aç, Ara, WhatsApp) görünür; silme onayı ⋮'nin yerinde satır içi açılır (popup yok).
 */
export function CustomerRowMore({
  customerId,
  name,
  phone,
  canEdit,
  canDelete,
}: {
  customerId: string;
  name: string;
  phone: string | null;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const del = useCustomerDelete(customerId);
  const { openPanel } = useInlinePanel(CUSTOMER_PORTAL_PANEL_ID);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (del.confirming) return <DeleteConfirm customerId={customerId} impact={del.impact} onCancel={del.cancel} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={del.pending}
          aria-label={`Diğer işlemler: ${name}`}
          title="Diğer işlemler"
          className="focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-transparent text-text-muted transition hover:border-border-interactive hover:bg-surface-hover hover:text-brand-700 disabled:opacity-60 touch:h-11 touch:w-11"
        >
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <Link href={`/app/randevular/yeni?customer=${customerId}`} prefetch={false}>
            <CalendarPlus aria-hidden="true" /> Randevu oluştur
          </Link>
        </DropdownMenuItem>
        {canEdit ? (
          <DropdownMenuItem
            onSelect={() => {
              setPortalTarget({ id: customerId, name, phone });
              openPanel(triggerRef.current);
            }}
          >
            <Share2 aria-hidden="true" /> Müşteri portalı linki
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onSelect={del.begin}>
              <Trash2 aria-hidden="true" /> Sil…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
