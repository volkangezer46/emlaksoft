import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Em, SectionHeading } from "../section-heading";
import { AutomationArt, CalendarArt, CommissionArt, MatchArt, SignatureArt, ValuationArt } from "./bento-art";

type Card = { id: string; eyebrow: string; title: string; text: string; badge?: string; art: ReactNode };

/* Paket rozetleri plans.ts ile uyumludur: dijital imza Ofis ve üstü; diğerleri Danışman paketinden itibaren. */
const CARDS: Card[] = [
  { id: "a", eyebrow: "Omurga", title: "Müşteri, talep ve portföy bir arada", text: "Müşteri kartı, talep ve portföy eşleştirme aynı akışta; gelen kutusunda hiçbir talep kaybolmaz.", art: <MatchArt /> },
  { id: "b", eyebrow: "Gün planı", title: "Randevu ve görevler", text: "Randevu, görev ve hatırlatmalar tek takvimde.", art: <CalendarArt /> },
  { id: "c", eyebrow: "Para", title: "Komisyon takibi", text: "Bölüşüm ve hakediş kayıt altında.", art: <CommissionArt /> },
  { id: "d", eyebrow: "Fiyat", title: "Emsal bazlı değerleme", text: "Emsal motoruyla fiyat aralığı sinyali.", art: <ValuationArt /> },
  { id: "e", eyebrow: "Sözleşme", title: "Dijital imza", text: "SMS onaylı akış; nitelikli e-imza değildir.", badge: "Ofis ve üstü", art: <SignatureArt /> },
  { id: "f", eyebrow: "Otomasyon", title: "27 otomatik görev", text: "Hatırlatma, teyit ve özetler arka planda çalışır.", art: <AutomationArt /> },
];

export function BentoGrid() {
  return (
    <section id="ozellikler" className="mk-section" aria-labelledby="ozellik-baslik">
      <div className="mk-wrap">
        <SectionHeading center eyebrow="Ürün" title={<span id="ozellik-baslik">Bir ofisin ihtiyacı olan her şey, <Em>birbirine bağlı.</Em></span>} text="Menü dokuz iş başlığına ayrılır; hepsi aynı müşteri ve portföy kaydını kullanır, veriyi tekrar girmezsiniz." />
        <div className="mk-bento">
          {CARDS.map((c) => (
            <a key={c.id} href="#tur" className={`mk-card mk-bcard mk-bento-${c.id} mk-reveal`}>
              <div className="mk-bcard-top">
                <p className="mk-eyebrow">{c.eyebrow}</p>
                {c.badge ? <span className="mk-tag mk-tag-plan">{c.badge}</span> : null}
              </div>
              <h3 className="mk-h3">{c.title}</h3>
              <p>{c.text}</p>
              <div className="mk-art">{c.art}</div>
              <span className="mk-more">Ürün turunda gör <ArrowRight size={16} aria-hidden="true" /></span>
            </a>
          ))}
        </div>
        <p style={{ marginTop: "1.5rem", textAlign: "center", fontSize: "0.875rem", color: "var(--mk-muted)" }}>
          İllüstrasyonlardaki isim ve sayılar örnek veridir. Özelliklerin kapsamı pakete göre değişir; deneme boyunca hepsi açıktır.
        </p>
      </div>
    </section>
  );
}
