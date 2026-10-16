/**
 * Ana ekran sorgu parametreleri (bağlantılar birbirinin durumunu korur). `ozet=1`: "Ofis özeti" bölümü açık;
 * `satis` (ay|6ay|yil), `tur` (satilik|kiralik), `danisman` (kullanıcı kimliği): Satış performansı kartı.
 */
export type HomeParams = { donem?: string; kapsam?: string; daha?: string; icgoru?: string; ozet?: string; satis?: string; tur?: string; danisman?: string };

export function homeHref(params: HomeParams, patch: Partial<HomeParams>): string {
  const merged = { ...params, ...patch };
  const sp = new URLSearchParams();
  if (merged.donem) sp.set("donem", merged.donem);
  if (merged.kapsam) sp.set("kapsam", merged.kapsam);
  if (merged.daha) sp.set("daha", merged.daha);
  if (merged.icgoru) sp.set("icgoru", merged.icgoru);
  if (merged.ozet) sp.set("ozet", merged.ozet);
  if (merged.satis) sp.set("satis", merged.satis);
  if (merged.tur) sp.set("tur", merged.tur);
  if (merged.danisman) sp.set("danisman", merged.danisman);
  const qs = sp.toString();
  return qs ? `/app?${qs}` : "/app";
}
