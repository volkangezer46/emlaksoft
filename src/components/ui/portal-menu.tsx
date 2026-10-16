"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { runWhenIdle } from "@/lib/idle";
import { lazyPanel } from "@/lib/lazy-panel";

export type PortalMenuProps = {
  /** Erişilebilir ad (ekran okuyucu + ipucu). */
  label: string;
  /** Düğme yüzü (ikon ve/veya metin); sunucuda çizilebilir. */
  trigger: ReactNode;
  triggerClassName?: string;
  /** Panelin tetikleyiciye göre hizası. */
  align?: "start" | "end";
  contentClassName?: string;
  disabled?: boolean;
  /** Menü içeriği: bağlantı ya da düğmeler. İçerikte bir bağlantı/düğmeye tıklanınca menü kapanır. */
  children: ReactNode;
};

/**
 * PORTAL MENÜ — kartların "⋯" menüleri, filtre açılır listeleri ve hızlı işlem menüleri için TEK bileşen.
 *
 * Panel `document.body` üstündeki portal katmanında çizilir (Radix Popover Portal, z-[60]); bu yüzden kartın
 * `overflow:hidden` / `isolation` / `transform` kuralları menüyü KIRPAMAZ ve kart arkasında kalmaz (sahip geri bildirimi
 * 2026-10-16: "işaretlediğim menü arkada kalıyor"). Ekran kenarına taşmayı Radix çarpışma yönetimi önler; Esc / dışarı
 * tıklama kapatır, odak tetikleyiciye döner.
 *
 * Paket bütçesi: Radix gövdesi ilk etkileşime kadar yüklenmez (`lazyPanel`, boşta önceden indirilir); ilk boyamada yalnız
 * aynı görünümlü hafif düğme vardır (CLS 0).
 */
const panel = lazyPanel(() => import("./portal-menu-panel").then((m) => m.PortalMenuPanel));

export function PortalMenu(props: PortalMenuProps) {
  const [Panel, setPanel] = useState<ReturnType<typeof panel.resolve> | null>(null);
  useEffect(() => runWhenIdle(panel.preload), []);
  if (Panel) {
    return (
      <Suspense fallback={<Trigger {...props} />}>
        <Panel {...props} initialOpen />
      </Suspense>
    );
  }
  return <Trigger {...props} onOpen={() => setPanel(() => panel.resolve())} warm={panel.preload} />;
}

function Trigger({ label, trigger, triggerClassName, disabled, onOpen, warm }: PortalMenuProps & { onOpen?: () => void; warm?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerEnter={warm}
      onFocus={warm}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={false}
      aria-label={label}
      title={label}
      className={triggerClassName}
    >
      {trigger}
    </button>
  );
}
