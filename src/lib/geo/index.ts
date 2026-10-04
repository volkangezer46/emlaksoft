import "server-only";

/**
 * COĞRAFYA MERKEZİ — sistemin il/ilçe/mahalle verisine TEK giriş (sunucu).
 * Kural: geo_provinces / geo_districts / geo_neighborhoods tablolarına yalnız src/lib/geo/** dokunur
 * (sözleşme: src/lib/geo/geo-central-contract.test.ts). Yeni kod buradan okur.
 *
 * İstemci bileşenleri bu dosyayı DEĞİL `@/lib/geo/types` ve `@/lib/geo/normalize` içe aktarır.
 */
export * from "./reader";
export { resolveGeo, resolveChainForSave } from "./resolve";
export { invalidateGeoCache } from "./cache";
export * from "./types";
export { geoKey, geoSlug, geoFold, cleanGeoName } from "./normalize";
