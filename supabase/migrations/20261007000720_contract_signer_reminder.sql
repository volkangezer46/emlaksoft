-- Sözleşme imza hatırlatması: sunucudan SMS için token'ı AÇIĞA ÇIKARMAYAN kısa imza bağlantısı (PB52).
--
-- NEDEN: İmzalamayana hatırlatma yalnız WhatsApp/kopyala ile yapılabiliyordu; sunucudan SMS göndermek imzacı token'ını
--   okumayı gerektirir ve contract_signers yalnız service_role'e açıktır (yeni service_role kullanımı açılmadı, §29).
-- İÇERİK:
--   1) contract_signers.short_code (64 bit rastgele, 16 hex; kısmi benzersiz indeks), reminder_count, last_reminded_at.
--   2) contract_signer_reminder_payload(p_contract_id, p_signer_id) → jsonb — authenticated, SECURITY DEFINER, boş search_path.
--      Yalnız sözleşmenin OFİSİNDEKİ (current_active_tenant_id) contracts:edit yetkili kullanıcı; sözleşme 'sent' ve süresi
--      geçmemiş, imzacı bekliyor + telefonu var. 10 dakikada bir, imzacı başına en çok 10 hatırlatma. Kısa kodu (yoksa üretir)
--      ve SMS için ad/telefon/başlık döndürür; TAM token/bağlantı DÖNMEZ. Her çağrı audit_logs'a yazılır.
--   3) contract_signer_resolve_short(p_code) → text — anon/authenticated, SECURITY DEFINER. Kısa kod → imza token'ı yalnız
--      imzacı bekliyor + sözleşme 'sent' + süresi geçmemiş + ofis public-aktif (active|trial|past_due) iken. Kısa kod kendisi
--      taşıyıcı kimliktir (token ile eşdeğer yetki; 64 bit + uç hız sınırı `/imza/k/<kod>`).
-- BAGIMLILIK: 20260723000029 (contracts/contract_signers), 20260813000000 (iş akışı; contract_signers authenticated'a kapalı),
--   20260802000300 (current_active_tenant_id / has_effective_permission).
-- GERI ALMA: rollbacks/20261007000720_contract_signer_reminder.rollback.sql (RPC'ler + sütunlar düşer; kod WhatsApp/kopyala'ya döner).
-- RISK: düşük (ek sütunlar + yeni RPC'ler; mevcut fonksiyon/politika değişmez).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.contract_signers') is null
     or pg_catalog.to_regclass('public.contracts') is null
     or pg_catalog.to_regclass('public.audit_logs') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null then
    raise exception '20261007000720: contracts/contract_signers/audit_logs veya yetki yardimcilari yok.';
  end if;
end $$;

alter table public.contract_signers
  add column if not exists short_code text,
  add column if not exists reminder_count integer not null default 0,
  add column if not exists last_reminded_at timestamptz;

alter table public.contract_signers
  drop constraint if exists contract_signers_short_code_format;
alter table public.contract_signers
  add constraint contract_signers_short_code_format check (short_code is null or short_code ~ '^[0-9a-f]{16}$');

create unique index if not exists uq_contract_signers_short_code
  on public.contract_signers (short_code)
  where short_code is not null;

create or replace function public.contract_signer_reminder_payload(p_contract_id uuid, p_signer_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_contract record;
  v_signer record;
  v_code text;
  v_hex text;
  v_try integer := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;
  if not public.has_effective_permission('contracts', 'edit') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select c.id, c.title, c.status::text as status, c.expires_at
    into v_contract
    from public.contracts c
   where c.id = p_contract_id and c.tenant_id = v_tenant;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_contract.status <> 'sent' then
    return jsonb_build_object('ok', false, 'code', 'invalid_state');
  end if;
  if v_contract.expires_at is not null and v_contract.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;

  select s.id, s.full_name, s.phone, s.status::text as status, s.short_code, s.reminder_count, s.last_reminded_at
    into v_signer
    from public.contract_signers s
   where s.id = p_signer_id and s.contract_id = v_contract.id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_signer.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not_pending');
  end if;
  if nullif(btrim(coalesce(v_signer.phone, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'no_phone');
  end if;
  if v_signer.last_reminded_at is not null and v_signer.last_reminded_at > now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'code', 'throttled');
  end if;
  if coalesce(v_signer.reminder_count, 0) >= 10 then
    return jsonb_build_object('ok', false, 'code', 'limit');
  end if;

  v_code := v_signer.short_code;
  while v_code is null loop
    v_try := v_try + 1;
    if v_try > 5 then
      raise exception 'short code collision' using errcode = '40001';
    end if;
    -- gen_random_uuid v4: konum 13 (sürüm) ve 17 (varyant) dışındaki onaltılıklar rastgele → 16 hex = 64 bit.
    v_hex := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    v_code := pg_catalog.substr(v_hex, 1, 12) || pg_catalog.substr(v_hex, 18, 4);
    if exists (select 1 from public.contract_signers s where s.short_code = v_code) then
      v_code := null;
    end if;
  end loop;

  update public.contract_signers
     set short_code = v_code,
         reminder_count = coalesce(reminder_count, 0) + 1,
         last_reminded_at = now()
   where id = v_signer.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    v_tenant, v_uid, 'contract.signer_remind', 'contract', v_contract.id,
    jsonb_build_object('signer_id', v_signer.id, 'channel', 'sms', 'reminder_count', coalesce(v_signer.reminder_count, 0) + 1)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'ok',
    'short_code', v_code,
    'full_name', v_signer.full_name,
    'phone', v_signer.phone,
    'contract_title', v_contract.title
  );
end;
$$;

revoke all on function public.contract_signer_reminder_payload(uuid, uuid) from public, anon;
grant execute on function public.contract_signer_reminder_payload(uuid, uuid) to authenticated, service_role;

create or replace function public.contract_signer_resolve_short(p_code text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.token
    from public.contract_signers s
    join public.contracts c on c.id = s.contract_id
    join public.tenants t on t.id = c.tenant_id
   where p_code ~ '^[0-9a-f]{16}$'
     and s.short_code = p_code
     and s.status::text = 'pending'
     and c.status::text = 'sent'
     and (c.expires_at is null or c.expires_at > now())
     and t.status in ('active', 'trial', 'past_due')
   limit 1;
$$;

revoke all on function public.contract_signer_resolve_short(text) from public;
grant execute on function public.contract_signer_resolve_short(text) to anon, authenticated, service_role;

comment on function public.contract_signer_reminder_payload(uuid, uuid) is
  'Imza hatirlatma SMS yuku: kisa kod + ad/telefon/baslik (tam token DONMEZ). Yalniz sozlesmenin ofisinde contracts:edit; 10 dk fren, 10 tavan.';
comment on function public.contract_signer_resolve_short(text) is
  'Kisa imza kodu -> imza tokeni (yalniz bekleyen imzaci + gonderilmis, suresi gecmemis sozlesme + public-aktif ofis).';

notify pgrst, 'reload schema';
