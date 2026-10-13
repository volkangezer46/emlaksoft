-- 20261013004700 geri alma: duyuru merkezi tabloları, tetikleyici, RPC'ler ve platform_announcements ek sütunları silinir.
-- UYARI: teslim kayıtları (okunma/tıklama), banner'lar, kapatma kayıtları ve Yenilikler girdileri kaybolur.
-- Ofislere giden bildirimler (notifications) silinmez. 'segment'/'user' hedefli arşiv satırları 'specific'e çevrilir
-- (eski kısıt geri gelebilsin). Kod tablolar yokken eski anında duyuru akışına düşer.

set local lock_timeout = '5s';

drop function if exists public.office_broadcast_state();
drop trigger if exists trg_notifications_announcement_read on public.notifications;
drop function if exists public.platform_announcement_mark_read();
drop function if exists public.platform_announcement_track_click(uuid);
drop function if exists public.platform_announcement_claim(integer, uuid);
drop function if exists public.platform_announcement_recipient_emails(uuid[]);
drop function if exists public.platform_announcement_login_tenants(timestamptz);

drop table if exists public.changelog_reads;
drop table if exists public.changelog_entries;
drop table if exists public.platform_banner_dismissals;
drop table if exists public.platform_banners;
drop table if exists public.platform_announcement_deliveries;

drop index if exists public.idx_platform_announcements_due;

update public.platform_announcements set audience = 'specific' where audience in ('segment', 'user');

alter table public.platform_announcements drop constraint if exists platform_announcements_audience_check;
alter table public.platform_announcements add constraint platform_announcements_audience_check
  check (audience in ('all', 'active', 'trial', 'specific'));
alter table public.platform_announcements drop constraint if exists platform_announcements_status_check;
alter table public.platform_announcements drop constraint if exists platform_announcements_channels_check;
alter table public.platform_announcements drop constraint if exists platform_announcements_window_check;
alter table public.platform_announcements drop constraint if exists platform_announcements_href_check;

alter table public.platform_announcements
  drop column if exists channels,
  drop column if exists segment_json,
  drop column if exists scheduled_at,
  drop column if exists expires_at,
  drop column if exists status,
  drop column if exists href,
  drop column if exists commercial,
  drop column if exists target_user_id,
  drop column if exists recipient_count,
  drop column if exists delivered_count,
  drop column if exists failed_count,
  drop column if exists read_count,
  drop column if exists click_count,
  drop column if exists stats,
  drop column if exists materialized_at,
  drop column if exists started_at,
  drop column if exists finished_at,
  drop column if exists updated_at;

notify pgrst, 'reload schema';
