/**
 * Yan menü akışlı sayaçlarının DÜZ VERİ sözleşmesi (istemci yan menüsü ve sunucu sayımı `nav-counts.ts` paylaşır; bu
 * dosya bağımlılıksızdır, istemci paketine sunucu istemcisi taşımaz). Sayaç kuralı: kırmızı = gecikmiş, turuncu = karar
 * bekliyor, gri = bilgi.
 */
export type NavCounts = {
  /** Sayfa yolu → bilgi sayısı (gri; yalnız > 0 olanlar). */
  counts: Record<string, number>;
  /** Sayfa yolu → gecikmiş iş sayısı (kırmızı; yalnız > 0 olanlar). */
  alerts: Record<string, number>;
  /** Sayfa yolu → durum noktası (ör. sahibinden eşitlemesi taze: "ok", 3 günden eski: "warn"). */
  dots: Record<string, "ok" | "warn">;
};

/** Sayaç anlamı ve süzgeçli hedefi (sıfır çıkmaz metrik: sayaç kümeyi veren listeyi açar). */
export const NAV_COUNT_META: Readonly<Record<string, { label: string; href: string }>> = {
  "/app/randevular": { label: "bugünkü randevu", href: "/app/randevular?gorunum=gun" },
  "/app/ilan-havuzu": { label: "atanmayı bekleyen ilan", href: "/app/ilan-havuzu" },
  "/app/kiralama": { label: "geciken kira", href: "/app/kiralama?durum=overdue" },
  // Yalnız "Ofis geneli" görünümünde (yönetim): ana ekran Dikkat listesinin ofis geneli geciken görev kalemiyle aynı küme.
  "/app/gorevler": { label: "geciken görev", href: "/app/gorevler?filter=overdue" },
};

