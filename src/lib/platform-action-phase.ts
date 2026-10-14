import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import type { PlatformAction } from "@/lib/platform-access";

/**
 * DG1: istek şu an bir SERVER ACTION gövdesini mi yürütüyor? (Next istek deposunun `phase` alanı: action → render.)
 * Personel kapıları bu sayede aynı `requirePlatformModule(mod)` çağrısında sayfa çizerken `view`, action yürütürken
 * `write` ister: özel rolde salt okunur modülün eylemleri sunucuda reddedilir. Action sonrası sayfa yeniden
 * çizimi `render` evresindedir (görüntüleme kapısı). Depo okunamazsa false (görüntüleme kuralı; sabit roller için
 * sonuç zaten aynıdır). Yalnız sunucu kapılarından çağrılır (istek deposu istemcide yoktur).
 *
 * DİKKAT: Next route handler'ları (GET dahil) da istek deposunu `phase: "action"` ile açar
 * (`createRequestStoreForAPI`): route.ts içinde varsayılan istek `write` olur. Bu yüzden route handler'lar eylemi
 * AÇIKÇA verir (`requirePlatformModule(mod, "view" | "write")`; sözleşme: platform-route-gate-contract.test.ts).
 */
export function inServerActionPhase(): boolean {
  try {
    const store = workUnitAsyncStorage.getStore() as { type?: string; phase?: string } | undefined;
    return store?.type === "request" && store.phase === "action";
  } catch {
    return false;
  }
}

/**
 * Kapının istediği eylem: açıkça verilmediyse sayfa çiziminde `view`, server action (ve route handler) yürütülürken
 * `write`.
 * Sabit rollerde iki düzey aynı modül listesine denk gelir (tek istisna ops × reklam: orayı zaten yalnız süper admin yazar).
 */
export function gateAction(action?: PlatformAction): PlatformAction {
  return action ?? (inServerActionPhase() ? "write" : "view");
}
