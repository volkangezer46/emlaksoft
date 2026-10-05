-- Güvenlik denetimi 3 / #6 (P1): ilan havuzu — sahte havuz kaydı + sahiplenme ile başkasının ilanını ele geçirme.
--
-- NEDEN: 20260816001500'de listing_pool_entries INSERT politikası yalnız tenant + properties:create istiyordu.
--   properties:create izni olan bir danışman, BAŞKASINA atanmış bir ilan için
--   {status:'pending', claim_open_until:'2099-01-01'} kaydı yazıp assign_pool_entry(p_method:'claim') ile
--   properties.assigned_to'yu kendine çevirebiliyordu (RPC yalnız claim_open_until > now() bakıyordu).
--
-- NE YAPAR:
--   1. public.listing_pool_entry_insert_allowed(...) (SECURITY DEFINER, search_path=''): kayıt açma kuralı
--        * tenant = current_tenant_id() ve properties:create;
--        * ilan bu ofiste ve silinmemiş;
--        * yönetici (owner/gm/branch_manager) değilse: ilan SAHİPSİZ (assigned_to IS NULL), ilanı çağıran
--          oluşturmuş (properties.created_by = auth.uid()) ve kaydın created_by'ı da auth.uid();
--        * claim_open_until doluysa (yönetici değilse): ofiste kaynağa uyan AKTİF 'claim' modlu ilan kuralı
--          bulunmalı ve pencere now() + (kuralın sla_minutes'ı, yoksa 30) + 5 dk sınırını aşmamalı.
--          (src/lib/pool/modes.ts decidePoolAction ile aynı süre; 5 dk saat kayması payı.)
--   2. listing_pool_entries INSERT politikası yeniden kurulur: status='pending', assigned_to/assigned_by/
--      assigned_at/assign_method NULL zorunlu + yukarıdaki yardımcı.
--      NOT: claim_open_until IS NULL zorunlu KILINMADI — createProperty (kullanıcı oturumu) 'claim' modunda
--      kaydı pencereyle açar (src/lib/pool/server.ts enqueueListingPool); NULL zorunluluğu sahiplenme modunu
--      kırardı. Bunun yerine pencere, yetkili kişinin (ofis sahibi/GM) kaydettiği kurala bağlandı.
--   3. listing_pool_events INSERT: actor_id NULL veya auth.uid() (sahte "atadı" olayı yazılamaz).
--   4. assign_pool_entry CREATE OR REPLACE (imza/yetki/atomiklik AYNI): 'claim' için ek olarak
--        * pencere 7 gün + 5 dk'dan uzun olamaz (kural SLA üst sınırı 10080 dk; '2099' gibi değerler reddedilir),
--        * ilan hâlâ sahipsiz ve silinmemiş olmalı (atanmış ilan sahiplenilemez).
--   5. Veri temizliği: bekleyen kayıtlarda 7 gün + 5 dk'yı aşan sahiplenme pencereleri kapatılır (NULL).
--
-- KOD UYUMU (okundu): createProperty → enqueueListingPool kullanıcı oturumuyla insert eder (status pending,
--   assigned_* yok, created_by=gate.userId, ilan routeToPool ile assigned_to=NULL ve created_by=gate.userId oluşturulur).
--   Yönetici akışları (openPoolClaimWindow/skip/refresh) UPDATE politikasıyla (değişmedi) çalışır.
--   claimPoolEntry RPC hata iletisini aynen gösterir (42501). Sistem ataması service_role → kurallar dışında.
--   Kayıt açmayı tamamen SECURITY DEFINER RPC'ye taşımak TS değişikliği ister (sahibi onayı); öneri olarak bırakıldı.
-- ETKİ: listing_pool_entries/events üzerinde kısa DDL kilidi + küçük UPDATE (yalnız sahte/uzun pencereler).
-- GERİ ALMA: supabase/rollbacks/20260823000200_sec3_listing_pool_insert_claim_guard.rollback.sql
-- RİSK: düşük-orta. Yönetici olmayan biri, kendi oluşturmadığı sahipsiz ilanı havuza alamaz (bugün kod bunu yapmıyor).

-- ---------------------------------------------------------------------------
-- 1. Kayıt açma yardımcısı
-- ---------------------------------------------------------------------------
create or replace function public.listing_pool_entry_insert_allowed(
  p_tenant_id uuid,
  p_property_id uuid,
  p_source text,
  p_claim_open_until timestamptz,
  p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_tenant_id = public.current_tenant_id()
    and public.has_effective_permission('properties', 'create')
    and exists (
      select 1
      from public.properties p
      where p.id = p_property_id
        and p.tenant_id = p_tenant_id
        and p.deleted_at is null
        and (
          public.current_profile_role() in ('owner', 'gm', 'branch_manager')
          or (
            p.assigned_to is null
            and p.created_by = auth.uid()
            and p_created_by = auth.uid()
          )
        )
    )
    and (
      p_claim_open_until is null
      or public.current_profile_role() in ('owner', 'gm', 'branch_manager')
      or exists (
        select 1
        from public.assignment_rules r
        where r.tenant_id = p_tenant_id
          and r.target_kind = 'listing'
          and r.is_active
          and r.assign_mode = 'claim'
          and (r.source is null or r.source = p_source)
          and p_claim_open_until <= now() + make_interval(mins => coalesce(nullif(r.sla_minutes, 0), 30) + 5)
      )
    ),
    false
  );
$$;

comment on function public.listing_pool_entry_insert_allowed(uuid, uuid, text, timestamptz, uuid) is
  'Havuz kaydı açma kuralı: yönetici değilse yalnız kendi oluşturduğu sahipsiz ilan; sahiplenme penceresi yalnız claim kuralına ve SLA süresine bağlı.';

revoke all on function public.listing_pool_entry_insert_allowed(uuid, uuid, text, timestamptz, uuid) from public, anon;
grant execute on function public.listing_pool_entry_insert_allowed(uuid, uuid, text, timestamptz, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2-3. Politikalar
-- ---------------------------------------------------------------------------
drop policy if exists listing_pool_entries_insert on public.listing_pool_entries;
create policy listing_pool_entries_insert on public.listing_pool_entries
  for insert to authenticated
  with check (
    status = 'pending'
    and assigned_to is null
    and assigned_by is null
    and assigned_at is null
    and assign_method is null
    and public.listing_pool_entry_insert_allowed(tenant_id, property_id, source, claim_open_until, created_by)
  );

drop policy if exists listing_pool_events_insert on public.listing_pool_events;
create policy listing_pool_events_insert on public.listing_pool_events
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_effective_permission('properties', 'create'))
    and (actor_id is null or actor_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 4. Atama RPC'si (imza aynı; claim dalı sertleştirildi)
-- ---------------------------------------------------------------------------
create or replace function public.assign_pool_entry(
  p_entry_id uuid,
  p_profile_id uuid,
  p_method text,
  p_reason text default null,
  p_score smallint default null,
  p_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service boolean := (select auth.role()) = 'service_role';
  v_uid uuid := (select auth.uid());
  v_tenant uuid;
  v_role text;
  v_entry public.listing_pool_entries%rowtype;
  v_prev uuid;
begin
  if p_method not in ('manual', 'suggested', 'auto', 'claim', 'fallback', 'reassign') then
    raise exception 'Gecersiz atama yontemi.' using errcode = '22023';
  end if;

  if v_service then
    select * into v_entry from public.listing_pool_entries where id = p_entry_id for update;
  else
    v_tenant := (select public.current_tenant_id());
    v_role := (select public.current_profile_role());
    if v_tenant is null then raise exception 'Oturum gerekli.' using errcode = '42501'; end if;
    select * into v_entry from public.listing_pool_entries where id = p_entry_id and tenant_id = v_tenant for update;
  end if;
  if not found then raise exception 'Havuz kaydi bulunamadi.' using errcode = 'P0002'; end if;

  if not v_service then
    if p_method in ('auto', 'fallback') then
      raise exception 'Bu yontem yalnizca sistem icindir.' using errcode = '42501';
    elsif p_method = 'claim' then
      if v_uid is distinct from p_profile_id
         or v_entry.claim_open_until is null
         or v_entry.claim_open_until < now()
         or v_entry.claim_open_until > now() + interval '7 days 5 minutes' then
        raise exception 'Sahiplenme suresi acik degil.' using errcode = '42501';
      end if;
      -- Sahiplenme yalnız havuzdaki SAHİPSİZ ilan için: başkasına atanmış ilan bu yolla devralınamaz.
      if not exists (
        select 1 from public.properties p
        where p.id = v_entry.property_id
          and p.tenant_id = v_entry.tenant_id
          and p.assigned_to is null
          and p.deleted_at is null
      ) then
        raise exception 'Bu ilan sahiplenmeye acik degil.' using errcode = '42501';
      end if;
    elsif v_role not in ('owner', 'gm', 'branch_manager') then
      raise exception 'Atama yetkiniz yok.' using errcode = '42501';
    end if;
  end if;

  if p_method = 'reassign' then
    if v_entry.status <> 'assigned' then raise exception 'Yalniz atanmis kayit yeniden atanir.' using errcode = '22023'; end if;
  elsif v_entry.status <> 'pending' then
    raise exception 'Kayit zaten atanmis veya kapanmis.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.tenant_id = v_entry.tenant_id and p.is_active
      and p.role in ('owner', 'gm', 'branch_manager', 'team_lead', 'advisor')
  ) then
    raise exception 'Atanacak kullanici bu ofiste aktif degil.' using errcode = '22023';
  end if;

  v_prev := v_entry.assigned_to;
  update public.properties set assigned_to = p_profile_id
  where id = v_entry.property_id and tenant_id = v_entry.tenant_id;

  update public.listing_pool_entries set
    status = 'assigned',
    assigned_to = p_profile_id,
    assigned_by = case when p_method in ('auto', 'fallback') then null else v_uid end,
    assigned_at = now(),
    assign_method = p_method,
    reason = coalesce(p_reason, reason),
    claim_open_until = null
  where id = v_entry.id;

  insert into public.listing_pool_events
    (tenant_id, entry_id, event, actor_id, from_profile_id, to_profile_id, score, reason, detail)
  values
    (v_entry.tenant_id, v_entry.id,
     case when p_method = 'reassign' then 'reassigned' else 'assigned' end,
     v_uid, v_prev, p_profile_id, p_score, p_reason,
     coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('method', p_method));

  return jsonb_build_object('entry_id', v_entry.id, 'property_id', v_entry.property_id,
                            'assigned_to', p_profile_id, 'method', p_method);
end;
$$;

revoke all on function public.assign_pool_entry(uuid, uuid, text, text, smallint, jsonb) from public, anon;
grant execute on function public.assign_pool_entry(uuid, uuid, text, text, smallint, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Veri temizliği: olası sahte/uzun sahiplenme pencerelerini kapat
-- ---------------------------------------------------------------------------
update public.listing_pool_entries
set claim_open_until = null
where status = 'pending'
  and claim_open_until is not null
  and claim_open_until > now() + interval '7 days 5 minutes';

notify pgrst, 'reload schema';
