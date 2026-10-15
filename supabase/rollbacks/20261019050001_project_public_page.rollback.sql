-- 20261019050001 geri alma. ON KOSUL: project-media kovasindaki nesneler once Storage API'den silinmeli
-- (kova satiri, icinde nesne varken silinemez). Paylasilmis proje linkleri 404 olur.
drop table if exists public.project_media;
drop index if exists public.idx_projects_share_token;
alter table public.projects drop constraint if exists projects_share_token_format;
alter table public.projects
  drop column if exists shared_at,
  drop column if exists share_show_prices,
  drop column if exists share_enabled,
  drop column if exists share_token;
do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is not null then
    delete from storage.buckets where id = 'project-media';
  end if;
end $$;
