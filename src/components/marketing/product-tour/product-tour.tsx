import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { DeviceFrame } from "../device-frame";
import { Em, SectionHeading } from "../section-heading";
import { AutomationScreen, CommissionScreen, CustomersScreen, DealsScreen, PortfolioScreen, ReportsScreen, TodayScreen } from "./screens";

/**
 * JS'siz ürün turu: radyo girdileri + kardeş seçiciler (marketing-sections.css). Tüm ekranlar DOM'dadır (SEO),
 * biri görünür. Oklar radyo grubunda yerel olarak sekmeler arasında gezinir. Maddeler gerçek menü/özelliklere dayanır.
 */
const TABS: { id: string; label: string; text: string; points: string[]; screen: ReactNode }[] = [
  { id: "1", label: "Bugün", text: "Günün işi açılışta tek bakışta: görevler, randevular ve yeni talepler.", points: ["Günlük brifing ve AI asistan aynı başlıkta", "Görev ve randevular tek akışta", "Yeni talepler eşleşmeleriyle gelir"], screen: <TodayScreen /> },
  { id: "2", label: "Müşteriler", text: "Müşteri kartı, talep ve eşleşmeler yan yana; hiçbir talep kaybolmaz.", points: ["Müşteri, talep ve eşleştirme bir arada", "Akıllı listeler ve tavsiyeler", "Gelen kutusu ve görüşme notları"], screen: <CustomersScreen /> },
  { id: "3", label: "Portföy", text: "Portföyleriniz durumlarıyla kart görünümünde; yayın teyidi bekleyenler ayrışır.", points: ["Kiralama, proje ve açık ev yönetimi", "Portal kontrolü ve anahtar takibi", "Sunumlar ve ofisler arası ağ"], screen: <PortfolioScreen /> },
  { id: "4", label: "Anlaşmalar", text: "Tekliften tamamlanmaya anlaşmalar aşamalarına göre sütunlarda ilerler.", points: ["Teklif ve sözleşme aynı kayıtta", "SMS onaylı dijital imza (Ofis ve üstü)", "Aşama bazlı takip"], screen: <DealsScreen /> },
  { id: "5", label: "Komisyon", text: "Komisyon kayıtları, bölüşüm ve hakediş durumu aylık dağılımla birlikte.", points: ["Bölüşüm ve hakediş kayıt altında", "Onay akışı", "Cüzdan, gider ve aidat takibi"], screen: <CommissionScreen /> },
  { id: "6", label: "Raporlar", text: "Satış hunisi, danışman karnesi ve kaçan komisyon özeti.", points: ["Satış hunisi ve trendler", "Danışman KPI ve ekip ligi", "Kayıp-kaçak karnesi (Profesyonel)"], screen: <ReportsScreen /> },
  { id: "7", label: "Otomasyon", text: "Hatırlatma, teyit ve özet işleri arka planda zamanlanmış görevlerle çalışır.", points: ["27 otomatik görev", "İş akışı ve onay akışları (Profesyonel)", "Çalışmalar kayıt altına alınır"], screen: <AutomationScreen /> },
];

export function ProductTour() {
  return (
    <section id="tur" className="mk-section mk-alt" aria-labelledby="tur-baslik">
      <div className="mk-wrap mk-wrap-wide">
        <SectionHeading center eyebrow="Ürün turu" title={<span id="tur-baslik">Panelin içine <Em>bir bakın.</Em></span>} text="Yedi ana ekranın örnek görünümü. Menüdeki dokuz iş başlığının hepsi aynı müşteri ve portföy kaydını kullanır." />
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
                  <ul>
                    {t.points.map((p) => (
                      <li key={p}><Check size={16} aria-hidden="true" />{p}</li>
                    ))}
                  </ul>
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
