/** Hata listesi adresi: süzgeç + sayfa (saf; sayfa ve test ortak kullanır). */
export type Filters = { durum?: string; son?: string; q?: string; kaynak?: string; ofis?: string };

export function hrefWith(p: Filters & { sayfa?: number }) {
  const sp = new URLSearchParams();
  if (p.durum) sp.set("durum", p.durum);
  if (p.son) sp.set("son", p.son);
  if (p.q) sp.set("q", p.q);
  if (p.kaynak) sp.set("kaynak", p.kaynak);
  if (p.ofis) sp.set("ofis", p.ofis);
  if (p.sayfa && p.sayfa > 1) sp.set("sayfa", String(p.sayfa));
  const s = sp.toString();
  return s ? `/admin/sistem?sekme=hatalar&${s}` : "/admin/sistem?sekme=hatalar";
}
