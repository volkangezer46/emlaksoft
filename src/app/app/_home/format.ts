/** Ana ekranda ortak kullanılan biçimleyiciler/etiketler. */
export const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });

export const apptTypeLabel: Record<string, string> = {
  showing: "Yer gösterme",
  office: "Ofis görüşmesi",
  valuation: "Değerleme",
  contract: "Sözleşme",
};
