import type { ReactNode } from "react";
import { DeviceFrame } from "../device-frame";
import { Em, SectionHeading } from "../section-heading";
import { CustomersScreen, DealsScreen, FinanceScreen, PortfolioScreen, TodayScreen } from "./screens";

/**
 * JS'siz ürün turu: radyo girdileri + kardeş seçiciler (marketing.css). Tüm ekranlar DOM'dadır (SEO),
 * biri görünür. Oklar radyo grubunda yerel olarak sekmeler arasında gezinir.
 */
const TABS: { id: string; label: string; text: string; screen: ReactNode }[] = [
  { id: "1", label: "Bugün", text: "Görevleriniz ve gün içi randevularınız, açılışta tek bakışta.", screen: <TodayScreen /> },
  { id: "2", label: "Müşteriler", text: "Müşteri listesi ve seçili müşterinin talebi, eşleşmeleri ve notları yan yana.", screen: <CustomersScreen /> },
  { id: "3", label: "Portföy", text: "Portföyleriniz kart görünümünde; yayın teyidi bekleyenler ayrışır.", screen: <PortfolioScreen /> },
  { id: "4", label: "Anlaşmalar", text: "Tekliften tamamlanmaya anlaşmalar aşamalarına göre sütunlarda.", screen: <DealsScreen /> },
  { id: "5", label: "Finans", text: "Komisyon kayıtları ve hakediş durumu, aylık dağılımla birlikte.", screen: <FinanceScreen /> },
];

export function ProductTour() {
  return (
    <section id="tur" className="mk-section mk-alt" aria-labelledby="tur-baslik">
      <div className="mk-wrap">
        <SectionHeading center eyebrow="Ürün turu" title={<span id="tur-baslik">Panelin içine <Em>bir bakın.</Em></span>} text="Beş ana ekranın örnek görünümü. Menüdeki dokuz iş başlığının hepsi aynı kayıtları kullanır." />
        <fieldset className="mk-tour" style={{ border: 0, padding: 0, minInlineSize: 0 }}>
          <legend className="sr-only">Ürün turu ekranı seçin</legend>
          {TABS.map((t, i) => (
            <input key={t.id} type="radio" name="urun-turu" id={`tt${t.id}`} defaultChecked={i === 0} aria-label={t.label} />
          ))}
          <div className="mk-tour-tabs">
            {TABS.map((t) => (
              <label key={t.id} htmlFor={`tt${t.id}`}>{t.label}</label>
            ))}
          </div>
          <div className="mk-tour-screens">
            {TABS.map((t) => (
              <div key={t.id} className={`mk-scr mk-s${t.id}`}>
                <div className="mk-scr-cap">
                  <h3 className="mk-h3">{t.label}</h3>
                  <p>{t.text}</p>
                </div>
                <DeviceFrame label={`EmlakSoft · ${t.label}`}>{t.screen}</DeviceFrame>
              </div>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}
