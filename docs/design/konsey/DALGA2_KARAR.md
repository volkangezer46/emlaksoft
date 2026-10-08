# Uzman Konseyi — Dalga 2 hakem kararı (2026-10-08)

Girdi: `DALGA1_OZET.md` (8 rapor: Ar-Ge, TR pazar, Dünya pazar, Ürün sorgulayıcı, Persona, UI/UX, Güvenlik, Test/Hız).
İlke: önce doğruluk ve kayıp satış, sonra sadeleştirme, sonra yeni özellik. Mükerrer yapma; mevcut bileşeni genişlet.

## Dalga 3 — UYGULA (6 mühendis + 1 belge, ayrık alanlar)
| İş paketi | Kapsam | Gerekçe |
|---|---|---|
| A. Public vitrin + kayıt güveni | İlan detayında iletişim yedeği (form kapalıysa tel/WhatsApp/ofis), harita yer tutucu + tek bağlantı, fotoğrafsız ilan yer tutucu, mobil katlanır filtre, vitrin önbellek (ISR/tag), 404 bağlantıları, favoriler boş durum, /kayit adım 1 güven satırı, PhoneInput ülke listesi yalnız açılınca | Persona KRİTİK: müşteri ofise ulaşamıyor = kayıp satış |
| B. Veri doğruluğu | kar-zarar `break` hatası, 1000 satır kesilmesi (franchise, akıllı listeler, kar-zarar → SQL topla ya da sayfalı fetchAll), abonelik-kontrol cron süre bütçesi, dues-client Date.now, network.ts gömme ipucu | Yanlış rakam > eksik özellik |
| C. Ana ekran + başlangıç sadeleştirme | Tek "İlan sağlığı" bloğu, tek "Başlangıç" kartı (en çok 2 bant), baslangic ofis adımı → profil-tamamla, PortfoySagligi rol süzgeci, `hizli` bloğu çıkar, ust-bolum clock + token renk, ana ekran dokunma hedefleri 44px | "Bir metrik bir kez" kuralı; ilk izlenim |
| D. Menü IA | Portal ilanları → İlan Kontrol sekmesi; Teklifler → Anlaşmalar sekmesi (danışman çekirdeği); Riskli müşteriler → Akıllı Listeler sekmesi; Ofis başlığı çekirdek + "Yönetim" alt grubu; menüden Bildirimler çık (zil); Gelen Kutusu → Müşteriler + mobil sekme. Yollar korunur (NAV_ALIASES/yönlendirme) | Sadelik, danışman günlük akışı |
| E. Admin UI kiti | Ham button/input/filter → Button/Input/FilterBar, focus-ring, çipler 44px dokunma, tenant-table truncate, billing min-w-0, aktivite overflow, confirm()/prompt() → kanonik diyalog/toast, admin boş durum CTA | Tutarlılık + erişilebilirlik |
| F. Güvenlik/billing artıkları + test | Kayıtta ekip daveti sunucuda kapalı (uygulama içi sihirbaza), kayıt hız sınırına e-posta anahtarı, schedule_downgrade gizli plan kontrolü (001000 uygulanmadı → dosyada), plan_upgrade açık fatura idempotency, profile-completion-data + lifecycle-facts testleri | Denetim bulguları |
| G. Belge | HAFIZA.md "GÜNCEL DURUM" ~150 satır, bayat maddeler `docs/arsiv/`e | Sonraki oturum maliyeti |

## ERTELE / SAHİP KARARI
- Kapsam (takım/şube) RLS'e taşınması — L efor, karar.
- `commission_rate`/`min_price` DB kapısı + satır kapsamı — karar.
- Komisyon makbuzu / e-arşiv — mali müşavir + sağlayıcı kararı.
- Kayıtta e-posta doğrulaması — sahip kararı (sürtünme vs güvenlik).
- Tek "müşteri durumu" skor okuyucusu (6 model) — Dalga 3 sonrası, M efor.
- TR pazar özellikleri: EİDS/yetki durumu kuyruğu, İYS gönderim kapısı, portal maliyet takibi — mevcut kod (yetki belgesi uyarısı, portföy yetki bitişi, KVKK/İYS uyum) doğrulandıktan sonra ayrı tur.
- Dünya fikirleri: sesli not→AI özet, tapu süreci ilerleme çubuğu (müşteri portalı), AI ilk temas taslağı, lead routing — ayrı ürün turu.
- iyzico sandbox uçtan uca, SMS/WhatsApp sandbox, speed-insights kurulumu, platform MFA — sahip işi/onayı.
- Dal/worktree temizliği — yalnız birleşmiş olanlar, sahip bilgisiyle.
