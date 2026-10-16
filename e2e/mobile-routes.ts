/**
 * Mobil süpürme (MP12) rota listesi: telefonda en çok açılan panel ekranları. Finans / kazanç sayfaları literal yol
 * olarak YAZILMAZ (rota taşımaları sürüyor): menüden etiketle bulunur (`discover`). Detay sayfaları liste ekranındaki
 * ilk kayıt bağlantısından çözülür; kayıt yoksa atlanır (sahte geçiş yok).
 */
export type SweepRoute =
  | { kind: "path"; path: string; name: string }
  | { kind: "discover"; label: RegExp; name: string }
  | { kind: "first-row"; list: string; hrefPattern: RegExp; name: string };

export const SWEEP_VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

export const SWEEP_ROUTES: readonly SweepRoute[] = [
  { kind: "path", path: "/app", name: "Bugün" },
  { kind: "path", path: "/app/musteriler", name: "Müşteriler" },
  { kind: "first-row", list: "/app/musteriler", hrefPattern: /^\/app\/musteriler\/[0-9a-f-]{36}$/, name: "Müşteri detayı" },
  { kind: "path", path: "/app/portfoyler", name: "Portföyler" },
  { kind: "first-row", list: "/app/portfoyler", hrefPattern: /^\/app\/portfoyler\/[0-9a-f-]{36}$/, name: "Portföy detayı" },
  { kind: "path", path: "/app/talepler", name: "Talepler" },
  { kind: "path", path: "/app/randevular", name: "Randevular" },
  { kind: "path", path: "/app/gorevler", name: "Görevler" },
  { kind: "path", path: "/app/anlasmalar", name: "Anlaşmalar" },
  { kind: "path", path: "/app/teklifler", name: "Teklifler" },
  { kind: "path", path: "/app/sozlesmeler", name: "Sözleşmeler" },
  { kind: "path", path: "/app/kiralama", name: "Kiralama" },
  { kind: "path", path: "/app/raporlar", name: "Raporlar" },
  { kind: "path", path: "/app/bolge-analizi", name: "Bölge analizi" },
  { kind: "path", path: "/app/raporlar/yetki-uyum", name: "Yetki uyumu" },
  { kind: "path", path: "/app/ekip", name: "Ekip" },
  { kind: "path", path: "/app/ayarlar", name: "Ayarlar" },
  { kind: "path", path: "/app/hizli", name: "Hızlı ekle" },
  { kind: "path", path: "/app/musteriler/yeni", name: "Yeni müşteri" },
  { kind: "path", path: "/app/portfoyler/yeni", name: "Yeni portföy" },
  { kind: "path", path: "/app/gelen-kutusu", name: "Gelen kutusu" },
  { kind: "discover", label: /^(Finans|Muhasebe)$/, name: "Finans" },
  { kind: "discover", label: /^(Kazancım|Cüzdan|Kasam)$/, name: "Kazancım" },
];

/** Dokunma hedefi alt sınırı (px; yuvarlama payı ile). */
export const MIN_TARGET = 43.5;
