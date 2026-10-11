/**
 * Tur kimliği ↔ rol eşlemesi (hafif, bağımlılıksız). Kabukta her sayfada yüklenen `ProductTourLazy` yalnız
 * "bu rolün turu hangisi?" sorusunu sorar; tur içeriği (`product-tour-data.ts`, adım metinleri) bu yüzden kabuk
 * paketine girmez. Tur verisi (`TOURS`) roller için bu tabloyu kullanır: tek kaynak burasıdır.
 */
export type TourId = "ofis-sahibi" | "yonetici" | "muhasebe" | "danisman";

export const TOUR_ROLES: Readonly<Record<TourId, readonly string[]>> = {
  "ofis-sahibi": ["owner"],
  yonetici: ["gm", "branch_manager", "team_lead"],
  muhasebe: ["accounting"],
  danisman: ["advisor", "call_center", "readonly"],
};

const TOUR_ORDER: readonly TourId[] = ["ofis-sahibi", "yonetici", "muhasebe", "danisman"];

/** Rolün varsayılan turu; bilinmeyen rol en kısıtlı olan danışman turunu alır. */
export function tourIdForRole(role: string | null | undefined): TourId {
  const r = String(role ?? "");
  return TOUR_ORDER.find((id) => TOUR_ROLES[id].includes(r)) ?? "danisman";
}
