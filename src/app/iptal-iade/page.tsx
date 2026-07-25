import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "İptal & İade Politikası | EmlakSoft",
  description: "Abonelik iptali, cayma hakkı ve iade koşulları.",
  alternates: { canonical: "/iptal-iade" },
};

export default function IptalIadePage() {
  return (
    <LegalPage
      title="İptal & İade Politikası"
      intro="Aboneliğinizi dilediğiniz zaman iptal edebilirsiniz. Bu sayfa cayma hakkı, iptal ve iade süreçlerini şeffaf biçimde açıklar."
    >
      <LegalSection no="1." title="Ücretsiz Deneme">
        <p>
          Tüm planlar 14 gün ücretsiz denenebilir; deneme için kredi kartı istenmez. Deneme süresi sonunda ücretli
          plana geçmezseniz herhangi bir ücret tahakkuk etmez; verileriniz makul bir süre saklandıktan sonra silinir.
        </p>
      </LegalSection>

      <LegalSection no="2." title="Abonelik İptali">
        <p>
          Aboneliğinizi panel içinden (Ayarlar → Abonelik) veya{" "}
          <a className="font-semibold text-brand-600" href="mailto:destek@emlaksoft.app">destek@emlaksoft.app</a>{" "}
          üzerinden dilediğiniz an iptal edebilirsiniz. İptal, mevcut fatura döneminin sonunda yürürlüğe girer;
          dönem sonuna kadar hizmete erişiminiz devam eder. Taahhüt yoktur, cayma bedeli alınmaz.
        </p>
      </LegalSection>

      <LegalSection no="3." title="Cayma Hakkı ve İade">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Sözleşmenin kurulmasından itibaren <b>14 gün</b> içinde cayma hakkınızı kullanabilirsiniz.</li>
          <li>Onayınızla hizmetin ifasına derhâl başlandığından, kullanılan döneme isabet eden bedel Mesafeli Sözleşmeler Yönetmeliği m.15/1-ğ uyarınca iade kapsamı dışındadır.</li>
          <li>Yıllık planlarda, kullanılmamış tam aylara isabet eden bedel talep hâlinde iade edilir.</li>
          <li>Onaylanan iadeler, bildirimin ulaşmasından itibaren <b>14 gün</b> içinde, ödemenin yapıldığı yöntemle iade edilir.</li>
        </ul>
      </LegalSection>

      <LegalSection no="4." title="Hizmet Kaynaklı Sorunlar">
        <p>
          Platform kaynaklı, belgelenmiş ve 24 saati aşan kesintilerde, etkilenen süreye isabet eden bedel bir
          sonraki faturadan mahsup edilir veya talep hâlinde iade edilir.
        </p>
      </LegalSection>

      <LegalSection no="5." title="Veriniz Sizindir">
        <p>
          İptal sonrasında ofis verinizin tamamını (müşteri, portföy, işlem kayıtları) makine-okur formatta dışa
          aktarmanız için offboarding paketi sağlanır. Ayrıntılar için{" "}
          <Link className="font-semibold text-brand-600" href="/kvkk-aydinlatma">KVKK Aydınlatma Metni</Link>&apos;ne bakabilirsiniz.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
