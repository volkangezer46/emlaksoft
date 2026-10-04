# Diyalog / popup envanteri

Kaynak: `grep DialogContent|DialogFullscreenContent|createPortal` (2026-10-03). Alan sayısı = dosyadaki input/select/textarea
bileşeni sayısı (yaklaşık). Durum: **Taşındı** = `InlineTabbedPanel` (popup yok); **Kalır** = kısa onay / tam ekran önizleme /
küçük tek amaçlı eylem; **Sıra** = ekle/düzenle akışı, sonraki turda taşınacak.

## Ekle / düzenle akışları

| Dosya | Amaç | Alan | Durum |
|---|---|---|---|
| app/gorevler/task-edit-dialog.tsx | Görev düzenle | 6 | Taşındı (2 sekme) |
| app/randevular/appointment-edit-dialog.tsx | Randevu ertele/düzenle (çakışma freni) | 6 | Taşındı (2 sekme) |
| app/musteriler/[id]/edit-customer-dialog.tsx | Müşteri düzenle | 8 | Taşındı (3 sekme) |
| app/musteriler/[id]/edit-demand-dialog.tsx | Talep düzenle | 8 | Taşındı (3 sekme) |
| app/portfoyler/[id]/edit-property-dialog.tsx | Portföy düzenle | 17 | Taşındı (3 sekme) |
| app/giderler/expense-edit-dialog.tsx | Gider düzenle (kontrollü kip) | 5 | Taşındı |
| app/teklifler/[id]/offer-edit-dialog.tsx | Teklif düzenle | 3 | Taşındı |
| app/hedefler/target-form-dialog.tsx | Hedef düzenle | 5 | Taşındı |
| app/projeler/[id]/add-units-dialog.tsx | Projeye toplu birim ekle | 16 | Sıra |
| app/otomasyonlar/automation-wizard.tsx | Otomasyon sihirbazı | 15 | Sıra |
| app/portallar/portal-dialogs.tsx | Portal bağlantısı oluştur | 10 | Sıra (zaten InlinePanel kullanıyor) |
| admin/tickets/new-admin-ticket-dialog.tsx | Yeni destek talebi (admin) | 6 | Sıra (admin kapsam dışı) |
| admin/personel/page.tsx | Personel ekle/düzenle | 5 | Sıra (admin kapsam dışı) |
| app/onaylar/approval-actions.tsx | Onay/red notu | 5 | Sıra |
| app/gelen-kutusu/row-actions.tsx | Gelen kutusu hızlı eylemler | 5 | Sıra |
| app/musteriler/customer-bulk-actions.tsx | Toplu eylemler | 4 | Sıra |
| app/ag/demand-response-dialog.tsx | Ağ talebine yanıt | 4 | Sıra |
| app/teklifler/[id]/offer-round-dialog.tsx | Karşı teklif turu | 4 | Sıra |
| app/anlasmalar/deal-board.tsx | Anlaşma aşama taşıma/kayıp/kazanç | 5 | Sıra |
| app/ag/collab-request-dialog.tsx | İş birliği isteği | 2 | Sıra |
| app/kiralama/apply-increase-dialog.tsx | Kira artışı uygula | 2 | Sıra |
| app/komisyon/commission-split-editor.tsx | Komisyon paylaşımı | 2 | Sıra |
| app/uyum/kvkk-panel.tsx | KVKK talebi | 2 | Sıra |
| app/randevular/complete-appointment-dialog.tsx | Randevu sonuçlandır (teyit) | 1 | Sıra |
| app/sozlesmeler/[id]/fill-fields-dialog.tsx | Sözleşme alanlarını doldur | 1 | Sıra |
| app/gelen-kutusu/sms-dialog.tsx | SMS gönder | 1 | Sıra |
| app/musteriler/cift-kayit/merge-wizard.tsx | Çift kayıt birleştir | 1 | Sıra |
| app/projeler/[id]/units-board.tsx | Birim durum | 1 | Sıra |
| app/anlasmalar/loss-reason-dialog.tsx | Kayıp nedeni | 1 | KALDIRILDI: pano artık Kapanış sekmesine yönlendirir |
| components/app/portal-link-dialog.tsx, wa-template-menu.tsx | Bağlantı/şablon paylaşım | 1-2 | Kalır (paylaşım menüsü) |

## Kalan gerçek onay / önizleme yüzeyleri (değişmez)

- components/ui/confirm-dialog.tsx (silme/yıkıcı onay)
- admin/tenants/[id]/subscription-panel.tsx, danisman/[slug]/agent-share-card.tsx
- Tam ekran: public/gallery-lightbox.tsx, public/compare-table.tsx, belgeler/document-list.tsx, app/product-tour.tsx
- Gezinme/yardım: components/app/keyboard-shortcuts-dialog.tsx, components/ui/console/nav-kit.tsx, app-sidebar, admin-sidebar
