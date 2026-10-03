-- Rollback: 20260816000200_commission_splits
-- ÖNCE 20260816000500 ve 20260816000400 (split_id FK) geri alınmalı.
-- commissions.splits jsonb dokunulmadığı için komisyon verisi kaybolmaz; yalnız profile_id bağlı satırlar gider.
-- faz2_touch_updated_at() diğer Faz 2 tabloları tarafından paylaşılır; tüm Faz 2 tabloları kalkınca elle düşürülebilir.
drop table if exists public.commission_splits;
