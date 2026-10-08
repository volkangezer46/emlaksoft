# Yol haritası — 2026-10-08 (akşam)

Girdiler: ürün sahibi talepleri (rapor düğmeleri, fiyatlar, EmlakFiyati kontör, kira/aidat/mülk sahibi, modül paketleri, yarım işler),
`docs/design/FIYAT_ARASTIRMA_2026-10.md`, kod taraması. ANA İLKE: menü sadeliği (yeni özellik = sekme/kart, menü öğesi değil).

## Dalga 1 (şimdi, paralel, ayrık alanlar)
| Paket | Kapsam | Not |
|---|---|---|
| R1 Rapor düğmeleri | Tüm sayfa içi "Raporlarda aç"/indirme düğmeleri kaldırılır; raporlar yalnız Raporlar > Rapor merkezi; sözleşme testi | ÇALIŞIYOR |
| P1 Fiyatlandırma | Paketler rakiplerin %25-30 altı (Danışman 749 / Ofis 2.790 / Profesyonel 5.490 / Kurumsal 14.900, ek kullanıcı kademeleri); EmlakFiyati 1 kontör = 1 TL, ilan analizi 1 kontör, değerleme raporu konut 700 / arsa 850 / ticari 1.050 kontör; kontör paketleri 100-5.000 (1,00→0,80 TL); paket aylık kontör hakları yeniden; mevcut aboneler fiyat kilidinde kalır | admin'den düzenlenebilir kalır |
| M1 Mülk yönetimi omurgası | Kira tahsilat kaydı (kısmi ödeme, yöntem, makbuz no), gecikme; mülk sahibi hakediş defteri (tahsilat − yönetim ücreti − gider = ödenecek), ödeme kaydı, yönetim ücreti → ofis geliri, malik ekstresi (portal + PDF) | Kiralama sayfasında sekmeler |
| MOD1 Modül paketleri | "Mülk yönetimi", "Pazarlama", "Kurumsal/Ekip", "Değerleme & analiz" gibi hazır paketler; ofis tek tuşla açar/kapatır; danışman kendi görünümünde kişisel gizleme | Kapalı modül menüde hiç görünmez |

## Dalga 2
| Paket | Kapsam |
|---|---|
| M2 Bina/site yönetimi | Bina + bağımsız bölümler, aidat tahakkuku ve dağıtım (eşit/arsa payı/m²), ortak gider paylaştırma, borç-alacak, aidat hatırlatma, yönetici ekstresi |
| TR1 Türkiye pazarı | EİDS/yetki durumu kuyruğu, merkezi İYS gönderim kapısı (kampanya/SMS/e-posta), portal maliyet → ROI (mevcut) bağlantısı |
| V1 Canlı set tamamlama | Admin SVG grafikleri canlı grafik setine; admin audit 14 gün sayımı SQL'e |
| C1 Müşteri tarafı | Müşteri portalında tapu süreci ilerleme çubuğu; sesli not → AI özet (KVKK rızası, varsayılan kapalı); lead routing (yük/uzmanlık/SLA) |
| Rakip özellik açıkları | Raporu WhatsApp ile gönder, kapalı portföy, ilan çevirisi (AI), 360° tur alanı, reklam/portal dağıtımı — mevcut olanlar doğrulanır, eksikler sekme olarak |

## Karar bekleyen (ürün sahibi)
Paket kullanıcı tavanları (3/15/50), kayıtta e-posta doğrulaması, kira TÜFE tavanı, "denemeyi uzat", değerleme kontör fiyatlarının (700/850/1.050) teyidi.

## Temizlik
Eski dallar (`worktree-agent-a26cda22…` yalnız eski belge, `…aaa0895…` K4 zaten taşındı) — silinebilir; `perf-tmp.mjs` geçici dosya.
