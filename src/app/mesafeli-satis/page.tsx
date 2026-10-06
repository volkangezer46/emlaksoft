import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/mesafeli-satis");
}

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
          Ticari ünvan, adres, MERSİS ve vergi bilgileri ödeme sayfasındaki sözleşme onay ekranında ve faturada da yer alır.
        </p>
        {/* ŞABLON: aşağıdaki alanlar işletme sahibince doldurulmadan yayınlanmamalıdır. */}
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Ticari ünvan:</b> [ŞİRKET ÜNVANI — DOLDURULACAK]</li>
          <li><b>Adres:</b> [TEBLİGAT ADRESİ — DOLDURULACAK]</li>
          <li><b>MERSİS no:</b> [MERSİS NUMARASI — DOLDURULACAK]</li>
          <li><b>Vergi dairesi / vergi no:</b> [VERGİ DAİRESİ VE NUMARASI — DOLDURULACAK]</li>
          <li><b>KEP adresi:</b> [KEP ADRESİ — DOLDURULACAK]</li>
        </ul>
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
          gösterilir. Ödemeler, lisanslı ödeme kuruluşu iyzico aracılığıyla kredi/banka kartı ile tahsil edilir; kart
          bilgileri Platform&apos;da saklanmaz, iyzico nezdinde saklanır. Platform yalnızca kartın saklama anahtarını, kartın
          son 4 hanesini ve markasını tutar. Kartınız, yalnızca açık rızanız varsa sonraki ödemeler için kaydedilir.
        </p>
        <p>
          <b>Yenileme:</b> Otomatik tahsilat yalnızca kayıtlı kartınız ve ayrıca verdiğiniz açık rızanız bulunuyorsa
          yapılır. Aksi hâlde dönem sonunda hatırlatma ve ödeme bağlantısı iletilir; ödeme yapılmazsa abonelik
          yenilenmez. Fiyat değişiklikleri yenileme öncesinde bildirilir. Otomatik tahsilat rızasını panelden
          dilediğiniz an geri alabilirsiniz.
        </p>
        <p>
          <b>Hesap kredisi:</b> Davet programı gibi kampanyalarla tanımlanan hesap kredisi, abonelik faturalarında
          indirim olarak kullanılır; nakde çevrilmez ve devredilemez (ayrıntılar:{" "}
          <Link className="font-semibold text-brand-600" href="/davet-kosullari">Davet ve Ortaklık Programı Koşulları</Link>).
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
