
/** Ana ekran sorgu parametreleri (bağlantılar birbirinin durumunu korur). */
export type HomeParams = { donem?: string; kapsam?: string; daha?: string; icgoru?: string };

export function homeHref(params: HomeParams, patch: Partial<HomeParams>): string {
  const merged = { ...params, ...patch };
  const sp = new URLSearchParams();
  if (merged.donem) sp.set("donem", merged.donem);
  if (merged.kapsam) sp.set("kapsam", merged.kapsam);
  if (merged.daha) sp.set("daha", merged.daha);
  if (merged.icgoru) sp.set("icgoru", merged.icgoru);
  const qs = sp.toString();
  return qs ? `/app?${qs}` : "/app";
}
