-- ============================================================
-- Ekip ligi & rozetler (gamification) — agent_badges + agent_score_snapshots
-- ============================================================
-- Neden:
--  * /app/lig lig tablosunu HER İSTEKTE ham tablolardan (deals/properties/
--    appointments/tasks/surveys) hesaplıyor. Bu içinde bulunulan ay için
--    doğru ve ucuz; ama geçmiş bir ay sorulduğunda üç sorun çıkıyor:
--      1. Silinen/atanması değişen kayıtlar geçmişi geriye dönük DEĞİŞTİRİR —
--         "geçen ay 2.'ydim, bu sayfa şimdi 3. diyor" güveni bitirir.
--      2. Şampiyonluk bir ÖDÜL; ay kapandıktan sonra dondurulmalı.
--      3. Her açılışta 12 aylık ham veri taramak pahalı.
--    `agent_score_snapshots` ayın 1'inde çalışan cron ile biten ayı MÜHÜRLER.
--  * `agent_badges` kazanılmış rozetin KANITI. Rozet koşulu (src/lib/
--    gamification.ts BADGES) sonradan sıkılaşsa bile kazanılmış rozet geri
--    alınmaz — "Ayın Şampiyonu" madalyası sökülemez.
--
-- Tasarım kararları:
--  * badge_code / period text (enum değil): rozet kataloğu uygulama katmanında
--    (BADGES) yaşıyor ve yeni rozet eklemek migration gerektirmemeli. Enum
--    ADD VALUE + kullanım aynı dosyada olamıyor zaten (087/087b deseni).
--  * period NULL = ömür boyu rozet ("İlk Anlaşma"), 'YYYY-MM' = aylık rozet
--    ("Ayın Şampiyonu"). Postgres'te UNIQUE içinde NULL'lar birbirine eşit
--    SAYILMAZ — bu yüzden tekillik `coalesce(period,'')` üzerinden kurulan
--    bir unique INDEX ile sağlanıyor, tablo kısıtı ile değil. Aksi halde
--    ömür boyu rozet her cron koşusunda mükerrer yazılırdı.
--  * snapshot.score int: puanlar tamsayı (SCORE_RULES tamsayı katsayılar).
--  * breakdown jsonb: kural bazlı kırılım ({deal_won:{count,points},...}).
--    Ayrı kolonlara açmak yeni puan kalemi eklendiğinde migration zorunlu
--    kılardı; kırılım raporlama verisi, filtrelenmiyor.
--  * rank snapshot ANINDA hesaplanan sıra — sonradan yeniden türetilemez
--    (o ayki ekip listesi değişmiş olabilir), bu yüzden saklanıyor.

-- ============================================================
-- agent_badges — kazanılmış rozetler
-- ============================================================
create table if not exists public.agent_badges (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references public.tenants(id)  on delete cascade,
  staff_id   uuid        not null references public.profiles(id) on delete cascade,
  badge_code text        not null check (length(badge_code) between 2 and 64),
  earned_at  timestamptz not null default now(),
  period     text        check (period ~ '^\d{4}-\d{2}$'),
  meta       jsonb
);

comment on table  public.agent_badges            is 'Danışmanların kazandığı rozetler — katalog src/lib/gamification.ts BADGES; kazanılmış rozet geri alınmaz';
comment on column public.agent_badges.badge_code is 'BADGES kataloğundaki sabit kod (ör. ayin_sampiyonu) — ad değişebilir, kod ASLA';
comment on column public.agent_badges.period     is 'Aylık rozetlerde YYYY-MM (ör. 2026-07); ömür boyu rozetlerde NULL';
comment on column public.agent_badges.meta       is 'Rozet anındaki bağlam (skor, sıra, eşik değeri) — sonradan "neden kazandım" sorusunu cevaplar';

-- Mükerrer kayıt freni. NULL period da tekil sayılsın diye coalesce'lı index
-- (tablo UNIQUE kısıtı NULL'ları eşit saymadığı için yetersiz kalırdı).
create unique index if not exists idx_agent_badges_unique
  on public.agent_badges (tenant_id, staff_id, badge_code, coalesce(period, ''));

-- Lig sayfası: "bu ofiste bu dönem kim hangi rozeti aldı" tek taramada.
create index if not exists idx_agent_badges_tenant_period
  on public.agent_badges (tenant_id, period, earned_at desc);

-- Danışman kartı / kişisel özet: kişinin tüm rozetleri.
create index if not exists idx_agent_badges_staff
  on public.agent_badges (tenant_id, staff_id, earned_at desc);

-- ============================================================
-- agent_score_snapshots — mühürlenmiş aylık lig sonucu
-- ============================================================
create table if not exists public.agent_score_snapshots (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references public.tenants(id)  on delete cascade,
  staff_id   uuid        not null references public.profiles(id) on delete cascade,
  period     text        not null check (period ~ '^\d{4}-\d{2}$'),
  score      int         not null default 0 check (score >= 0),
  breakdown  jsonb       not null default '{}'::jsonb,
  rank       int         check (rank >= 1),
  created_at timestamptz not null default now(),
  constraint agent_score_snapshots_unique unique (tenant_id, staff_id, period)
);

comment on table  public.agent_score_snapshots           is 'Kapanmış ayın lig sonucu — /api/cron/lig-snapshot ayın 1''i yazar; geçmiş dönem tablosu buradan okunur';
comment on column public.agent_score_snapshots.period    is 'Mühürlenen dönem YYYY-MM (ör. 2026-06 = Haziran sonucu)';
comment on column public.agent_score_snapshots.breakdown is 'Kural bazlı kırılım: {"deal_won":{"count":2,"points":200}, ...} — SCORE_RULE_KEYS ile aynı anahtarlar';
comment on column public.agent_score_snapshots.rank      is 'O dönemdeki sıra (1 = şampiyon); eşit puanlar aynı sırayı paylaşır';

-- Dönem tablosu: tek ofis + tek dönem, sıraya göre.
create index if not exists idx_agent_score_snapshots_period
  on public.agent_score_snapshots (tenant_id, period, rank);

-- Kişisel trend: bir danışmanın son N ayı.
create index if not exists idx_agent_score_snapshots_staff
  on public.agent_score_snapshots (tenant_id, staff_id, period desc);

-- ============================================================
-- RLS — kiracı izolasyonu (bkz. 20260725000054: helper kullan)
-- ============================================================
alter table public.agent_badges          enable row level security;
alter table public.agent_score_snapshots enable row level security;

drop policy if exists agent_badges_tenant on public.agent_badges;
create policy agent_badges_tenant on public.agent_badges
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on policy agent_badges_tenant on public.agent_badges is
  'Kiracı izolasyonu — current_tenant_id(). Rozet ofis içinde herkese görünür (lig tablosu şeffaf); yazma yalnız cron (service role).';

drop policy if exists agent_score_snapshots_tenant on public.agent_score_snapshots;
create policy agent_score_snapshots_tenant on public.agent_score_snapshots
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on policy agent_score_snapshots_tenant on public.agent_score_snapshots is
  'Kiracı izolasyonu — current_tenant_id(). Okuma ofis geneli; yazma pratikte yalnız lig-snapshot cron''u (service role).';

grant all on public.agent_badges          to authenticated, service_role;
grant all on public.agent_score_snapshots to authenticated, service_role;
