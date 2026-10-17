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

/** Başarı ekranındaki "ilk adımlar" (sıfır çıkmaz: her biri gerçek bir sayfaya gider). */
export const REAL_USE_NEXT_STEPS: readonly NextStep[] = [
  { title: "Kayıtlarını içe aktar", description: "Excel/CSV müşteri ve portföy listeni ya da portal ilanlarını tek adımda aktar.", href: "/app/ice-aktarma" },
  { title: "İlk portföyünü ekle", description: "Gerçek bir ilanla başla; vitrin, eşleştirme ve portal aktarımı bunun üzerinden çalışır.", href: "/app/portfoyler/yeni" },
  { title: "Ekibini davet et", description: "Danışmanlarına e-posta ile erişim bağlantısı gönder; her biri kendi kayıtlarıyla başlar.", href: "/app/ekip/yeni" },
];

/** İkinci onayda yazılacak sabit sözcük (ofis adı da kabul edilir). */
export const REAL_USE_CONFIRM_WORD = "SİL";

const norm = (v: string) => v.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");

/** İkinci onay: "SİL" ya da ofis adı (büyük/küçük harf ve fazla boşluk önemsiz). Sunucu da aynı kuralı uygular. */
export function realUseConfirmMatches(typed: string | null | undefined, officeName: string | null | undefined): boolean {
  const t = norm(String(typed ?? ""));
  if (!t) return false;
  if (t === norm(REAL_USE_CONFIRM_WORD)) return true;
  const name = norm(String(officeName ?? ""));
  return name.length >= 2 && t === name;
}

/** Şeridin tek satırlık metni: örnek veri ve/veya deneme. */
export function demoStripText(input: { sampleActive: boolean; trialText: string | null }): string | null {
  const parts: string[] = [];
  if (input.sampleActive) parts.push("Demo ofisindesiniz — gördüğünüz kayıtlar örnektir");
  if (input.trialText) parts.push(input.trialText);
  return parts.length ? parts.join(" · ") : null;
}
