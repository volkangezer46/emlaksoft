-- MIGRATION 20261019070001_support_ticket_merge.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: fonksiyon/kolon yokken talep detayindaki "Birlestir" eylemi
--   "bu ortamda etkin degil" der; liste ve detay birlesme bilgisi olmadan calisir.
-- Geri alma: supabase/rollbacks/20261019070001_support_ticket_merge.rollback.sql (fonksiyon + kolonlar duser; kaynak
--   talepler "Kapali" kalir, eklenen sistem mesajlari ve olay kayitlari korunur).
-- BAGIMLILIK: 20260731000142 (support_ticket_events, support_record_event, support_require_service_role,
--   support_actor_is_valid), 20261013004800 (support_tickets.tags + surum tetigi).
--
-- NE (PA-9, Zendesk/Freshdesk "merge tickets"): ayni ofisin mukerrer talebi hedef talebe birlestirilir. Tek transaction:
--   1) iki talep sabit sirayla kilitlenir (kilitlenme yok), ayni ofis + farkli + ikisi de birlesmemis + hedef kapali degil;
--   2) hedefe IC NOT: kaynak no/konu + acilis metni + kaynaktaki mesaj/ek sayisi (ek dosyalari kaynakta kalir: depolama
--      yolu talep kimligine bagli, tasinmaz; kaynak talep sayfasi acik kalir);
--   3) kaynaga GORUNUR sistem mesaji ("#hedef ile birlestirildi, yanitlar orada"), kaynak 'closed' + cozum kodu
--      'merged' + merged_into_id/merged_at; SLA kaynakta durur (kapali), hedefin SLA'si degismez;
--   4) etiketler hedefte birlesir (en cok 10), iki talebe olay kaydi ('merge' / 'merged_into').
--   CSAT kaynakta kalir (bilet basina tek kayit). Yalniz service_role cagirir; sunucu eylemi tickets modulu yazma
--   yetkisini dogrular, actor gecerli destek personeli olmalidir.
set local lock_timeout = '5s';

alter table public.support_tickets
  add column if not exists merged_into_id uuid references public.support_tickets(id) on delete set null,
  add column if not exists merged_at timestamptz;

alter table public.support_tickets
  drop constraint if exists support_tickets_merged_not_self;
alter table public.support_tickets
  add constraint support_tickets_merged_not_self check (merged_into_id is null or merged_into_id <> id) not valid;

-- Kiraci (ofis) kendi talebinin hangi talebe birlestigini okuyabilir: kolon bazli SELECT (desk v2 kurali; tablo duzeyi
-- grant select etiketleri yeniden acardi). RLS aynen gecerli.
grant select (merged_into_id, merged_at) on table public.support_tickets to authenticated;

create index if not exists idx_support_tickets_merged_into
  on public.support_tickets (merged_into_id)
  where merged_into_id is not null;

create or replace function public.support_merge_tickets(
  p_source_id uuid,
  p_target_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_source public.support_tickets%rowtype;
  v_target public.support_tickets%rowtype;
  v_msg_count integer;
  v_att_count integer;
  v_note text;
  v_note_id uuid;
  v_public_id uuid;
  v_tags text[];
begin
  perform public.support_require_service_role();
  if p_source_id is null or p_target_id is null or p_actor_id is null then
    raise exception 'Missing support identifiers.' using errcode = '22023';
  end if;
  if p_source_id = p_target_id then
    raise exception 'MERGE_SAME: Talep kendisiyle birlestirilemez.' using errcode = '22023';
  end if;
  if not public.support_actor_is_valid(p_actor_id, 'staff', null) then
    raise exception 'Invalid support actor.' using errcode = '42501';
  end if;

  -- Sabit kilit sirasi (kimlik artan): eszamanli ters birlestirme kilitlenmez.
  perform 1 from public.support_tickets t where t.id in (p_source_id, p_target_id) order by t.id for update;
  select * into v_source from public.support_tickets t where t.id = p_source_id;
  select * into v_target from public.support_tickets t where t.id = p_target_id;
  if v_source.id is null or v_target.id is null then
    raise exception 'Ticket not found.' using errcode = 'P0002';
  end if;
  if v_source.tenant_id is distinct from v_target.tenant_id then
    raise exception 'MERGE_TENANT: Yalniz ayni ofisin talepleri birlestirilir.' using errcode = '22023';
  end if;
  if v_source.merged_into_id is not null then
    raise exception 'MERGE_ALREADY: Kaynak talep zaten birlestirilmis.' using errcode = '22023';
  end if;
  if v_target.merged_into_id is not null then
    raise exception 'MERGE_TARGET_MERGED: Hedef talep baska bir talebe birlestirilmis.' using errcode = '22023';
  end if;
  if v_target.status = 'closed' then
    raise exception 'MERGE_TARGET_CLOSED: Kapali talebe birlestirilemez.' using errcode = '22023';
  end if;

  select count(*) into v_msg_count from public.support_ticket_messages m where m.ticket_id = v_source.id;
  select count(*) into v_att_count
  from public.support_ticket_attachments a
  where a.ticket_id = v_source.id and a.deleted_at is null;

  v_note := left(
    'Birlestirilen talep ' || coalesce(v_source.ticket_no, left(v_source.id::text, 8)) || ': ' || v_source.subject
      || E'\n\n' || coalesce(nullif(btrim(v_source.body), ''), '(acilis metni yok)')
      || E'\n\n' || v_msg_count || ' mesaj ve ' || v_att_count || ' ek kaynak talepte duruyor.',
    20000
  );
  insert into public.support_ticket_messages (ticket_id, author_user_id, author_kind, body, visibility, created_at)
  values (v_target.id, p_actor_id, 'staff', v_note, 'internal', v_now)
  returning id into v_note_id;

  insert into public.support_ticket_messages (ticket_id, author_user_id, author_kind, body, visibility, created_at)
  values (
    v_source.id,
    null,
    'system',
    'Bu talep ' || coalesce(v_target.ticket_no, left(v_target.id::text, 8)) || ' numarali talebinizle birlestirildi. Yanitlar o talepten devam edecek.',
    'public',
    v_now
  )
  returning id into v_public_id;

  v_tags := (
    select coalesce(array_agg(x.tag order by x.first_seen), '{}')
    from (
      select u.tag, min(u.ord) as first_seen
      from (
        select tag, ord from unnest(coalesce(v_target.tags, '{}')) with ordinality as t(tag, ord)
        union all
        select tag, ord + 100 from unnest(coalesce(v_source.tags, '{}')) with ordinality as s(tag, ord)
      ) u
      group by u.tag
      order by min(u.ord)
      limit 10
    ) x
  );

  update public.support_tickets
  set
    status = 'closed',
    closed_at = v_now,
    resolved_at = coalesce(resolved_at, v_now),
    resolution_code = 'merged',
    resolution_summary = left('Mukerrer talep: ' || coalesce(v_target.ticket_no, v_target.id::text) || ' ile birlestirildi.', 2000),
    merged_into_id = v_target.id,
    merged_at = v_now,
    last_activity_at = v_now,
    updated_at = v_now
  where id = v_source.id;

  update public.support_tickets
  set tags = v_tags, last_activity_at = v_now, updated_at = v_now
  where id = v_target.id;

  perform public.support_record_event(
    v_target.id, v_target.tenant_id, p_actor_id, 'staff', 'merge', 'internal', null,
    jsonb_build_object('source_id', v_source.id, 'source_no', v_source.ticket_no, 'messages', v_msg_count, 'attachments', v_att_count),
    v_note_id
  );
  perform public.support_record_event(
    v_source.id, v_source.tenant_id, p_actor_id, 'staff', 'merged_into', 'public',
    jsonb_build_object('status', v_source.status),
    jsonb_build_object('status', 'closed', 'target_id', v_target.id, 'target_no', v_target.ticket_no),
    v_public_id
  );

  return jsonb_build_object(
    'ok', true,
    'sourceId', v_source.id,
    'sourceNo', v_source.ticket_no,
    'targetId', v_target.id,
    'targetNo', v_target.ticket_no,
    'tenantId', v_target.tenant_id,
    'createdBy', v_source.created_by,
    'subject', v_target.subject
  );
end;
$$;

revoke all on function public.support_merge_tickets(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.support_merge_tickets(uuid, uuid, uuid) to service_role;
