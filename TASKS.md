# TASKS.md — EmlakSoft

> Görev takibi bu depoda üç seviyede yapılır: (1) uzun-vadeli/kapsamlı envanter
> `docs/OZELLIK_MASTER_LISTESI.md`'de, (2) faz/dalga durumu `docs/MASTER_PLAN.md` +
> `ROADMAP.md`'de, (3) bu dosya — **kısa vadeli, tarihli anlık görüntü** (snapshot).
> Yeni bir oturum açan AI, işe başlamadan önce `git log --oneline -20` ve
> `git status --short` ile gerçek durumu doğrulamalı; bu dosya bir başlangıç noktasıdır,
> tek doğruluk kaynağı değildir.

## Son anlık görüntü — 2026-08-02

Kapsamlı bir denetim (ticket sistemi + ~286 dosyalık eşzamanlı güvenlik sertleştirme
dalgası) sonrası tespit edilen punch-list, "hepsini sırayla yap" talimatıyla ele alındı.

**Düzeltildi (bu oturumda):**
- Destek-talebi demo seed verisi kendi bütünlük kuralını (terminal integrity) ihlal
  ediyordu → düzeltildi.
- Ticket kuyruğunda sayfa değişince eski seçimin kalması → render-sırasında budama.
- CSAT (müşteri memnuniyeti) skoru hiçbir admin ekranında görünmüyordu → detay
  sayfasına eklendi.
- Toplu "kategori değiştir" backend'de vardı, toolbar'da seçenek olarak sunulmuyordu
  → eklendi.
- 5 adet kullanılmayan (ölü) server action temizlendi (`assignTicketStaffAction`,
  `createTicketMacroAction`, `deleteTicketMacroAction`, `setTicketStatus`,
  `setTicketStatusTenantAction`).
- Komisyon/raporlama/gider "bu ay" hesapları UTC'ye göre yapılıyordu (İstanbul'a
  değil) → hem SQL RPC hem sayfa tarafı `Europe/Istanbul`'a sabitlendi.
- **KRİTİK — `permission_defaults` tablosunda RLS açıktı ama HİÇ read policy yoktu**
  → `has_effective_permission()` INVOKER olduğu için bu, tüm tenant'larda TÜM
  yetki kontrollerinin sessizce `false` dönmesine yol açıyordu (uygulama genelinde
  bozukluk — demo-login redirect loop'u dahil). `20260802000460` migration'ıyla
  düzeltildi, 8 sayfalık smoke testle doğrulandı.
- 9 bekleyen migration (`20260802*`: security/lifecycle hardening, webhook
  compliance, identity/session hardening, plan entitlements, reporting aggregates,
  observability/privacy hardening, public schema boundary, atomic demo conversion,
  customer document security) `apply-one.ts` ile sırayla uygulandı.
- `giderler` sayfasının KPI toplamları `listExpenses().limit(200)`'den hesaplanıyordu
  (200 kayıttan sonra sessizce yanlış) → yeni `tenant_expense_aggregates` RPC'siyle
  tam toplam.
- `takvim/[token]` ve `danisman/[slug]/vcard`: rate-limit `failurePolicy: "deny"`
  eksikti → eklendi (mekanik contract test kapsamına alındı).
- `team.ts` şube oluşturma/güncellemede plan limiti hatası kullanıcıya generic
  mesaj olarak gidiyordu → `planLimitErrorMessage` ile anlamlı mesaj.
- `csv.ts`: PostgREST'in `numeric` kolonları için döndürdüğü negatif sayısal
  string'ler ("-250.00") formül-enjeksiyon korumasınca yanlışlıkla nötrleniyordu.
- `public-valuation.ts`: vitrin değerleme formu diğer public formların aksine
  rate-limit ve KVKK onayı toplamıyordu → ikisi de eklendi (consent event kaydı ile).
- **P0 — `imza/[token]` ve `odeme-link/[token]` (hukuki imza + ödeme tahsilatı)
  tenant yaşam-döngüsü kontrolünden muaftı** — askıya alınmış/iptal edilmiş bir
  tenant'ın imza/ödeme linki hâlâ çalışıyordu. `isPublicTenantActive` kontrolü hem
  sayfalara hem arkasındaki server action'lara (`contracts.ts`, `payment-links.ts`)
  eklendi; ayrıca bu iki sayfada — diğer 18 public/[token] sayfasının aksine —
  `export const dynamic = "force-dynamic"` de eksikti (canlı imza/ödeme durumu
  önbelleğe takılabiliyordu) → düzeltildi. `payment-links.ts`'te ayrıca
  `checkRateLimit` çağrısı hiç yoktu → eklendi. Canlı DB + dev sunucu üzerinde
  tenant'ı askıya alıp/geri alarak doğrulandı.
- Meta webhook ucunda gövde-boyutu sınırı yoktu (DoS riski) + GET handshake sabit-zaman
  karşılaştırma kullanmıyordu → ikisi de düzeltildi.
- Kampanya formunda e-posta kanalı seçilebilir görünüyordu ama gönderim katmanı hiç
  yazılmamıştı → kanal devre dışı bırakılıp "(yakında)" notu eklendi.
- Kök dizine `PROJECT_CONTEXT.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `TASKS.md`,
  `CHANGELOG.md` eklendi — farklı bir AI/araç seti kullanılsa da projeye hızlı
  adaptasyon için (mevcut `docs/*.md`'yi özetler, tekrar etmez).

**Bilinen, KULLANICI kararı/koordinasyon gerektiren açık kalemler:**
- `support_tickets.version` alanı arayüzde gösteriliyor ama hiçbir RPC gerçek
  eşzamanlılık (optimistic concurrency) kontrolü yapmıyor — iki personel aynı anda
  aynı talebi işlerse biri diğerinin çözüm kaydını sessizce silebilir. Düzeltme
  migration/RPC değişikliği gerektiriyor; eşzamanlı geliştirme dalgasıyla koordine
  edilmeli.
- E-posta gönderim sağlayıcısı (Resend/SMTP/…) seçimi — iş kararı.
- WhatsApp Business hesabı bağlanması — Meta ile iş anlaşması; kod tarafı hazır
  (`src/app/api/webhooks/meta/route.ts` içinde `STUB:` işaretli).

Tam liste ve öncelik sıralaması için ilgili oturumun sohbet kaydına veya
`docs/DEVIR_NOTU.md`'ye bakılabilir.

## Uzun vadeli envanter

`docs/OZELLIK_MASTER_LISTESI.md` — Faz 0 (tamamlandı) → Faz 1 (çekirdek cila) →
Faz 2 (fark yaratanlar) → Faz 3 (platformlaşma, dış anlaşma gerektirenler). Yeni bir
özellik/düzeltme eklerken önce bu dosyada zaten planlı mı diye bakılmalı.
