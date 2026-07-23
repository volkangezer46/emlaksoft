# Premium Plus Migrations - Uygulama Talimatı

## Supabase Dashboard Üzerinden Uygulama

1. **Supabase Dashboard'a giriş yapın**
   - https://supabase.com/dashboard
   - Projenizi seçin

2. **SQL Editor'ı açın**
   - Sol menüden "SQL Editor" seçin

3. **Migration dosyasını çalıştırın**
   - `supabase/apply_premium_plus.sql` dosyasının içeriğini kopyalayın
   - SQL Editor'a yapıştırın
   - "Run" butonuna tıklayın

4. **Storage Bucket oluşturun**
   - Sol menüden "Storage" seçin
   - "Create bucket" tıklayın
   - Bucket name: `customer-files`
   - Public: **OFF** (private)
   - "Create bucket" tıklayın

5. **Storage RLS Policy ekleyin**
   - `customer-files` bucket'ına tıklayın
   - "Policies" tab'ına geçin
   - "New Policy" → "For full customization"
   - Policy name: `Authenticated tenant access`
   - Aşağıdaki SQL'i yapıştırın:

```sql
create policy "Authenticated tenant access"
on storage.objects for all
using (
  bucket_id = 'customer-files'
  and (storage.foldername(name))[1] = (auth.jwt()->>'tenant_id')::text
);
```

6. **Doğrulama**
   - SQL Editor'dan kontrol:
```sql
select column_name, data_type 
from information_schema.columns 
where table_name = 'profiles' and column_name = 'notification_prefs';

select table_name 
from information_schema.tables 
where table_name = 'customer_files';
```

## Alternatif: Local Supabase CLI

Eğer Supabase CLI kuruluysa:

```bash
# CLI kur (eğer yoksa)
npm install -g supabase

# Local Supabase başlat
supabase start

# Migrations uygula
supabase db push
```

## Notlar

- `apply_premium_plus.sql` içindeki tüm migration'lar `if not exists` kullanır
- Birden fazla kez çalıştırılması güvenlidir
- Hata alırsanız output'u kontrol edin
- Storage policy manuel eklenmeli (Dashboard üzerinden)

---

**Migrations Listesi:**
- ✅ `000009` - Bildirim tercihleri (`profiles.notification_prefs`)
- ✅ `000010` - Müşteri dosya deposu (`customer_files` table)
- ✅ `000011` - Permission contract tests
- ✅ `000012` - Leak SLA tracking
- ✅ `000013` - PWA push subscriptions
- ✅ `000014` - `permission_defaults` + `tenant_role_permissions` (DB-tabanlı yetkilendirme şeması + MATRIX seed)
- ✅ `000015` - Telefon verisi normalizasyonu + `05XXXXXXXXX` CHECK kısıtı (profiles/customers/calls)
- ✅ `000016` - `has_effective_permission()` SQL fonksiyonu + commissions/payment_links role-aware RLS + profiles rol değişim guard'ı
- ✅ `000017` - Geo tam kapsama şeması (`source_id`, `postal_code`, `population`, `pg_trgm` arama indeksleri, geo tabloları için `service_role` yazma yetkisi)
- ✅ `000018` - `geo_province_stats` / `geo_district_stats` view'ları (admin ekranlarında hızlı kapsama sayımı)
- ✅ `000019` - Leak-SLA düzeltmesi: `sla_warning_sent_at` + `leak_severity` kolonları `listing_closures`'a eklendi (000012 yanlışlıkla var olmayan `portal_closures`'ı hedeflemişti) + SLA indeksi
- ✅ `000020` - Inbound lead yakalama: `tenants.lead_capture_token` + `lead_capture_enabled`, `customers.lead_channel` + `auto_assigned` (public form/webhook + round-robin atama)
- ✅ `000021` - Portföy medya galerisi: `property_media` tablosu (foto/video/360 tur) + `property-media` storage bucket (private)
- ✅ `000022` - Görev / takip otomasyonu: `tasks` tablosu + `permission_defaults` `tasks` modülü seed'i
- ✅ `000023` - EmlakSoft satış CRM'i: `demo_requests` tablosu (landing/demo formu lead havuzu, platform-level, RLS `is_platform_staff()`)
- ✅ `000024` - Platform bildirim merkezi: `platform_notifications` tablosu (staff'a fan-out; demo/ticket/uyarı, her personel kendi okundu durumu, RLS `staff_id = auth.uid()`)
- ✅ `000025` - Platform ayarları: `platform_settings` anahtar-değer tablosu (OpenAI API anahtarı vb.; okuma service_role, yazma yalnızca super_admin)

> **Storage:** `000021` `property-media` bucket'ını SQL ile private olarak oluşturur. Ek storage RLS policy'si gerekmez —
> yükleme/silme sunucu tarafında `service_role` (admin client) ile, görsel sunumu `/api/property-media/[id]` route'u ile yapılır.

> `apply_premium_plus.sql` bu migration'ları içermiyor (dosya `000012`'de donmuş) — production DB'de `000014`-`000022`
> `scripts/apply-one.ts` ile doğrudan Postgres bağlantısı (`DATABASE_POOLER_URL`) üzerinden uygulandı. Yeni bir ortam
> kurarken aynı yolu izleyin: `npx tsx scripts/apply-one.ts supabase/migrations/<dosya>.sql` sırayla `000014`-`000022`'a kadar `000014`'ten
> başlayarak, veya SQL Editor'a dosyaları elle yapıştırın.
>
> Coğrafya verisi (81 il / 973 ilçe / ~31.900 mahalle) `npm run geo:sync` ile TurkiyeAPI'den senkronize edildi ve
> production DB'ye zaten yazıldı. `/admin/geo` üzerinden düzenlenebilir/eklenebilir/pasifleştirilebilir.
