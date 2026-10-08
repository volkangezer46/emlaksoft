/**
 * Puan KANIT bağlantıları — lig'de görünen her adet, o puanı üreten kayıtların listesine gider
 * ("sıfır çıkmaz metrik"). Yalnız hedef sayfanın GERÇEKTEN desteklediği filtreler kullanılır
 * (olmayan bir query paramı uydurmak `check:links` kontratını kırar).
 */
import type { ScoreRuleKey } from "@/lib/gamification";

export function evidenceHref(rule: ScoreRuleKey, staffId: string): string {
  switch (rule) {
    case "deal_won":
      return `/app/anlasmalar?danisman=${staffId}`;
    case "property_new":
    case "listing_authorized":
      return `/app/portfoyler?danisman=${staffId}`;
    case "appointment_done":
    case "showing_done":
      return `/app/randevular?danisman=${staffId}`;
    case "task_done":
      return `/app/gorevler?danisman=${staffId}`;
    case "customer_new":
      return `/app/musteriler?assigned=${staffId}`;
    case "offer_made":
      return `/app/teklifler?danisman=${staffId}`;
    case "fast_response":
      return "/app/raporlar/lead-hizi";
    case "listing_confirmed":
      return "/app/ilan-kontrol";
    case "nps_promoter":
      return "/app/raporlar/memnuniyet";
    case "leak_sla_response":
      return "/app/kayip-kacak";
  }
}
