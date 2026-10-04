import { updateTag } from "next/cache";
import { GEO_CACHE_TAG } from "./types";

/**
 * Coğrafya önbelleğini ANINDA tazeler (read-your-own-writes). YALNIZ server action içinden çağrılır
 * (Next `updateTag` kuralı); route handler'da `revalidateTag(GEO_CACHE_TAG, "max")` kullanın.
 */
export function invalidateGeoCache(): void {
  updateTag(GEO_CACHE_TAG);
}
