-- ---------------------------------------------------------------------------
-- 121 — Performans indeksleri (liste sayfalarının filtre + sıralama desenleri)
--
-- YÖNTEM: tahmin değil, ölçüm. Önce `pg_indexes` sorgulanıp MEVCUT indeksler
-- elendi; aşağıdakilerin hiçbirinin karşılığı yoktu. Her indeksin altında onu
-- gerektiren GERÇEK sorgu (dosya:satır) yazılı.
--
-- NOT: `CREATE INDEX CONCURRENTLY` KULLANILMADI — migration runner tüm dosyayı
-- tek transaction içinde çalıştırıyor, CONCURRENTLY orada çalışmaz.
--
-- RLS hatırlatması: her sorgu `public.current_tenant_id()` altında koştuğu için
-- `tenant_id` örtük bir öncü koşuldur; tüm bileşik indeksler `tenant_id` ile başlar.
-- ---------------------------------------------------------------------------

-- 1) properties: durum filtresi + tarih sıralaması.
--    Mevcut `idx_properties_tenant_status` (tenant_id, status) sıralamayı
--    karşılamıyordu; her sorgu ayrıca sort adımı yapıyordu.
--    Sorgu: teklifler/page.tsx:118, talepler/page.tsx:167,
--           portfoyler/sunumlar/page.tsx:63, musteriler/[id]/page.tsx:245
--           → .is(deleted_at,null).in(status,[...]).order(created_at desc)
CREATE INDEX IF NOT EXISTS idx_properties_tenant_status_created
  ON public.properties (tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

-- 2) properties: işlem tipine göre liste (satılık/kiralık ayrı çekiliyor).
--    Sorgu: yatirim/page.tsx:86 ve :95
--           → .is(deleted_at,null).eq(transaction_type,X).gt(list_price,0)
--             .order(created_at desc)
CREATE INDEX IF NOT EXISTS idx_properties_tenant_txtype_created
  ON public.properties (tenant_id, transaction_type, created_at DESC)
  WHERE deleted_at IS NULL;

-- 3) properties: yetki belgesi bitiş taraması (süresi dolmak üzere olanlar).
--    Bugüne kadar tam tablo taramasıydı.
--    Sorgu: danisman-kpi/page.tsx:230 → .eq(assigned_to).gte/lte(authorization_end)
--           lib/automation-engine.ts:529 → .gte/lte(authorization_end) (cron)
CREATE INDEX IF NOT EXISTS idx_properties_authorization_end
  ON public.properties (tenant_id, authorization_end)
  WHERE deleted_at IS NULL AND authorization_end IS NOT NULL;

-- 4) customers: ada göre alfabetik listeleme — 6+ sayfada aynı desen.
--    Mevcut indeksler yalnız (tenant_id, created_at DESC) sıralamasını biliyordu.
--    Sorgu: arama/page.tsx:104, anlasmalar/page.tsx:53, uyum/page.tsx:62,
--           teklifler/page.tsx:125, yabanci-satis/page.tsx:71,
--           portfoyler/sunumlar/page.tsx:72, musteriler/page.tsx:262
--           → .is(deleted_at,null).order(full_name)
CREATE INDEX IF NOT EXISTS idx_customers_tenant_name
  ON public.customers (tenant_id, full_name)
  WHERE deleted_at IS NULL;

-- 5) customers.customer_types: `.contains()` dizi araması (Alıcı / Mülk sahibi
--    sayaçları ve müşteri listesi tür filtresi). GIN olmadan seq scan.
--    Sorgu: musteriler/page.tsx:270, :340, :346
CREATE INDEX IF NOT EXISTS idx_customers_types_gin
  ON public.customers USING gin (customer_types);

-- 6) customers.tags: aynı gerekçe, etiket filtresi.
--    Sorgu: musteriler/page.tsx:273 → .contains("tags", [...])
CREATE INDEX IF NOT EXISTS idx_customers_tags_gin
  ON public.customers USING gin (tags);

-- 7) customer_demands: talep listesi durum filtresi + tarih sıralaması.
--    Mevcut `idx_demands_tenant_status` sıralama kolonunu içermiyordu.
--    Sorgu: talepler/page.tsx:129 → [.eq(status) | .in(status,[...])]
--           .order(created_at desc) + count:exact
CREATE INDEX IF NOT EXISTS idx_demands_tenant_status_created
  ON public.customer_demands (tenant_id, status, created_at DESC);

-- 8) appointments: danışmanın gün/hafta takvimi.
--    Mevcutta (tenant_id, scheduled_at) ve tek başına (assigned_to) vardı;
--    ikisi birlikte kullanılamıyordu.
--    Sorgu: randevular/page.tsx:305 → .eq(assigned_to).gte/lt(scheduled_at)
--           .order(scheduled_at asc)
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_assignee_sched
  ON public.appointments (tenant_id, assigned_to, scheduled_at);

-- 9) appointments: durum filtresi + zaman sıralaması (iptaller hariç tutuluyor).
--    Sorgu: randevular/page.tsx:134 → .neq(status,'cancelled').order(scheduled_at)
--           api/cron/randevu-hatirlat/route.ts:21 → .gte/lte(scheduled_at).neq(status,...)
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_status_sched
  ON public.appointments (tenant_id, status, scheduled_at);

-- 10) tasks: "Tamamlandı" sekmesi tamamlanma tarihine göre sıralanıyor;
--     mevcut indekslerin hiçbirinde `completed_at` yoktu.
--     Sorgu: gorevler/page.tsx:74 → .eq(status,'done').order(completed_at desc)
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_completed
  ON public.tasks (tenant_id, completed_at DESC)
  WHERE status = 'done';

-- 11) deals: pipeline listesi aşama filtresi OLMADAN güncellenme sırasına göre
--     çekiliyor; mevcut indeks (tenant_id, stage, updated_at) öncü kolon olarak
--     `stage` istediği için kullanılamıyordu.
--     Sorgu: anlasmalar/page.tsx:33, yabanci-satis/page.tsx:84
--            → .order(updated_at desc).limit(200)
CREATE INDEX IF NOT EXISTS idx_deals_tenant_updated
  ON public.deals (tenant_id, updated_at DESC);

-- 12) commissions: cüzdan ve panodaki "durum filtresi yok" sorguları.
--     Mevcut (tenant_id, status, created_at DESC) öncü `status` istiyordu.
--     Sorgu: cuzdan/page.tsx:119 → .order(created_at desc).limit(1000)
CREATE INDEX IF NOT EXISTS idx_commissions_tenant_created
  ON public.commissions (tenant_id, created_at DESC);

-- 13) property_media: liste sayfalarının toplu KAPAK görseli sorgusu.
--     `is_cover` hiçbir indekste yoktu; kapaklar her seferinde tüm medya
--     satırları taranarak bulunuyordu.
--     Sorgu: portfoyler/page.tsx:203 → .in(property_id,[...]).eq(kind,'image').eq(is_cover,true)
--            talepler/[id]/page.tsx:213 → .in(property_id,[...]).eq(is_cover,true)
CREATE INDEX IF NOT EXISTS idx_property_media_cover
  ON public.property_media (property_id, kind)
  WHERE is_cover;

-- 14) notifications: cron'ların "bu bildirimi daha önce gönderdim mi?"
--     tekrar-önleme sorgusu `href` üzerinden yapılıyor, indeks yoktu.
--     Sorgu: api/cron/kira-tahakkuk/route.ts:190 → .in("href",[...])
--            api/cron/haftalik-ozet/route.ts:81  → .eq("href", marker)
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_href
  ON public.notifications (tenant_id, href)
  WHERE href IS NOT NULL;

-- 15) portal_listings: Portal Kontrol listesi durum filtresi olmadan tarih
--     sırasıyla çekiliyor; mevcut indeksler yalnız (tenant_id, status) idi.
--     Sorgu: portallar/page.tsx:104 → .order(created_at desc).limit(500)
CREATE INDEX IF NOT EXISTS idx_portal_listings_tenant_created
  ON public.portal_listings (tenant_id, created_at DESC);

-- 16) portal_listings: teyit gecikmesi taraması (cron her saat koşuyor).
--     Sorgu: api/cron/portal-teyit/route.ts:98
--            → .eq(status,'live').or(last_confirmed_at.is.null,last_confirmed_at.lt.X)
CREATE INDEX IF NOT EXISTS idx_portal_listings_confirm_due
  ON public.portal_listings (tenant_id, last_confirmed_at)
  WHERE status = 'live';

-- 17) surveys: tavsiye avcısı yalnız cevaplanmış ve yüksek puanlı anketleri
--     cevaplanma tarihine göre çekiyor; mevcut indeks `sent_at` sıralıydı.
--     Sorgu: tavsiyeler/page.tsx:168
--            → .gte(score,9).eq(status,'answered').order(answered_at desc)
CREATE INDEX IF NOT EXISTS idx_surveys_answered
  ON public.surveys (tenant_id, answered_at DESC)
  WHERE status = 'answered';
