/**
 * Yumuşak gezinme işareti: ilk istemci gezinmesinden sonra <html data-soft-nav="1"> olur
 * (NavPending koyar). Sayfa İLK açıldığında süslü giriş hareketleri (sayaç, dolum, liste girişi) oynar;
 * menüden gezinirken oynamaz: ana iş parçacığı sayfa kurulumuna ayrılır, içerik anında görünür.
 */
export const SOFT_NAV_ATTR = "data-soft-nav";

export function isSoftNavigated(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute(SOFT_NAV_ATTR);
}

export function markSoftNavigated(): void {
  if (typeof document !== "undefined") document.documentElement.setAttribute(SOFT_NAV_ATTR, "1");
}
