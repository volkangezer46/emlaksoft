/**
 * Danışman koçu (X3) — KPI'lardan haftalık aksiyon listesi.
 *
 * ============================================================================
 * NEDEN GEREKLİ
 * ============================================================================
 * `/app/danisman-kpi` sayfası doğru sayıları gösteriyor: müşteri, çağrı,
 * randevu, teklif, anlaşma, ciro. Ama bir tabloya bakıp "bu hafta ne
 * yapmalıyım" sorusunu cevaplamak danışmanın işi olarak kalıyordu.
 *
 * Sayı ile aksiyon arasındaki mesafe bu modülün varlık sebebi:
 *   "0 randevu"        →  "Bu hafta 3 sıcak müşteriye randevu ver"
 *   "12 çağrı 0 teklif" →  "Görüşmeler tekliften önce kesiliyor"
 *
 * ============================================================================
 * TASARIM SINIRLARI
 * ============================================================================
 * · EN FAZLA 4 ÖNERİ. Onbir maddelik bir liste kimsenin okumadığı bir
 *   listedir; öncelik sırasına göre kesiliyor.
 * · Her öneri ÖLÇÜLEBİLİR bir sayı içeriyor ("3 müşteri", "%12"). "Daha çok
 *   ara" gibi bir cümle aksiyon değil, temenni.
 * · Övgü de bir öneri: her şey iyiyse boş liste değil, neyin çalıştığı yazılır.
 *   Boş bir koç paneli "veri yok" gibi görünür ve güven kaybettirir.
 * · KURAL TABANLI. Öğrenen bir model değil; eşikler emlak operasyonunda
 *   yaygın kabul gören oranlardan seçildi ve hepsi burada tek yerde.
 */

export type CoachInput = {
  /** Bu ay: aktif müşteri sayısı (danışmana atanmış). */
  customerCount: number;
  callCount: number;
  appointmentCount: number;
  offerCount: number;
  dealCount: number;
  revenue: number;
  /** Uzun süre dokunulmamış müşteri sayısı. */
  staleCustomerCount: number;
  /** Sıcak (yüksek skorlu) müşteri sayısı. */
  hotCustomerCount: number;
  /** Fiyatı piyasa üstü işaretlenmiş portföy sayısı. */
  overpricedCount: number;
  /** Yetki belgesi süresi 15 gün içinde dolan portföy sayısı. */
  expiringAuthCount: number;
  /** Gecikmiş görev sayısı. */
  overdueTaskCount: number;
  /** Ekip ortalaması — kıyas için (yoksa kıyas yapılmaz). */
  teamAvgDeals?: number | null;
};

export type CoachAction = {
  /** Sıralama için: küçük olan önce. */
  priority: number;
  kind: "urgent" | "improve" | "praise";
  title: string;
  detail: string;
};

const MAX_ACTIONS = 4;

/** Yüzde, sıfıra bölmeden. */
function oran(a: number, b: number): number | null {
  if (!b || b <= 0) return null;
  return Math.round((a / b) * 100);
}

export function buildCoachActions(s: CoachInput): CoachAction[] {
  const out: CoachAction[] = [];

  // ---- ACİL: tarihi geçmiş yükümlülükler ----
  if (s.expiringAuthCount > 0) {
    out.push({
      priority: 1,
      kind: "urgent",
      // Yetki belgesi bitmiş portföyde işlem yapmak mevzuata aykırı; bu yüzden
      // en yüksek öncelik.
      title: `${s.expiringAuthCount} portföyün yetki süresi doluyor`,
      detail: "Yetki belgesi bitmiş portföyde aracılık yapmak mevzuata aykırı. Yenilemeyi bu hafta bitirin.",
    });
  }
  if (s.overdueTaskCount > 0) {
    out.push({
      priority: 2,
      kind: "urgent",
      title: `${s.overdueTaskCount} gecikmiş görev`,
      detail: "Gecikmiş takip, kaybedilen müşterinin en sık sebebi. Önce bunları kapatın.",
    });
  }

  // ---- DÖNÜŞÜM HUNİSİNDEKİ KOPMA ----
  // Sıralama önemli: huninin NEREDE koptuğunu tek bir öneriye indiriyoruz,
  // yoksa aynı sorun üç ayrı satır olarak görünür.
  const gorusmeOrani = oran(s.appointmentCount, s.callCount);
  const teklifOrani = oran(s.offerCount, s.appointmentCount);
  const kapanisOrani = oran(s.dealCount, s.offerCount);

  if (s.callCount >= 10 && s.appointmentCount === 0) {
    out.push({
      priority: 3,
      kind: "improve",
      title: `${s.callCount} çağrı, hiç randevu yok`,
      detail: "Görüşmeler randevuya dönmüyor. Kapanış cümlesini gözden geçirin: aramayı net bir buluşma teklifiyle bitirin.",
    });
  } else if (gorusmeOrani != null && s.callCount >= 20 && gorusmeOrani < 10) {
    out.push({
      priority: 4,
      kind: "improve",
      title: `Çağrı → randevu dönüşümü %${gorusmeOrani}`,
      detail: "Sektörde %15-20 bandı beklenir. Aradığınız listenin niteliğini ya da açılış cümlenizi değiştirmeyi deneyin.",
    });
  } else if (s.appointmentCount >= 5 && s.offerCount === 0) {
    out.push({
      priority: 4,
      kind: "improve",
      title: `${s.appointmentCount} görüşme, hiç teklif yok`,
      detail: "Görüşmeler tekliften önce kesiliyor. Fiyat beklentisini görüşmenin başında netleştirin.",
    });
  } else if (teklifOrani != null && s.appointmentCount >= 8 && teklifOrani < 20) {
    out.push({
      priority: 5,
      kind: "improve",
      title: `Görüşme → teklif dönüşümü %${teklifOrani}`,
      detail: "Gösterdiğiniz portföyler talebe tam oturmuyor olabilir. Eşleştirme sayfasından skoru yüksek eşleşmelere odaklanın.",
    });
  } else if (kapanisOrani != null && s.offerCount >= 5 && kapanisOrani < 25) {
    out.push({
      priority: 5,
      kind: "improve",
      title: `Teklif → anlaşma dönüşümü %${kapanisOrani}`,
      detail: "Teklifler kapanmıyor. Liste fiyatı ile piyasa arasındaki farkı ve pazarlık payını yeniden değerlendirin.",
    });
  }

  // ---- DEĞERLENDİRİLMEYEN FIRSAT ----
  if (s.hotCustomerCount > 0 && s.appointmentCount === 0) {
    out.push({
      priority: 3,
      kind: "improve",
      title: `${s.hotCustomerCount} sıcak müşteri, randevu yok`,
      detail: `Bu hafta en az ${Math.min(3, s.hotCustomerCount)} tanesine randevu verin — sıcaklık en hızlı kaybedilen şey.`,
    });
  }
  if (s.staleCustomerCount >= 5) {
    out.push({
      priority: 6,
      kind: "improve",
      title: `${s.staleCustomerCount} müşteriye uzun süre dokunulmadı`,
      detail: "Soğumuş kayıtlar dönüşmez. Bu hafta 5 tanesini arayıp durumlarını güncelleyin.",
    });
  }
  if (s.overpricedCount > 0) {
    out.push({
      priority: 6,
      kind: "improve",
      title: `${s.overpricedCount} portföy piyasa üstü fiyatlı`,
      detail: "Fiyat sağlığı kırmızı olan portföyler ilan havuzunda görünmez kalır. Mülk sahibiyle fiyat görüşmesi planlayın.",
    });
  }

  // ---- EKİP KIYASI ----
  // Kıyas yalnızca ekip ortalaması VARSA; yoksa uydurulmuş bir hedef verilmez.
  if (s.teamAvgDeals != null && s.teamAvgDeals > 0) {
    if (s.dealCount === 0) {
      out.push({
        priority: 7,
        kind: "improve",
        title: "Bu ay hiç anlaşma kapanmadı",
        detail: `Ekip ortalaması ${s.teamAvgDeals.toFixed(1)}. Pipeline'da müzakere aşamasındaki anlaşmalara odaklanın.`,
      });
    } else if (s.dealCount > s.teamAvgDeals * 1.3) {
      out.push({
        priority: 9,
        kind: "praise",
        title: `Ekip ortalamasının üstünde: ${s.dealCount} anlaşma`,
        detail: `Ortalama ${s.teamAvgDeals.toFixed(1)}. Bu ritmi bozan bir şey yapmayın.`,
      });
    }
  }

  // ---- ÖVGÜ ----
  // Boş bir koç paneli "veri yok" gibi görünür ve güven kaybettirir.
  if (out.filter((a) => a.kind !== "praise").length === 0) {
    if (s.customerCount === 0) {
      out.push({
        priority: 8,
        kind: "improve",
        title: "Henüz atanmış müşteri yok",
        detail: "Müşteri eklendikçe bu panel kişiselleşir. Ofis yöneticinizden atama isteyin.",
      });
    } else {
      out.push({
        priority: 9,
        kind: "praise",
        title: "Huni sağlıklı görünüyor",
        detail: `${s.callCount} çağrı · ${s.appointmentCount} randevu · ${s.offerCount} teklif · ${s.dealCount} anlaşma. Acil bir kopma yok.`,
      });
    }
  }

  return out.sort((a, b) => a.priority - b.priority).slice(0, MAX_ACTIONS);
}
