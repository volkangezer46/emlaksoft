-- 20261016060300 geri alma: commission_normalize_splits'in canli govdesi (20261012001500; pg_get_functiondef birebir).
--   'pct'/'name' takma adlari ve tutardan oran turetme kalkar; 'Ofis' etiketi profil kimligi tasirsa yine advisor olur.
--   Demo satiri (1be1a3b9, ornek veri) geri cevrilmez: yeni normal bicim (rate/label) eski govdeyle de gecerlidir.
--   CREATE OR REPLACE ACL'i korur; asagidaki revoke/grant 20261012001500 ile ayni.
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.commission_normalize_splits(p_tenant uuid, p_deal uuid, p_gross numeric, p_splits jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_assigned uuid;
  v_out jsonb := '[]'::jsonb;
  r record;
  v_label text;
  v_key text;
  v_rate numeric;
  v_kind text;
  v_pid uuid;
  v_unres boolean;
  v_n integer;
  v_amount numeric;
  v_rate_sum numeric := 0;
  v_amount_sum numeric := 0;
begin
  if p_splits is null or pg_catalog.jsonb_typeof(p_splits) <> 'array' then return coalesce(p_splits, '[]'::jsonb); end if;
  if p_deal is not null then
    select d.assigned_to into v_assigned from public.deals d where d.id = p_deal and d.tenant_id = p_tenant;
  end if;
  for r in select e.value as v from pg_catalog.jsonb_array_elements(p_splits) as e(value) loop
    if pg_catalog.jsonb_typeof(r.v) <> 'object' then continue; end if;
    v_label := pg_catalog.btrim(coalesce(r.v ->> 'label', ''));
    v_key := pg_catalog.lower(v_label);
    v_rate := coalesce(nullif(r.v ->> 'rate', '')::numeric, 0);
    v_kind := nullif(r.v ->> 'kind', '');
    v_pid := null;
    v_unres := false;
    if coalesce(r.v ->> 'profile_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select p.id into v_pid from public.profiles p where p.id = (r.v ->> 'profile_id')::uuid and p.tenant_id = p_tenant;
    end if;
    if v_pid is not null then
      v_kind := 'advisor';
    elsif v_kind in ('office', 'referral', 'franchise') or v_key in ('ofis', 'ofis payı', 'ofis payi') then
      v_kind := case when v_kind in ('referral', 'franchise') then v_kind else 'office' end;
    elsif v_kind = 'other' and coalesce((r.v ->> 'unresolved')::boolean, false) is not true then
      v_kind := 'other'; -- açıkça dış taraf (editör)
    else
      -- Serbest metin: önce "Danışman" -> anlaşma sorumlusu, sonra tek tam ad eşleşmesi.
      if v_key in ('danışman', 'danisman') and v_assigned is not null then
        v_pid := v_assigned;
      else
        select count(*) into v_n from public.profiles p
          where p.tenant_id = p_tenant and pg_catalog.lower(pg_catalog.btrim(coalesce(p.full_name, ''))) = v_key and v_key <> '';
        if v_n = 1 then
          select p.id into v_pid from public.profiles p
            where p.tenant_id = p_tenant and pg_catalog.lower(pg_catalog.btrim(coalesce(p.full_name, ''))) = v_key;
        end if;
      end if;
      if v_pid is not null then
        v_kind := 'advisor';
      else
        v_kind := 'other';
        v_unres := true;
      end if;
    end if;
    v_amount := case when r.v ? 'amount' and nullif(r.v ->> 'amount', '') is not null
                     then (r.v ->> 'amount')::numeric
                     else pg_catalog.round(coalesce(p_gross, 0) * v_rate / 100, 2) end;
    -- Yeni yazım kuralları (20261012001500): istemcinin amount'u YENİDEN HESAPLANMAZ, yalnız toplamlar sınanır.
    if v_rate < 0 or v_amount < 0 then
      raise exception 'Paylaşım oranı ve tutarı negatif olamaz.' using errcode = '23514';
    end if;
    v_rate_sum := v_rate_sum + v_rate;
    v_amount_sum := v_amount_sum + v_amount;
    v_out := v_out || pg_catalog.jsonb_build_array(
      (r.v - 'profile_id' - 'kind' - 'unresolved')
      || pg_catalog.jsonb_build_object('kind', v_kind, 'amount', v_amount)
      || case when v_pid is not null then pg_catalog.jsonb_build_object('profile_id', v_pid) else '{}'::jsonb end
      || case when v_unres then pg_catalog.jsonb_build_object('unresolved', true) else '{}'::jsonb end
    );
  end loop;
  if v_rate_sum > 100.01 then
    raise exception 'Paylaşım oranlarının toplamı %%100''ü aşamaz (şu an %%%).', pg_catalog.round(v_rate_sum, 2) using errcode = '23514';
  end if;
  if v_amount_sum > coalesce(p_gross, 0) * 1.0001 + 0.01 then
    raise exception 'Paylaşım tutarlarının toplamı brüt komisyon tutarını aşamaz.' using errcode = '23514';
  end if;
  return v_out;
end;
$function$;

revoke all on function public.commission_normalize_splits(uuid, uuid, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.commission_normalize_splits(uuid, uuid, numeric, jsonb) to service_role;
