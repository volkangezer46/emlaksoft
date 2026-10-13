/**
 * Medya kullanımı (saf): `used_by` yayındaki ve taslaktaki site içeriği yapılandırmalarından HESAPLANIR (elle tutulmaz).
 * Kullanımdaki medya silinemez; "Değiştir" aynı kimliği korur (yapılandırma değişmeden yeni dosya yayına girer).
 * Bu turda medya alanı yalnız `hero.image` (bento ve diğer görsel alanları sonraki tur).
 */

type HeroImageCarrier = { hero?: { image?: { mediaId?: unknown } | null } | null } | null | undefined;

export type UsageSource = { live: HeroImageCarrier; draft: HeroImageCarrier };

/** Yapılandırmadaki medya başvuruları: (yol, kimlik). */
export function mediaRefs(cfg: HeroImageCarrier): Array<{ path: string; mediaId: string }> {
  const id = cfg?.hero?.image?.mediaId;
  return typeof id === "string" && id ? [{ path: "hero.image", mediaId: id }] : [];
}

/** Kimlik -> kullanım yerleri (`sitecontent.live:hero.image`, `sitecontent.draft:hero.image`); sıralı, tekrarsız. */
export function computeUsage(src: UsageSource): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (scope: string, cfg: HeroImageCarrier) => {
    for (const r of mediaRefs(cfg)) {
      const list = out.get(r.mediaId) ?? [];
      const tag = `${scope}:${r.path}`;
      if (!list.includes(tag)) list.push(tag);
      out.set(r.mediaId, list);
    }
  };
  add("sitecontent.live", src.live);
  add("sitecontent.draft", src.draft);
  for (const [k, v] of out) out.set(k, [...v].sort());
  return out;
}

export function usageOf(src: UsageSource, mediaId: string): string[] {
  return computeUsage(src).get(mediaId) ?? [];
}

const PLACE: Record<string, string> = { "hero.image": "Ana sayfa görseli" };

/** Kullanım etiketi (Türkçe): "Ana sayfa görseli (yayında)" / "(taslakta)". */
export function usageLabel(tag: string): string {
  const [scope, path = ""] = tag.split(":");
  const where = PLACE[path] ?? path;
  return `${where} (${scope === "sitecontent.live" ? "yayında" : "taslakta"})`;
}
