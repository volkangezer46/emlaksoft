"use client";

import type { Ref } from "react";

/**
 * Önizleme iframe'i. G6: `sandbox="allow-scripts"`, `allow-same-origin` VERİLMEZ: önizlenen sayfa betik çalıştırabilir
 * (köprü + hareket) ama yönetim kökenine (çerez, depolama, DOM) erişemez; editörle tek kanal `postMessage`.
 * Bağlantılar/formlar iframe içinde gezinemez (allow-top-navigation, allow-forms, allow-popups yok).
 */
export const PREVIEW_SANDBOX = "allow-scripts";

export function PreviewFrame({ src, width, frameRef }: { src: string; width: number; frameRef?: Ref<HTMLIFrameElement> }) {
  return (
    <iframe
      ref={frameRef}
      title="Ana sayfa taslak önizlemesi"
      src={src}
      sandbox={PREVIEW_SANDBOX}
      referrerPolicy="no-referrer"
      style={{ width, height: 760 }}
      className="mx-auto block max-w-none border-0 bg-white"
    />
  );
}
