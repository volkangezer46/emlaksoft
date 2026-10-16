"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pressOpenHandlers } from "@/components/app/tap-veil";

/**
 * Mobil menü çekmecesinin AÇIK durumu (lg altı). Eskiden hamburger düğmesi kenar çubuğu bileşeninde `fixed`
 * çiziliyordu ve üstteki şeritlerle (e-posta doğrulama, demo/deneme) çakışıyordu. Artık düğme üst çubuğun İÇİNDE
 * (`MobileMenuTrigger`), çekmece kenar çubuğunda kalır; ikisi bu bağlamla aynı durumu paylaşır.
 *
 * Kenar çubuğu (`app-sidebar`, `admin-sidebar`) çekmece gövdesini tembel yüklediği için `register` ile kendi
 * işleyicilerini kaydeder; düğme bu işleyicileri çağırır (kayıt yoksa yalnız durum açılır):
 *  - `warm`: parçayı önceden indir (hover / odak / dokunma),
 *  - `press`: dokunma ANINDA (pointerdown) hafif örtü çiz (B032; Radix gövdesi tıklamadan sonra bağlanır),
 *  - `open`: açmayı kendisi yönetir (örtü bu karede çizildiyse ağır bağlamayı boyamadan sonraya bırakır),
 *  - `mount`: yalnız gövdeyi bağla (`open` yoksa durum burada açılır).
 */
type Handlers = { mount?: () => void; warm?: () => void; press?: () => void; open?: () => void };

type MobileMenuState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Çekmeceyi açar; odak kapanışta açan öğeye (`openerRef`) döner. */
  requestOpen: () => void;
  warm: () => void;
  /** Dokunma anı (pointerdown): örtü + ısıtma. */
  press: () => void;
  openerRef: RefObject<HTMLElement | null>;
  register: (handlers: Handlers) => () => void;
};

const MobileMenuContext = createContext<MobileMenuState | null>(null);

export function MobileMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const handlersRef = useRef<Handlers>({});
  // Kenar çubuğu henüz bağlanmadan dokunulduysa çekmece kayıt anında yüklenir.
  const pendingMountRef = useRef(false);
  const requestOpen = useCallback(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const h = handlersRef.current;
    if (h.open) {
      h.open();
      return;
    }
    if (h.mount) h.mount();
    else pendingMountRef.current = true;
    setOpen(true);
  }, []);
  const warm = useCallback(() => handlersRef.current.warm?.(), []);
  const press = useCallback(() => {
    const h = handlersRef.current;
    h.warm?.();
    h.press?.();
  }, []);
  const register = useCallback((handlers: Handlers) => {
    handlersRef.current = handlers;
    if (pendingMountRef.current && handlers.mount) {
      pendingMountRef.current = false;
      handlers.mount();
    }
    return () => {
      if (handlersRef.current === handlers) handlersRef.current = {};
    };
  }, []);
  const value = useMemo(() => ({ open, setOpen, requestOpen, warm, press, openerRef, register }), [open, requestOpen, warm, press, register]);
  return <MobileMenuContext.Provider value={value}>{children}</MobileMenuContext.Provider>;
}

/** Sağlayıcı dışında (ör. tek başına test) yerel durumla çalışır; düğme yine de çekmeceyi açabilir. */
export function useMobileMenu(): MobileMenuState {
  const ctx = useContext(MobileMenuContext);
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const handlersRef = useRef<Handlers>({});
  const local = useMemo<MobileMenuState>(
    () => ({
      open,
      setOpen,
      requestOpen: () => {
        openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const h = handlersRef.current;
        if (h.open) {
          h.open();
          return;
        }
        h.mount?.();
        setOpen(true);
      },
      warm: () => handlersRef.current.warm?.(),
      press: () => {
        handlersRef.current.warm?.();
        handlersRef.current.press?.();
      },
      openerRef,
      register: (handlers) => {
        handlersRef.current = handlers;
        return () => {
          handlersRef.current = {};
        };
      },
    }),
    [open],
  );
  return ctx ?? local;
}

/**
 * Üst çubuktaki hamburger (yalnız çekmece kırılımının altında). /app: üst çubuk konumlandırılmış (`sticky`, çentik
 * bandının altına yapışır) olduğundan mutlak konumla sol kenarda dikey ortalanır; başlığın sol dolgusu bu düğmeye
 * ayrılmıştır. /admin: üst çubuk (h-16) ayrı bileşendir; düğme layout'taki sıfır yükseklikli yapışkan kapta aynı sol
 * boşluğa oturur ve üst çubuk gibi durum çubuğu (safe-area) payı kadar aşağıdadır.
 * Çentik (B135): yatayda sol kenar en az `env(safe-area-inset-left)`; iOS PWA'da (viewportFit cover + black-translucent)
 * düğme çentik/durum çubuğu bandına girmez.
 */
const VARIANT_CLASS = {
  app: "top-1/2 -translate-y-1/2 bg-ink-950 hover:bg-ink-950 active:bg-ink-950 shadow-[var(--shadow-card)] lg:hidden",
  admin: "top-[calc(0.625rem+env(safe-area-inset-top))] bg-[var(--navy-800)] hover:bg-[var(--navy-800)] active:bg-[var(--navy-800)] shadow-[var(--elev-3)] md:hidden",
} as const;

export function MobileMenuTrigger({ controlsId, label, variant = "app" }: { controlsId: string; label: string; variant?: keyof typeof VARIANT_CLASS }) {
  const { open, requestOpen, warm, press } = useMobileMenu();
  return (
    <Button
      variant="ghost"
      size="icon"
      {...pressOpenHandlers({ open: requestOpen, press })}
      onPointerEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={controlsId}
      aria-label={label}
      // Kanonik düğme (odak/basma tek yerde); koyu zemin ve 44px kare burada sabitlenir (twMerge ghost zemin/renklerini varyant sınıflarıyla ezer).
      className={`absolute left-[max(0.75rem,env(safe-area-inset-left))] z-10 grid h-11 w-11 place-items-center text-white hover:text-white ${VARIANT_CLASS[variant]}`}
    >
      <Menu className="h-5 w-5" aria-hidden />
    </Button>
  );
}
