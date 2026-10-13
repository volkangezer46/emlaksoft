"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";
import Link from "@/components/ui/smart-link";
import { CalendarPlus, Share2, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type CustomerRowMenuProps = {
  customerId: string;
  canEdit: boolean;
  canDelete: boolean;
  /** Tetikleyici düğmenin öznitelikleri ve yüzü (hafif kabukla BİREBİR aynı; customer-row-delete.tsx). */
  trigger: ComponentProps<"button">;
  /** İlk etkileşim tıklama/klavye ile geldiyse menü açık bağlanır. */
  defaultOpen: boolean;
  /** Hafif düğme odaktayken bağlandıysa odak gerçek tetikleyiciye aynı karede taşınır. */
  focusTrigger: boolean;
  onPortal: (trigger: HTMLButtonElement | null) => void;
  onDelete: () => void;
};

/**
 * Müşteri satırı ⋮ menüsünün Radix gövdesi (ok tuşları, Esc, dışarı tıklama, odak dönüşü). Satır başına yüklenen
 * hafif düğme ilk etkileşimde (hover, odak, basma) bunu bağlar; liste sayfasının ilk yük paketine Radix menü +
 * floating-ui girmez. Düğme öznitelikleri hafif kabuktan gelir (aynı DOM; Radix `id`/`aria-controls` ekler).
 */
export function CustomerRowMenu({ customerId, canEdit, canDelete, trigger, defaultOpen, focusTrigger, onPortal, onDelete }: CustomerRowMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (focusTrigger) triggerRef.current?.focus();
    // Yalnız bağlanırken: hafif düğmenin odağı devralınır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <button ref={triggerRef} {...trigger} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <Link href={`/app/randevular/yeni?customer=${customerId}`} prefetch={false}>
            <CalendarPlus aria-hidden="true" /> Randevu oluştur
          </Link>
        </DropdownMenuItem>
        {canEdit ? (
          <DropdownMenuItem onSelect={() => onPortal(triggerRef.current)}>
            <Share2 aria-hidden="true" /> Müşteri portalı linki
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onSelect={onDelete}>
              <Trash2 aria-hidden="true" /> Sil…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
