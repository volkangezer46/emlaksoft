/**
 * ALACAK / BORÇ — TEK TANIM (her ekranda aynı rakam): "Alacağımız" = `finance_open_items_v` içinde yönü `receivable`,
 * açık tutarı > 0 olan TÜM kalemlerin TL karşılığı toplamı (kira, aidat, komisyon, elle girilen alacak; maaş yalnız
 * owner/gm). Kaynak `finance_overview.receivable_open` (`loadOverview().receivableOpen`); ana sayfa "Para" kartı, Finans
 * genel bakış kartı ve açık kalemler listesi (`?sekme=cari&gorunum=acik&yon=alacak`) AYNI kümedir. "Borcumuz" aynı
 * görünümde `payable`.
 *
 * Eskiden Finans genel bakış "Alacağımız" kartı cari NET bakiyelerinden (`finance_party_balances`, yalnız carisi olan
 * elle girilmiş kalemler, borçla netleşmiş) hesaplanıyordu: ana sayfada ₺592.051, Finans'ta ₺58.351,11 görünüyordu.
 * Cari net bakiyesi Alacak ve borç sayfasındaki kişi/firma listesinin kendi ölçüsüdür ve "Cari net alacak" adını taşır.
 */
export const RECEIVABLE_LABEL = "Alacağımız";
export const RECEIVABLE_HINT = "tahsil edilecek açık kalemler (kira, aidat, komisyon, elle girilen)";
export const PAYABLE_LABEL = "Borcumuz";
export const PAYABLE_HINT = "ödenecek açık kalemler";
/** Cari listesinin (kişi/firma net bakiyesi) kartları — genel tanımla karışmasın diye ayrı ad. */
export const PARTY_NET_RECEIVABLE_LABEL = "Cari net alacak";
export const PARTY_NET_PAYABLE_LABEL = "Cari net borç";

