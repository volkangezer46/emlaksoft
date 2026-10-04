"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * Ofisin kapattığı modül anahtarları (src/lib/modules). Sunucu `layout.tsx` okur ve burada dağıtır;
 * menü, sekme çubuğu, breadcrumb, komut paleti ve hızlı oluştur aynı kapıdan (nav-config `closed`) süzer.
 * Veri silinmez: yalnız görünürlük. Varsayılan boş = hepsi açık.
 */
const NO_CLOSED: readonly string[] = [];
const ClosedModulesContext = createContext<readonly string[]>(NO_CLOSED);

export function ClosedModulesProvider({ closed, children }: { closed: readonly string[]; children: ReactNode }) {
  return <ClosedModulesContext.Provider value={closed}>{children}</ClosedModulesContext.Provider>;
}

export function useClosedModules(): readonly string[] {
  return useContext(ClosedModulesContext);
}
