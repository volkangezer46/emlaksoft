/**
 * "Yenilikler" çekmecesini başka yerden açma sinyali (plan 2.3: telefonda düğme avatar menüsüne taşındı). Çekmece
 * kabuğu (`whats-new.tsx`) olayı dinler; düğmesi lg altında gizli olsa da çekmece portal ile açılır.
 */
export const WHATS_NEW_OPEN_EVENT = "es:whats-new-open";

export function requestWhatsNewOpen(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WHATS_NEW_OPEN_EVENT));
}
