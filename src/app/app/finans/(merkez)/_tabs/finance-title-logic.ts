import { FINANCE_ROOT } from "@/lib/finance/routes";

/** Alt alan adları: sekme şeridiyle aynı (nav-roles "Finans" merkezi). */
export const FINANCE_SECTION_TITLES: Readonly<Record<string, string>> = {
  hareketler: "Hareketler",
  "kasa-banka": "Kasa ve banka",
  cari: "Alacak ve borç",
  komisyon: "Komisyon",
  hakedis: "Danışman ödemeleri",
  tahsilat: "Tahsilatlar",
  faturalar: "Faturalar",
  belgeler: "Belgeler",
  tekrarlayan: "Tekrarlayanlar",
  butce: "Bütçe",
  vergi: "Vergi",
  raporlar: "Finans raporları",
  ayarlar: "Finans ayarları",
  kayit: "Kayıt",
};

/** Yoldan başlık: `hub` = kullanıcı Finans genel bakışını görebiliyor (başlık "Finans · <alt alan>"). */
export function financeTitleFor(pathname: string | null, hub: boolean): string {
  const rest = (pathname ?? "").startsWith(FINANCE_ROOT) ? (pathname ?? "").slice(FINANCE_ROOT.length).replace(/^\//, "") : "";
  const section = rest.split("/")[0] ?? "";
  const name = FINANCE_SECTION_TITLES[section];
  if (!name) return hub ? "Finans" : "Komisyon";
  return hub ? `Finans · ${name}` : name;
}
