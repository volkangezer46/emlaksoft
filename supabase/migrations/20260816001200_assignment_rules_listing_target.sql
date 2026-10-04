-- Faz 3 / 01: assignment_rules'u İLAN HAVUZU için genişlet (mükerrer tablo yok).
--
-- NEDEN: 20260816000900 kuralları lead (müşteri) atamasına göre yazıldı. Havuzdan danışmana ilan atama
-- aynı kavramlara (strateji, SLA, yedek zincir, kapasite) ihtiyaç duyar; ikinci bir kural tablosu yerine
-- kural satırına hedef türü ve ilan modu eklenir. Mevcut satırlar target_kind='lead' kalır (davranış değişmez).
-- BAĞIMLILIK: 20260816000900 uygulanmış olmalı.
-- assign_mode: manual (öneriler sıralı, sahip seçer) | semi_auto (en iyi 3 + tek tıkla onay)
--   | auto (puan >= min_score ise sistem atar, altında havuzda bekler) | claim (süre sınırlı "önce sahiplenen alır";
--   süre = sla_minutes, dolunca yedek zincir/öneri).
-- tenants.listing_pool_enabled: havuz kapalıysa (varsayılan) hiçbir ilan havuza düşmez, mevcut portföy akışı aynıdır.
-- GERİ ALMA: rollbacks/20260816001200_assignment_rules_listing_target.rollback.sql.
-- RİSK: düşük (nullable/sabit varsayılanlı sütunlar).

alter table public.assignment_rules
  add column if not exists target_kind text not null default 'lead'
    check (target_kind in ('lead', 'listing')),
  add column if not exists assign_mode text
    check (assign_mode is null or assign_mode in ('manual', 'semi_auto', 'auto', 'claim')),
  add column if not exists min_score smallint
    check (min_score is null or min_score between 0 and 100);

create index if not exists idx_assignment_rules_target
  on public.assignment_rules (tenant_id, target_kind, is_active, priority);

alter table public.tenants
  add column if not exists listing_pool_enabled boolean not null default false;

comment on column public.assignment_rules.target_kind is 'lead = müşteri/talep atama (varsayılan), listing = ilan havuzu atama.';
comment on column public.assignment_rules.assign_mode is 'İlan havuzu modu (yalnız target_kind=listing).';
comment on column public.assignment_rules.min_score is 'auto modunda otomatik atama için asgari açıklanabilir puan (0-100).';
comment on column public.tenants.listing_pool_enabled is 'Yeni ilanlar önce havuza düşsün mü (varsayılan kapalı).';
