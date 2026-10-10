/** Ana ekran sorgu parametreleri (bağlantılar birbirinin durumunu korur). `ozet=1`: "Ofis özeti" bölümü açık. */
export type HomeParams = { donem?: string; kapsam?: string; daha?: string; icgoru?: string; ozet?: string };

export function homeHref(params: HomeParams, patch: Partial<HomeParams>): string {
  const merged = { ...params, ...patch };
  const sp = new URLSearchParams();
  if (merged.donem) sp.set("donem", merged.donem);
  if (merged.kapsam) sp.set("kapsam", merged.kapsam);
  if (merged.daha) sp.set("daha", merged.daha);
  if (merged.icgoru) sp.set("icgoru", merged.icgoru);
  if (merged.ozet) sp.set("ozet", merged.ozet);
  const qs = sp.toString();
  return qs ? `/app?${qs}` : "/app";
}
