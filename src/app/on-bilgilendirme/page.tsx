import { SUPPORT_EMAIL, SUPPORT_MAILTO, SUPPORT_PHONE, SUPPORT_TEL, SUPPORT_WHATSAPP, SUPPORT_WHATSAPP_URL } from "@/lib/contact-info";
import { LEGAL_ENTITY_PENDING, legalEntityFields } from "@/lib/legal-entity";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/on-bilgilendirme");
}

export default function OnBilgilendirmePage() {
  return (
    <LegalPage
      title="Ön Bilgilendirme Formu"
      intro="Mesafeli Sözleşmeler Yönetmeliği'nin 5. maddesi uyarınca, ödeme yükümlülüğü doğmadan önce aşağıdaki hususlarda bilgilendirilirsiniz."
    >
      <LegalSection no="1." title="Sağlayıcı Bilgileri">
        <p>
          EmlakSoft — Türkiye emlak ofisleri için bulut tabanlı CRM ve ofis yönetim platformu. İletişim:{" "}
          <a className="font-semibold text-brand-600" href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
          Ticari ünvan, adres, MERSİS ve vergi bilgileri ödeme onay ekranında ve düzenlenen faturada da yer alır.
        </p>
        {/* Sağlayıcı kimliği sunucu ortamından (src/lib/legal-entity.ts); boş alan yer tutucu yerine açık notla gösterilir. */}
        <ul className="list-disc space-y-1 pl-5">
          {legalEntityFields().map((f) => (
            <li key={f.key}><b>{f.label}:</b> {f.value ?? <span className="text-text-muted">{LEGAL_ENTITY_PENDING}</span>}</li>
          ))}
          {SUPPORT_PHONE && SUPPORT_TEL ? (
            <li><b>Telefon:</b> <a className="font-semibold text-brand-600" href={SUPPORT_TEL}>{SUPPORT_PHONE}</a></li>
          ) : null}
          {SUPPORT_WHATSAPP && SUPPORT_WHATSAPP_URL ? (
            <li><b>WhatsApp:</b> <a className="font-semibold text-brand-600" href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noopener noreferrer">{SUPPORT_WHATSAPP}</a></li>
          ) : null}
        </ul>
      </LegalSection>

      <LegalSection no="2." title="Hizmetin Temel Nitelikleri">
        <p>
          EmlakSoft; müşteri yönetimi, portföy yönetimi, portal ilan takibi, komisyon &amp; kayıp-kaçak takibi,
          randevu, sözleşme/e-imza, raporlama ve İYS/EİDS/KVKK uyum araçlarını içeren abonelik tabanlı bir SaaS
          hizmetidir. Plan kapsamları ve kullanıcı limitleri <Link className="font-semibold text-brand-600" href="/#fiyat">fiyatlandırma</Link> bölümünde ilan edilir.
        </p>
      </LegalSection>

      <LegalSection no="3." title="Fiyat, Vergiler ve Ödeme">
        <p>
          Tüm fiyatlar Türk Lirası cinsinden ve KDV dâhil gösterilir. Ödeme, lisanslı ödeme kuruluşu iyzico üzerinden
          kredi/banka kartıyla alınır; ek teslimat/kargo bedeli yoktur. Kart bilgileriniz EmlakSoft&apos;ta saklanmaz,
          iyzico nezdinde saklanır; EmlakSoft yalnızca saklama anahtarını ve kartın son 4 hanesi ile markasını tutar.
          Kartınız yalnızca açık rızanızla kaydedilir.
        </p>
        <p>
          Otomatik tahsilat yalnızca kayıtlı kartınız ve ayrıca verdiğiniz açık rızanız varsa yapılır; aksi hâlde
          dönem sonunda hatırlatma ve ödeme bağlantısı ile yenilenir. Yenileme öncesi fiyat değişiklikleri e-posta ile
          bildirilir. Hesap kredisi (ör. davet programı) yalnızca fatura indirimi olarak kullanılır; nakde çevrilmez.
        </p>
      </LegalSection>

      <LegalSection no="4." title="İfa ve Teslim">
        <p>
          Hizmet dijitaldir; ödeme onayıyla birlikte derhâl ifa edilmeye başlanır ve çalışma alanınıza erişim açılır.
          14 günlük ücretsiz deneme süresinde kredi kartı istenmez; deneme sonunda dilerseniz ücretli plana geçersiniz.
        </p>
      </LegalSection>

      <LegalSection no="5." title="Cayma Hakkı">
        <p>
          Sözleşmenin kurulmasından itibaren 14 gün içinde cayma hakkınız vardır. Onayınızla hizmetin ifasına derhâl
          başlanması hâlinde Yönetmelik m.15/1-ğ istisnası uygulanır; ayrıntılı koşullar ve iade süreci{" "}
          <Link className="font-semibold text-brand-600" href="/iptal-iade">İptal &amp; İade Politikası</Link>&apos;nda yer alır.
          Cayma bildirimi için: <a className="font-semibold text-brand-600" href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
        </p>
      </LegalSection>

      <LegalSection no="6." title="Şikâyet ve Başvuru Yolları">
        <p>
          Talep ve şikâyetlerinizi öncelikle destek kanalımıza iletebilirsiniz. Ayrıca yerleşim yerinizdeki Tüketici
          Hakem Heyetleri ile Tüketici Mahkemelerine başvuru hakkınız saklıdır.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
