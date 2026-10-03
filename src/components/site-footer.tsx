import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { trParts } from "@/lib/clock";

const columns: { title: string; links: [string, string][] }[] = [
  {
    title: "Ürün",
    links: [
      ["Özellikler", "/#ozellikler"],
      ["Kayıp-kaçak motoru", "/#kayip-kacak"],
      ["Akıllı Arama", "/#akilli-arama"],
      ["Fiyatlandırma", "/#fiyat"],
    ],
  },
  {
    title: "Başlayın",
    links: [
      ["14 gün ücretsiz dene", "/kayit"],
      ["Demo görüşmesi planla", "/demo"],
      ["Giriş yap", "/giris"],
      ["Sık sorulan sorular", "/#sss"],
    ],
  },
  {
    title: "Güven",
    links: [
      ["Güvenlik ve uyum", "/#guvenlik"],
      ["KVKK Aydınlatma", "/kvkk-aydinlatma"],
      ["Gizlilik Politikası", "/gizlilik"],
      ["Çerez Politikası", "/cerez-politikasi"],
    ],
  },
  {
    title: "Sözleşmeler",
    links: [
      ["Kullanım Şartları", "/kullanim-sartlari"],
      ["Mesafeli Satış Sözleşmesi", "/mesafeli-satis"],
      ["Ön Bilgilendirme", "/on-bilgilendirme"],
      ["İptal ve İade", "/iptal-iade"],
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="theme-dark border-t border-white/10 bg-ink-950 text-white">
      <div className="mx-auto max-w-6xl px-4 py-12 md:py-14">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_2.7fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5" aria-label="EmlakSoft ana sayfa">
              <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-brand-600 font-display text-base font-extrabold text-white">E</span>
              <span className="font-display text-lg font-extrabold">EmlakSoft</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/70">
              Emlak ofisleri için müşteri, portföy, anlaşma ve komisyon akışını tek panelde toplayan abonelikli yazılım.
            </p>
            <Link href="/kayit" className="mt-5 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 transition hover:bg-white/90">
              14 gün ücretsiz dene <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <nav aria-label="Alt bilgi bağlantıları" className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
            {columns.map((col) => (
              <div key={col.title}>
                <h2 className="text-sm font-bold text-white">{col.title}</h2>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {col.links.map(([label, href]) => (
                    <li key={label}>
                      <Link href={href} className="text-white/70 transition hover:text-white">{label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-6 text-sm text-white/60 sm:flex-row sm:items-center sm:justify-between">
          <p>© {trParts().year} EmlakSoft. Tüm hakları saklıdır.</p>
          <a href="mailto:destek@emlaksoft.com.tr" className="transition hover:text-white">destek@emlaksoft.com.tr</a>
        </div>
      </div>
    </footer>
  );
}
