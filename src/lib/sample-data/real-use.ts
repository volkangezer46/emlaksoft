/**
 * "Gerçek kullanıma geç" — SAF tanımlar (istemci ve sunucu). Sayfa yolu, yetkili roller ve geçiş sonrası
 * önerilen üç adım tek yerden gelir; kabuk şeridi, Ayarlar kartı ve geçiş sayfası aynısını kullanır.
 */

export const REAL_USE_HREF = "/app/ayarlar/gercek-kullanim";

/** Örnek veriyi kalıcı silebilen roller (RPC `purge_tenant_sample_data` içinde de aynı kural). */
export const REAL_USE_ROLES = ["owner", "gm"] as const;

export function canSwitchToRealUse(role: string | null | undefined): boolean {
  return (REAL_USE_ROLES as readonly string[]).includes(String(role ?? ""));
}

export type NextStep = { title: string; description: string; href: string };

/** Başarı ekranındaki sonraki 3 adım (sıfır çıkmaz: her biri gerçek bir sayfaya gider). */
export const REAL_USE_NEXT_STEPS: readonly NextStep[] = [
  { title: "İlk portföyünü ekle", description: "Gerçek bir ilanla başla; vitrin ve eşleştirme bunun üzerinden çalışır.", href: "/app/portfoyler/yeni" },
  { title: "Ekibini davet et", description: "Danışmanlarına e-posta ile erişim bağlantısı gönder.", href: "/app/ekip/yeni" },
  { title: "Portal bağla", description: "Sahibinden / Hepsiemlak ilanlarını eşle; kayıp-kaçak kalkanı devreye girsin.", href: "/app/portallar" },
];

/** Şeridin tek satırlık metni: örnek veri ve/veya deneme. */
export function demoStripText(input: { sampleActive: boolean; trialText: string | null }): string | null {
  const parts: string[] = [];
  if (input.sampleActive) parts.push("Demo verisiyle çalışıyorsun");
  if (input.trialText) parts.push(input.trialText);
  return parts.length ? parts.join(" · ") : null;
}
