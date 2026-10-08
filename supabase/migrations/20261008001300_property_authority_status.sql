-- Portföy yetki (EİDS) durumu: yetki belgesi no + mal sahibi e-Devlet onayı + EİDS doğrulama durumu + hatırlatma izi.
--
-- NE: properties'e 6 nullable/varsayılanlı sütun: authority_doc_no, authority_eids_status (pending|approved|rejected),
--     authority_owner_approved_at, authority_reminder_sent_at, authority_reminder_count, authority_reminder_channel.
--     "Süresi doldu" durumu SAKLANMAZ: authorization_end tarihinden türetilir (tek kaynak; eskiyen kopya olmaz).
-- NEDEN: İlan Kontrol "Yetki kuyruğu" sekmesi onay bekleyen / bitecek / dolmuş / belgesiz portföyleri listeler ve
--     mal sahibine e-Devlet onay hatırlatması gönderir; gönderim izi (kim, ne zaman, kaç kez) portföyde tutulur.
-- Bu RESMİ EİDS SORGUSU DEĞİLDİR: durum ofis tarafından elle/hatırlatma akışıyla işaretlenir.
-- GERI ALMA: rollbacks/20261008001300_property_authority_status.rollback.sql (girilmiş belge no ve onay işaretleri KAYBOLUR).
-- RISK: düşük; yalnız sütun + kısıt + kısmi indeks. Mevcut satır/RLS/politika değişmez. Kod sütun yokken zarifçe atlar.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.properties') is null then
    raise exception 'properties yok; once temel migrationlar uygulanmali.';
  end if;
end $$;

alter table public.properties
  add column if not exists authority_doc_no text,
  add column if not exists authority_eids_status text not null default 'pending',
  add column if not exists authority_owner_approved_at timestamptz,
  add column if not exists authority_reminder_sent_at timestamptz,
  add column if not exists authority_reminder_count integer not null default 0,
  add column if not exists authority_reminder_channel text;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'properties_authority_eids_status_check') then
    alter table public.properties
      add constraint properties_authority_eids_status_check
      check (authority_eids_status in ('pending', 'approved', 'rejected'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'properties_authority_doc_no_len_check') then
    alter table public.properties
      add constraint properties_authority_doc_no_len_check
      check (authority_doc_no is null or char_length(authority_doc_no) between 1 and 60);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'properties_authority_reminder_channel_check') then
    alter table public.properties
      add constraint properties_authority_reminder_channel_check
      check (authority_reminder_channel is null or authority_reminder_channel in ('sms', 'whatsapp'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'properties_authority_reminder_count_check') then
    alter table public.properties
      add constraint properties_authority_reminder_count_check
      check (authority_reminder_count >= 0);
  end if;
end $$;

comment on column public.properties.authority_doc_no is 'Yetki belgesi (satış/kiralama yetki sözleşmesi) numarası; elle giriş.';
comment on column public.properties.authority_eids_status is 'EİDS doğrulama durumu: pending | approved | rejected. "Süresi doldu" authorization_end''den türetilir.';
comment on column public.properties.authority_owner_approved_at is 'Mal sahibinin e-Devlet EİDS yetki onayını verdiği an (null = alınmadı).';
comment on column public.properties.authority_reminder_sent_at is 'Mal sahibine son e-Devlet onay hatırlatması gönderim anı.';

-- Kuyruk sorgusu: onayı bekleyen portföyler (kiracı bazlı, kısmi).
create index if not exists idx_properties_authority_pending
  on public.properties (tenant_id, authorization_end)
  where deleted_at is null and authority_eids_status = 'pending';
