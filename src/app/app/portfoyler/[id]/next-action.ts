/**
 * Portföy "Sonraki en iyi eylem" hedefi (SAF). Satış teşhisi engeli varsa o sekmeye; yoksa portföyün DURUMUNA göre
 * gerçek bir sonraki adım: taslakta yayına hazırlık (ilan sahibi + konum kapısı), rezerve/kapanmışta özet, arşivde
 * durum değiştirme, yayında portal kayıtları. Eskiden durumdan bağımsız hep "Portalleri gör" çıkıyordu.
 */
export type PropertyNextAction = { href: string; label: string; hint: string | null };

export function propertyNextAction(input: {
  propertyId: string;
  status: string;
  blockerKey: string | null;
  blockerTab: string | null;
}): PropertyNextAction {
  const base = `/app/portfoyler/${input.propertyId}`;
  if (input.blockerKey) return { href: `${base}?sekme=${input.blockerTab ?? "ozet"}`, label: "Düzeltmeye git", hint: null };
  switch (input.status) {
    case "draft":
      return {
        href: `${base}?sekme=sahip`,
        label: "Yayına hazırla",
        hint: "Taslak portföy: ilan sahibi bilgisini ve konumu tamamlayıp durumu “Yayında” yapın; vitrine ve portallara ancak o zaman çıkar.",
      };
    case "reserved":
      return { href: `${base}?sekme=ozet`, label: "Anlaşmaya git", hint: "Portföy rezerve: anlaşma, kapora ve komisyon adımlarını Özet sekmesinden tamamlayın." };
    case "sold":
    case "rented":
      return { href: `${base}?sekme=ozet`, label: "Özete git", hint: "Portföy kapandı: anlaşma ve komisyon kaydı Özet sekmesinde." };
    case "archived":
      return { href: `${base}?sekme=ozet#durum`, label: "Durumu değiştir", hint: "Portföy arşivde: yeniden yayına almak için durumunu değiştirin." };
    default:
      return { href: `${base}?sekme=portallar`, label: "Portalları gör", hint: null };
  }
}
