import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Mesafeli Satış Sözleşmesi | EmlakSoft",
  description: "6502 sayılı Kanun ve Mesafeli Sözleşmeler Yönetmeliği kapsamında mesafeli satış sözleşmesi.",
  alternates: { canonical: "/mesafeli-satis" },
};

export default function MesafeliSatisPage() {
  return (
    <LegalPage
      title="Mesafeli Satış Sözleşmesi"
      intro="6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği uyarınca, EmlakSoft abonelik hizmetinin çevrim içi satışına ilişkin sözleşmedir. Ödeme adımında bu sözleşmeyi onaylamanız istenir."
    >
      <LegalSection no="1." title="Taraflar">
        <p>
          <b>Sağlayıcı:</b> EmlakSoft (&quot;Platform&quot;) — iletişim:{" "}
          <a className="font-semibold text-brand-600" href="mailto:destek@emlaksoft.app">destek@emlaksoft.app</a>.
          Ticari ünvan, adres, MERSİS ve vergi bilgileri ödeme sayfasındaki sözleşme onay ekranında ve faturada yer alır.
        </p>
        <p>
          <b>Alıcı:</b> Platform üzerinde abonelik satın alan gerçek veya tüzel kişi (&quot;Müşteri&quot;). Sipariş
          sırasında verilen kimlik, iletişim ve fatura bilgileri esas alınır.
        </p>
      </LegalSection>

      <LegalSection no="2." title="Sözleşmenin Konusu">
        <p>
          Sözleşmenin konusu; Müşteri&apos;nin elektronik ortamda seçtiği abonelik planına ilişkin EmlakSoft bulut
          yazılım hizmetinin (SaaS) sunulması ve bedelinin ödenmesine ilişkin tarafların hak ve yükümlülükleridir.
          Plan içerikleri ve güncel fiyatlar <Link className="font-semibold text-brand-600" href="/#fiyat">fiyatlandırma</Link> sayfasında ilan edilir.
        </p>
      </LegalSection>

      <LegalSection no="3." title="Hizmetin İfası ve Teslim">
        <p>
          Hizmet dijital olarak sunulur; ödemenin onaylanmasıyla birlikte abonelik <b>derhâl</b> aktive edilir ve
          Müşteri&apos;nin çalışma alanına erişim açılır. Fiziki teslimat yoktur. Hizmet, abonelik süresi boyunca
          7/24 erişilebilir olacak şekilde sunulur; planlı bakımlar önceden duyurulur.
        </p>
      </LegalSection>

      <LegalSection no="4." title="Bedel ve Ödeme">
        <p>
          Abonelik bedeli, seçilen plana ve fatura dönemine (aylık/yıllık) göre sipariş ekranında KDV dâhil olarak
          gösterilir. Ödemeler, lisanslı ödeme kuruluşu aracılığıyla kredi/banka kartı ile tahsil edilir; kart
          bilgileri Platform tarafından saklanmaz. Abonelik, dönem sonunda Müşteri iptal etmedikçe aynı koşullarla yenilenir;
          fiyat değişiklikleri yenileme öncesinde bildirilir.
        </p>
      </LegalSection>

      <LegalSection no="5." title="Cayma Hakkı">
        <p>
          Müşteri, sözleşmenin kurulduğu tarihten itibaren <b>14 gün</b> içinde gerekçe göstermeksizin cayma hakkına
          sahiptir. Cayma bildirimi <a className="font-semibold text-brand-600" href="mailto:destek@emlaksoft.app">destek@emlaksoft.app</a>{" "}
          adresine iletilebilir. Mesafeli Sözleşmeler Yönetmeliği m.15/1-ğ uyarınca, Müşteri&apos;nin onayı ile
          hizmetin ifasına derhâl başlanan hâllerde cayma hakkı kullanılamaz; bu nedenle ücretsiz deneme süresi
          sonunda ücretli aboneliğe geçişte, ifasına başlanmamış dönem bedeli iade kapsamındadır. Ayrıntılar{" "}
          <Link className="font-semibold text-brand-600" href="/iptal-iade">İptal &amp; İade Politikası</Link>&apos;nda düzenlenmiştir.
        </p>
      </LegalSection>

      <LegalSection no="6." title="Tarafların Yükümlülükleri">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Sağlayıcı, hizmeti ilan edilen kapsamda, güvenli ve sürekli sunmakla yükümlüdür.</li>
          <li>Müşteri, hesap bilgilerinin gizliliğinden ve Platform&apos;a girdiği verilerin hukuka uygunluğundan sorumludur.</li>
          <li>Müşteri&apos;nin kendi müşterilerine ait kişisel veriler bakımından Müşteri veri sorumlusu, Sağlayıcı veri işleyendir.</li>
        </ul>
      </LegalSection>

      <LegalSection no="7." title="Uyuşmazlık Çözümü">
        <p>
          Uyuşmazlıklarda, Ticaret Bakanlığı&apos;nca her yıl ilan edilen parasal sınırlar dâhilinde Müşteri&apos;nin
          yerleşim yerindeki Tüketici Hakem Heyetleri ve Tüketici Mahkemeleri yetkilidir. Ticari nitelikli
          abonelikler için genel hükümler uygulanır.
        </p>
      </LegalSection>

      <LegalSection no="8." title="Yürürlük">
        <p>
          Müşteri, sipariş ekranında bu sözleşmeyi ve <Link className="font-semibold text-brand-600" href="/on-bilgilendirme">Ön Bilgilendirme Formu</Link>&apos;nu
          okuyup onayladığını kabul eder. Sözleşme, elektronik ortamda onaylandığı anda kurulur ve bir örneği kalıcı
          veri saklayıcısıyla (e-posta) Müşteri&apos;ye iletilir.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
