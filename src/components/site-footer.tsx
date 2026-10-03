import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PLANS } from "@/lib/billing/plans";
import { trParts } from "@/lib/clock";

type FooterLink = [label: string, href: string];

const columns: { title: string; links: FooterLink[] }[] = [
  {
    title: "Ürün",
    links: [
      ["Özellikler", "/#ozellikler"],
      ["Ürün turu", "/#tur"],
      ["Kayıp-kaçak motoru", "/#kayip-kacak"],
      ["Akıllı arama", "/#akilli-arama"],
      ["Güvenlik ve KVKK", "/#guvenlik"],
    ],
  },
  {
    title: "Paketler",
    links: [...PLANS.map((p): FooterLink => [p.name, `/kayit?plan=${p.id}`]), ["Fiyatları karşılaştır", "/#fiyat"]],
  },
  {
    title: "Kaynaklar",
    links: [
      ["Nasıl çalışır", "/#nasil"],
      ["Sık sorulan sorular", "/#sss"],
      ["Giriş yap", "/giris"],
    ],
  },
  {
    title: "Yasal",
    links: [
      ["KVKK Aydınlatma", "/kvkk-aydinlatma"],
      ["Gizlilik Politikası", "/gizlilik"],
      ["Çerez Politikası", "/cerez-politikasi"],
      ["Kullanım Şartları", "/kullanim-sartlari"],
      ["Mesafeli Satış Sözleşmesi", "/mesafeli-satis"],
      ["Ön Bilgilendirme", "/on-bilgilendirme"],
      ["İptal ve İade", "/iptal-iade"],
    ],
  },
  {
    title: "İletişim",
    links: [
      ["Demo görüşmesi planla", "/demo"],
      ["destek@emlaksoft.com.tr", "mailto:destek@emlaksoft.com.tr"],
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mk-foot">
      <div className="mk-wrap" style={{ paddingBlock: "clamp(3rem, 2rem + 4vw, 5rem)" }}>
        <div className="mk-foot-grid">
          <div className="mk-foot-brand">
            <Link href="/" className="mk-logo" style={{ color: "#fff" }} aria-label="EmlakSoft ana sayfa">
              <i aria-hidden="true" style={{ background: "#1463ff" }}>E</i>EmlakSoft
            </Link>
            <p style={{ margin: "1rem 0 0", maxWidth: "18rem", fontSize: "0.9375rem", lineHeight: 1.6 }}>
              Emlak ofisleri için müşteri, portföy, anlaşma ve komisyon akışını tek panelde toplayan abonelikli yazılım.
            </p>
            <Link href="/kayit" className="mk-btn mk-btn-light" style={{ marginTop: "1.25rem", minHeight: "2.75rem", padding: "0.5rem 1rem", fontSize: "0.9375rem" }}>
              14 gün ücretsiz dene <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          {columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2>{col.title}</h2>
              <ul>
                {col.links.map(([label, href]) => (
                  <li key={label}><Link href={href}>{label}</Link></li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mk-foot-bottom">
          <p style={{ margin: 0 }}>© {trParts().year} EmlakSoft. Tüm hakları saklıdır.</p>
          <p style={{ margin: 0 }}>Ekran görüntüleri ve sayılar örnek veridir.</p>
        </div>
      </div>
      <div className="mk-sticky-cta">
        <Link href="/kayit" className="mk-btn mk-btn-primary">14 gün ücretsiz dene</Link>
      </div>
    </footer>
  );
}
