# ROADMAP.md — EmlakSoft

> Bu dosya kısa ve stabil tutulur; ayrıntılı/sık-güncellenen plan dosyaları aşağıda
> linklenir (onları burada kopyalamak drift'e yol açar — güncel durumu her zaman
> kaynak dosyadan oku).

## Hedef

Ticari beta (güvenilir "Ofis paketi") → tam vizyon. Deploy bilinçli olarak en sona
bırakılmıştı; **artık canlıda** (https://emlaksoft.vercel.app) ve aktif sertleştirme/
geliştirme sürüyor.

## Kaynaklar (güncel durum için buraya bak)

| Dosya | İçerik |
|---|---|
| `docs/MASTER_PLAN.md` | Fazlar, tamamlanan dalgalar, "DURUM" özeti (en sık güncellenen) |
| `docs/ROADMAP_V2.md` | Açık maddeler, sonraki dalga adayları |
| `docs/ROADMAP.md` | Orijinal sprint planı (S0–S11) — büyük ölçüde tamamlandı, tarihsel referans |
| `docs/OZELLIK_MASTER_LISTESI.md` | Tam özellik/tıklanabilirlik envanteri, Faz 0–3 kırılımı |
| `TASKS.md` | Açık iş listesine kısa giriş (bu dosyanın kardeşi) |

## Şu anki büyük eksen (kod tabanından gözlemlenen, tarih için `git log` kontrol et)

Aktif bir güvenlik/güvenilirlik sertleştirme dalgası sürüyor: kimlik/oturum
sertleştirmesi, webhook/public-request güvenliği, atomik faturalama, destek-talebi
(ticket) sisteminin SLA/attachment/CSAT ile genişletilmesi, raporlama aggregate'leri.
Bunların migration/kod durumu için `supabase/migrations/` (dosya adlarındaki tarih
sırası) ve `npm run test` (contract testleri) kaynak alınmalı.

## Kalıcı olarak dış hesap/anlaşma bekleyenler

WhatsApp Business hesabı (Meta), e-posta gönderim sağlayıcısı seçimi (Resend/SMTP/…),
İYS/EİDS resmi entegrasyonu, portal API'leri (Sahibinden/Hepsiemlak/…), MLS mimari
kararı. Kod tarafı çoğunlukla iskelet halinde hazır; aktivasyon bir iş kararı/anlaşma
gerektiriyor.
