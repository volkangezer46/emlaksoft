import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/davet-kosullari");
}

/**
 * AVUKAT ONAYI GEREKİR: Davet programı koşulları yayın öncesi hukuki incelemeye tabidir
 * (ticari ileti, kampanya mevzuatı, KDV/muhasebe muamelesi). Tutarlar bilerek yazılmaz;
 * güncel kurallar ofis admin panelindeki kural ve ayarlardan gelir (docs/design/REFERANS_PROGRAMI.md).
 */
export default function DavetKosullariPage() {
  return (
    <LegalPage
      title="Davet ve Ortaklık Programı Koşulları"
      intro="EmlakSoft'u başka bir ofise önerdiğinizde hesap kredisi kazanabileceğiniz davet programının koşullarıdır. Programa katılan ve davet bağlantısıyla kayıt olan herkes bu koşulları kabul etmiş sayılır."
      updated="5 Ekim 2026"
    >
      <LegalSection no="1." title="Kimler Katılabilir">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Programa, EmlakSoft&apos;ta aktif ve ücretli aboneliği bulunan ofisler katılabilir. Davet bağlantınız panelde Büyüme sayfasında yer alır.</li>
          <li>Davet edilen ofis, daha önce EmlakSoft&apos;ta kaydı olmayan, davet eden ofisten bağımsız yeni bir işletme olmalıdır.</li>
          <li>Program, güncel kampanya ayarlarına göre açık olduğu sürece geçerlidir; kapalıyken davet bağlantısı ödül üretmez.</li>
        </ul>
      </LegalSection>

      <LegalSection no="2." title="Ödül ve Kredi Nasıl Kazanılır">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Kayıt veya ücretsiz deneme tek başına ödül doğurmaz. Davetçi ödülü, davet edilen ofisin{" "}
            <b>ilk gerçek ödemesi</b> ile oluşur; bu ödemenin ardından iade ve iptal penceresini karşılamak üzere
            bir <b>bekleme süresi</b> uygulanır. Bekleme süresi dolduğunda ve ilgili abonelikler hâlâ aktifse ödül hesabınıza tahakkuk eder.
          </li>
          <li>
            Davetçi ödülünün miktarı, ofis yönetimi panelinde tanımlı kural tutarlarına göre belirlenir; genellikle
            aylık paket bedeli esas alınarak aylık paket bedeli kadar kredi şeklindedir. Güncel kural, panelde
            Büyüme sayfasında gösterilir. Bu sayfada sabit bir tutar taahhüt edilmez.
          </li>
          <li>
            Davet edilen ofise, kampanya ayarında tanımlıysa kayıtta bir hoş geldin kredisi verilir. Tutarı kampanya
            ayarına göredir; tanımlı değilse verilmez.
          </li>
          <li>Ödül, deneme süresi, tam kredi ile ödenen faturalar, demo veya iade edilmiş ödemeler için doğmaz. Programın belirlediği kademe bonusları ve üst sınırlar ayrıca uygulanır.</li>
        </ul>
      </LegalSection>

      <LegalSection no="3." title="Hesap Kredisinin Niteliği">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Hesap kredisi, yalnızca EmlakSoft abonelik faturalarında kullanılabilen bir indirim bakiyesidir. <b>Nakde çevrilemez, havale veya iade yoluyla ödenmez, başka ofise veya kişiye devredilemez.</b></li>
          <li>Kredi, tanımlandığı tarihten itibaren <b>365 gün</b> geçerlidir; süresi dolan kısım kullanılamaz. Kampanya kuralı farklı bir süre belirlemişse ödül kaydında gösterilen süre geçerlidir.</li>
          <li>Kredi, bir faturanın en fazla <b>%50</b>&apos;sini karşılayabilir; kalan tutar ödeme yöntemiyle tahsil edilir. Böylece kredi ile tamamen ücretsiz abonelik sürdürülemez.</li>
          <li>Hesabınız kapatılırsa kullanılmamış kredi silinir.</li>
        </ul>
      </LegalSection>

      <LegalSection no="4." title="İade, İptal ve Chargeback Hâlinde Geri Alma">
        <p>
          Ödülün dayanağı olan fatura iade edilirse, ödeme iptal edilirse, kart sahibince itiraz edilip tutar geri
          çekilirse (chargeback) veya davet edilen ofisin aboneliği iptal edilirse ilgili ödül geri alınır. Ödül
          kredi olarak yüklenmişse kredi bakiyenizden düşülür; kredi kullanılmış ise bakiye negatife düşebilir ve
          sonraki kredi kazanımlarınızla mahsup edilir. Kısmi iadelerde de ödül, program koşullarına göre bütünüyle geri alınabilir.
        </p>
      </LegalSection>

      <LegalSection no="5." title="Kötüye Kullanım">
        <p>Aşağıdaki durumlar kötüye kullanım sayılır ve ödülün reddedilmesine, iptaline veya geri alınmasına, gerekirse davet bağlantısının kapatılmasına yol açabilir:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Kendi kendini davet etme; aynı işletmenin, aynı vergi numarasının veya aynı telefonun farklı hesaplarla tekrar kayıt olması,</li>
          <li>Birden fazla hesap açarak veya sahte, danışıklı ya da yalnızca ödül almaya yönelik kayıt oluşturarak yararlanma,</li>
          <li>Yanıltıcı beyan, spam veya mevzuata aykırı yöntemlerle davet bağlantısı yayma,</li>
          <li>Ödeme sistemini veya program kurallarını manipüle etme girişimleri.</li>
        </ul>
        <p>
          EmlakSoft şüpheli kayıtları inceleme kuyruğuna alabilir; inceleme sonucunda ödülü kabul etme, reddetme veya
          iptal etme hakkını saklı tutar. Kararın gerekçesi talep edilmesi hâlinde bildirilir.
        </p>
      </LegalSection>

      <LegalSection no="6." title="Tavanlar ve Sınırlar">
        <p>
          Programda yıllık ve/veya aylık kazanım üst sınırları, günlük davet hızı sınırları ve kademe kuralları
          uygulanabilir. Sınırı aşan ödül kırpılabilir veya sonraki döneme bırakılabilir. Güncel sınırlar panelde
          Büyüme sayfasında gösterilir.
        </p>
      </LegalSection>

      <LegalSection no="7." title="Davet Bağlantısının Paylaşılması ve Ticari İleti">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Davet bağlantısını yalnızca <b>kendi iletişim kanalınızdan</b> (kendi e-postanız, mesajlaşma uygulamanız, yüz yüze görüşme vb.) ve ilgili kişinin ticari ileti mevzuatına uygun olarak paylaşırsınız.</li>
          <li><b>EmlakSoft, sizin adınıza kimseye e-posta veya SMS göndermez.</b> Paylaşımın ve paylaşımın hukuka uygunluğunun sorumluluğu davetçiye aittir; izinsiz toplu ileti gönderimi yasaktır.</li>
          <li>Davet bağlantısı kişisel veri içermez; davet ettiğiniz kişinin telefon, e-posta gibi bilgileri tarafımızca sizden toplanmaz.</li>
        </ul>
      </LegalSection>

      <LegalSection no="8." title="Kişisel Veriler (KVKK)">
        <p>
          Davet bağlantısıyla gelen ziyaretçiye, kayıt ekranında davet eden ofisin <b>adı</b> gösterilir. Davet
          edilen ofisin kayıt ve ödeme bilgileri, davetçi ofise gösterilmez; davetçi yalnızca davetin durumunu
          (tıklama, kayıt, ödeme/ödül durumu) görür. Verilerin işlenmesine ilişkin ayrıntılar{" "}
          <Link className="font-semibold text-brand-600" href="/kvkk-aydinlatma">KVKK Aydınlatma Metni</Link>&apos;nde yer alır.
        </p>
      </LegalSection>

      <LegalSection no="9." title="Ortak (Nakit Komisyonlu) Program">
        <p>
          Profesyonel ortaklar için nakit komisyon esaslı bir program <b>henüz açık değildir</b>. Bu sayfadaki
          ödüller yalnızca hesap kredisidir ve nakit ödeme içermez. Ortak programı açıldığında ayrı bir sözleşme ve
          koşullarla duyurulacaktır.
        </p>
      </LegalSection>

      <LegalSection no="10." title="Program Değişikliği ve Sonlandırma">
        <p>
          EmlakSoft programı, ödül kurallarını ve bu koşulları değiştirme, durdurma veya sonlandırma hakkını saklı
          tutar. Değişiklikler yayımlandığı tarihten itibaren yeni davetler için geçerli olur; tahakkuk etmiş ödüller
          bu koşullardaki geri alma ve kötüye kullanım hükümleri saklı kalmak kaydıyla korunur. Hesap kredisi
          kullanımı için{" "}
          <Link className="font-semibold text-brand-600" href="/kullanim-sartlari">Kullanım Şartları</Link>, iade süreçleri için{" "}
          <Link className="font-semibold text-brand-600" href="/iptal-iade">İptal &amp; İade Politikası</Link> da geçerlidir.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
