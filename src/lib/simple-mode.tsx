"use client";

import { createContext, use, useContext, type ReactNode } from "react";
import { DEFAULT_UI_PREFS } from "@/lib/ui-prefs";

/**
 * Sade mod bağlamı (sadeleştirme planı 2.1). Bayrak `/app` layout'unda TEK kez çözülür (`resolveUiPrefs`: çerez +
 * küçük ofis kuralı) ve buradan okunur; ikinci bir mod yoktur. Sade modda hiçbir özellik silinmez, yalnız katlanır
 * ("Daha fazla", "Tümü", "…" ya da Ctrl+K).
 *
 * İstemci:  `const simple = useSimpleMode();`  ya da  `<SimpleModeOnly>…</SimpleModeOnly>` / `<FullModeOnly>…</FullModeOnly>`
 * Sunucu:   `const { simple } = await getUiPrefs();`  (`@/lib/ui-prefs-server`)
 */
export type SimpleModeValue = { simple: boolean; smallOffice: boolean };

const DEFAULT_VALUE: SimpleModeValue = { simple: DEFAULT_UI_PREFS.simple, smallOffice: true };
const SimpleModeContext = createContext<SimpleModeValue | Promise<SimpleModeValue>>(DEFAULT_VALUE);

/**
 * `value` düz değer ya da SÖZ olabilir: layout sözü geçirir, böylece sayfa kabuk modelini beklemeden akar; bayrağı
 * okuyan bileşen (`use`) yalnız gerekirse bekler (kabuk modeli ilk HTML paketinden önce zaten çözülür).
 */
export function SimpleModeProvider({ value, children }: { value: SimpleModeValue | Promise<SimpleModeValue>; children: ReactNode }) {
  return <SimpleModeContext.Provider value={value}>{children}</SimpleModeContext.Provider>;
}

function useSimpleModeValue(): SimpleModeValue {
  const v = useContext(SimpleModeContext);
  return v instanceof Promise ? use(v) : v;
}

/** true: sade görünüm açık (az menü, büyük düğmeler; KPI/grafik/ipucu katlı). Sağlayıcı dışında varsayılan (sade). */
export function useSimpleMode(): boolean {
  return useSimpleModeValue().simple;
}

/** true: ekip en çok 5 kişi ve şube yok (takım/şube/lig/TV sekmeleri temel değil). */
export function useSmallOffice(): boolean {
  return useSimpleModeValue().smallOffice;
}

/** Yalnız sade modda çizilir. */
export function SimpleModeOnly({ children }: { children: ReactNode }) {
  return useSimpleMode() ? <>{children}</> : null;
}

/** Yalnız tam modda ("Tüm özellikleri göster") çizilir: sade modda katlanan KPI, grafik ve ipuçları için. */
export function FullModeOnly({ children }: { children: ReactNode }) {
  return useSimpleMode() ? null : <>{children}</>;
}
