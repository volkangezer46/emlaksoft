# EmlakSoft — Master Uygulama Planı

**Son güncelleme:** 2026-07-22 (premium-plus)  
**Kaynaklar:** Chat vizyonu · ROADMAP S0–S11 · HGDekor (`C:\projeler\hgdekor`) derin inceleme · mevcut kod envanteri  
**Kalan envanter:** `docs/PREMIUM_PLUS.md`

**Hedef:** Ticari beta (güvenilir Ofis paketi) → tam vizyon (14–18 ay).

### Wave 2–3
- `/app/anlasmalar` deal board · `/app/denetim` · portföy düzenle · `requirePermission` · gerçek JWT impersonation + banner · `useAppApi` strip · günlük özet cron · randevu dedupe
- Wave 3: permission genişleme · Price Health motor · EİDS kalkanı (deal) · müşteri 360 anlaşma/İYS · bildirim tercihleri · PWA SW

### Premium Plus (bu oturum)
- ✅ Sayfa modül kapısı · StatusTransition · eşleştirme kaydet/bildir · realtime refresh · sidebar prefetch
- ✅ Denetim actor/diff/CSV · `notification_prefs` sunucu + cron · ödeme linki iyzico Checkout
- ✅ Dashboard/Phone OS sahte KPI temizliği · müşteri dosya deposu · proaktif leak SLA · `tsc` yeşil

---

## 1) Değerlendirme özeti

| Kaynak | Sonuç |
|--------|--------|
| Chat vizyonu | Türkiye’nin emlak işletim sistemi; kayıp-kaçak, değerleme, İYS/EİDS, Phone OS, ultra premium |
| Kod bugün | Faz 0–6 omurga teslim · beta kapısı hazır (prod iyzico + cron secret ile) |
| HGDekor | Olgun dikey OS: workflow, 360 müşteri, hız cache, cron, bildirim, audit, rol matrisi |
| Strateji | HGDekor işletim DNA’sı × emlak sektör silahları × Command Center premium |

### Değişmez kurallar

- Portal scrape yok
- Tam Türkçe (“lead” yok)
- Her ekran ultra premium (animasyon + grafik + anlamlı boş durum; sahte skor/arama yok)
- AI = API + insan onayı (kendi foundation model yok)
- Multi-tenant cache/realtime’da `tenant_id` izolasyonu zorunlu

---

## 2) Hedef omurga

```
Giriş (web/arama/demo)
  → Müşteri 360
    → Talep + Eşleştirme
      → Portföy + Portal teyit
        → Randevu / Akıllı Arama
          → Deal / sözleşme
            → Zorunlu kapanış + Leak Shield
              → Komisyon defteri + hakediş + ödeme linki
                → Bildirim + audit + rapor + ofis skoru
```

**Platform:** Super Admin (tenant, fatura, ticket, health, impersonation)  
**Hız:** tenant-safe SWR + prefetch + realtime + optimistic UI  
**Kalite:** Command Center premium checklist her PR’da

---

## 3) Fazlar

### FAZ 0 — Kalite & borç — ✅ TAMAMLANDI

| # | İş | Durum |
|---|-----|--------|
| 0.1 | Global arama → Ctrl+K CommandSearch | ✅ |
| 0.2 | Bildirim bell → gerçek unread badge | ✅ |
| 0.3 | Ofis skoru canlı (`office-score.ts`) | ✅ |
| 0.4 | `/demo` formu + `requestDemo` | ✅ |
| 0.5 | Premium checklist (MASTER_PLAN §4) | ✅ |
| 0.6 | `updateCustomer` + düzenle dialog | ✅ |
| 0.7 | Talep edit UI | ✅ |

### FAZ 1 — Panel OS — ✅ TAMAMLANDI

| # | İş | Durum |
|---|-----|--------|
| 1.1 | `notifications` + bell | ✅ |
| 1.2 | Ctrl+K entity search | ✅ |
| 1.3 | Tenant-safe `useAppApi` | ✅ |
| 1.4 | `AppPrefetcher` | ✅ |
| 1.5 | Müşteri 360 sekmeleri | ✅ v1 |
| 1.6 | `audit_logs` writer (`logActivity`) | ✅ |
| 1.7 | Gerçek ofis skoru v1 | ✅ |
| 1.8 | Rol×modül permission + sidebar filtre | ✅ |
| 1.9 | Toast + optimistic status | ✅ |

### FAZ 2 — Workflow + komisyon (S5) — ✅ TAMAMLANDI

| # | İş | Durum |
|---|-----|--------|
| 2.1 | `convertWorkflow` (deal + commission) | ✅ |
| 2.2 | Portal kapanış → deal/komisyon | ✅ |
| 2.3 | Komisyon tahsil + ödeme linki UI | ✅ |
| 2.4 | CSV export (müşteri / komisyon) | ✅ |
| 2.5 | Split oranı (danışman/ofis) | ✅ |
| 2.6 | `payment_links` tablosu | ✅ migration 000008 |

### FAZ 3 — Cron + PWA — ✅ TAMAMLANDI

| # | İş | Durum |
|---|-----|--------|
| 3.1 | `/api/cron/portal-teyit` | ✅ |
| 3.2 | `/api/cron/randevu-hatirlat` | ✅ |
| 3.3 | `/api/cron/abonelik-kontrol` | ✅ |
| 3.4 | `vercel.json` crons | ✅ |
| 3.5 | `/api/health` | ✅ |
| 3.6 | PWA manifest | ✅ |
| 3.7 | `CRON_SECRET` env | ✅ `.env.example` |

### FAZ 4 — Beta kapısı (S6/S9/S10) — ✅ TAMAMLANDI (iskelet)

| # | İş | Durum |
|---|-----|--------|
| 4.1 | Rapor suite `/app/raporlar` | ✅ |
| 4.2 | Ofis skoru raporlarda | ✅ |
| 4.3 | Ops impersonation (cookie + admin önizleme) | ✅ |
| 4.4 | Portföy paylaşım linki `/paylas/[token]` | ✅ |
| 4.5 | Ödeme linki `/odeme-link/[token]` | ✅ |
| 4.6 | iyzico prod | ⬜ sandbox + webhook iskelet (prod anahtarları deploy’da) |
| 4.7 | Akıllı Arama OS MVP | ✅ ekran mevcut · derin enrichment sonra |

### FAZ 5 — Farklılaştırıcılar (S7/S8) — ✅ İSKELET

| # | İş | Durum |
|---|-----|--------|
| 5.1 | Değerleme motoru `/app/degerleme` | ✅ Endeksa/Tapusor canlı kaynak + comps fallback |
| 5.2 | İYS izinleri `/app/uyum` | ✅ |
| 5.3 | EİDS/yetki kalkanı | ✅ UI iskelet · API sonra |
| 5.4 | Belge OCR / AI danışman | ⬜ bilinçli erteleme (API+onay) |
| 5.5 | Price Health | ✅ alan mevcut · motor genişletilecek |

### FAZ 6 — Ölçek — ✅ TAMAMLANDI (v1)

| # | İş | Durum |
|---|-----|--------|
| 6.1 | Franchise BI `/app/franchise` | ✅ gerçek şube rollup |
| 6.2 | Skor/rapor polish | ✅ |
| 6.3 | Offboarding vault / jeton / geo sync | ✅ `/admin/sistem` + `/admin/tenants/[id]` export |
| 6.4 | CI sertleştirme | ✅ lint/build/type-check yeşil |
| 6.5 | PWA push (VAPID) | ✅ `push_subscriptions` + SW push handler |

---

## 4) Ultra premium kapısı

- [x] Dark hero + marka sinyali
- [x] KPI (≥3) animasyonlu
- [x] En az 1 grafik/motion
- [x] Empty state + birincil CTA
- [x] Mobil kırılım
- [x] Sahte/hardcoded metrik yok (ofis skoru canlı)
- [x] Toast / optimistic tutarlı
- [x] Audit (yazma varsa)

---

## 5) Beta kapısı (Faz 4 sonu)

- [x] Uçtan uca ofis demosu (müşteri→talep→eşleşme→portal→kapanış→komisyon)
- [x] Abonelik ödenebilir (sandbox)
- [x] Bildirim + cron route’ları
- [x] Premium tutarlı
- [x] RLS + tenant cache güvenli
- [ ] Prod `CRON_SECRET` + iyzico live keys (deploy checklist)

---

## 6) Bilinçli ertelemeler

Vendor/devlet API'sına bağlı olanlar bilinçli ertelendi: İYS entegratör (C2), EİDS resmi kayıt (C3). C1 (harici
değerleme) artık Endeksa/Tapusor client'ları ile canlı entegre — sadece prod API anahtarları deploy'da girilecek.
AI builder / kendi foundation model → asla. Portal scrape asla.

---

## 7) Çalışma sırası

```
Faz 0 → Faz 1 → Faz 2 → Faz 3 → Faz 4 (BETA) → Faz 5 → Faz 6
✅      ✅      ✅      ✅      ✅ iskelet     ✅ iskelet  ✅ iskelet
```
