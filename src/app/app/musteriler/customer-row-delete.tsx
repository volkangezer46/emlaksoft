"use client";

import { useEffect, useRef, useState, useTransition, type ComponentProps, type ComponentType } from "react";
import { MoreVertical } from "lucide-react";
import { deleteCustomer, getCustomerDeleteImpact, type CustomerDeleteImpact } from "@/app/actions/customers";
import { useInlinePanel } from "@/components/ui/inline-panel";
import { runWhenIdle } from "@/lib/idle";
import type { CustomerRowMenuProps } from "./customer-row-menu";
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

/*
 * Radix DropdownMenu gövdesi (menü + floating-ui + odak/dışarı tıklama katmanları) liste sayfasının ilk yük paketine
 * girmez: satırda AYNI öznitelikli hafif düğme çizilir, gövde boşta bir kez önceden iner ve ilk etkileşimde
 * (hover, odak, basma) bağlanır. Basma/klavye ile gelindiyse menü açık bağlanır; odaktaysa odak aynı karede gerçek
 * tetikleyiciye taşınır. Yüklenince açma/kapama, ok tuşları, Esc ve odak dönüşü tamamen Radix'tedir.
 */
let LoadedMenu: ComponentType<CustomerRowMenuProps> | null = null;
let menuPromise: Promise<ComponentType<CustomerRowMenuProps>> | null = null;
let idleScheduled = false;

function loadMenu(): Promise<ComponentType<CustomerRowMenuProps>> {
  menuPromise ??= import("./customer-row-menu").then(
    (m) => (LoadedMenu = m.CustomerRowMenu),
    (error: unknown) => {
      menuPromise = null; // ağ hatasında sonraki etkileşim yeniden dener
      throw error;
    },
  );
  return menuPromise;
}

type MenuMount = { Menu: ComponentType<CustomerRowMenuProps>; open: boolean; focus: boolean };

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
  const [mounted, setMounted] = useState<MenuMount | null>(null);
  const lightRef = useRef<HTMLButtonElement>(null);
  const want = useRef({ open: false });
  useEffect(() => {
    if (idleScheduled) return;
    idleScheduled = true;
    return runWhenIdle(() => void loadMenu().catch(() => undefined));
  }, []);
  if (del.confirming) return <DeleteConfirm customerId={customerId} impact={del.impact} onCancel={del.cancel} />;

  // Radix tetikleyicisinin çocuğuna verilen öznitelikler (hafif düğme ve gerçek tetikleyici AYNI).
  const trigger: ComponentProps<"button"> = {
    type: "button",
    disabled: del.pending,
    "aria-label": `Diğer işlemler: ${name}`,
    title: "Diğer işlemler",
    className:
      "focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-transparent text-text-muted transition hover:border-border-interactive hover:bg-surface-hover hover:text-brand-700 disabled:opacity-60 touch:h-11 touch:w-11",
    children: <MoreVertical className="h-4 w-4" aria-hidden="true" />,
  };

  if (mounted) {
    const { Menu } = mounted;
    return (
      <Menu
        customerId={customerId}
        canEdit={canEdit}
        canDelete={canDelete}
        trigger={trigger}
        defaultOpen={mounted.open}
        focusTrigger={mounted.focus}
        onPortal={(el) => {
          setPortalTarget({ id: customerId, name, phone });
          openPanel(el);
        }}
        onDelete={() => {
          // Onaydan "Vazgeç" ile dönülünce menü (eskisi gibi) kapalı bağlanır.
          setMounted((cur) => cur && { ...cur, open: false, focus: false });
          del.begin();
        }}
      />
    );
  }

  /**
   * Gövdeyi bağla: yüklüyse aynı olay içinde, değilse yüklenince (satır hâlâ hafifse). Yüklenmeyi beklerken gelen
   * istekler birleşir (ör. odak + Enter → açık bağlanır). Odak, bağlandığı anda hafif düğmedeyse gerçek tetikleyiciye geçer.
   */
  const mount = (open: boolean) => {
    want.current.open ||= open;
    const settle = (Menu: ComponentType<CustomerRowMenuProps>) => {
      const el = lightRef.current;
      const focus = Boolean(el && el.ownerDocument.activeElement === el);
      const req = want.current.open;
      want.current.open = false;
      setMounted((cur) => cur ?? { Menu, open: req, focus });
    };
    if (LoadedMenu) {
      settle(LoadedMenu);
      return;
    }
    void loadMenu()
      .then(settle)
      .catch(() => undefined);
  };

  return (
    <button
      ref={lightRef}
      {...trigger}
      aria-haspopup="menu"
      aria-expanded={false}
      data-state="closed"
      onPointerEnter={(e) => {
        // Dokunmada enter ile basma aynı harekettir: basma (aşağıda) menüyü açık bağlar.
        if (e.pointerType !== "touch") mount(false);
      }}
      onFocus={() => mount(false)}
      onPointerDown={(e) => {
        // Radix ile aynı: yalnız birincil tuş, Ctrl'siz (macOS bağlam menüsü) basış menüyü açar; odak düğmeye geçmez.
        if (e.button === 0 && !e.ctrlKey) {
          e.preventDefault();
          mount(true);
        }
      }}
      onKeyDown={(e) => {
        // Radix ile aynı tuşlar: Enter / Boşluk / Aşağı ok menüyü açar.
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          mount(true);
        }
      }}
    />
  );
}
