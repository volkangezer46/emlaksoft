/**
 * İstemci-güvenli (sunucu bağımlılığı yok): bu üç rol tenant genelini, diğerleri kendi satırlarını görür.
 * `permission-data-scope.ts` yeniden dışa aktarır; istemci bileşenleri doğrudan buradan içe aktarır.
 */
export function hasOfficeWideDataScope(role: string | null | undefined): boolean {
  return role === "owner" || role === "gm" || role === "branch_manager";
}
