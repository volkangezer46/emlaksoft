-- Rollback: 20261012000800_property_price_proposals
-- Oneri RPC'leri ve tablo duser (oneri gecmisi kaybolur; portfoy fiyatlari ve fiyat izi KALIR). Fiyat kapisi 20261007000800 govdesine doner.

create or replace function public.guard_property_list_price_drop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rule jsonb;
  v_raw text;
  v_threshold numeric := 15;
  v_drop_pct numeric;
  v_ref numeric;
  v_approval uuid;
  v_rows integer;
begin
  -- service_role (cron/seed/admin), migration ve dogrudan DB oturumlari bu kurala tabi degil.
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;

  -- Degismeyen deger ve ARTIS gecer. Fiyatin BOSALTILMASI (NULL) dusus sayilir (NULL ara adimiyla atlama kapanir).
  if new.list_price is not distinct from old.list_price then
    return new;
  end if;
  if new.list_price is not null and old.list_price is not null and new.list_price >= old.list_price then
    return new;
  end if;

  -- Referans fiyat: mevcut deger ile son 30 gunluk tarihcedeki en yuksek liste fiyati. Esik altindaki ardisik
  -- kucuk dususler (kumulatif) ve "once NULL, sonra dusuk deger" yolu bu referansa gore olculur.
  select max(x.p) into v_ref
    from (
      select old.list_price as p
      union all
      select greatest(h.old_price, h.new_price)
        from public.property_price_history h
       where h.property_id = old.id
         and h.price_field = 'list_price'
         and h.created_at > now() - interval '30 days'
    ) x;
  if v_ref is null or v_ref <= 0 then
    return new;
  end if;
  if new.list_price is not null and new.list_price >= v_ref then
    return new;
  end if;

  select s.approval_rules -> 'price_drop' into v_rule
    from public.oversight_settings s
   where s.tenant_id = old.tenant_id;

  -- Kural yok/kapali: uygulama katmaniyla ayni (varsayilan KAPALI).
  if v_rule is null
     or jsonb_typeof(v_rule) <> 'object'
     or jsonb_typeof(v_rule -> 'enabled') is distinct from 'boolean'
     or (v_rule ->> 'enabled') <> 'true' then
    return new;
  end if;

  -- Esik: sayi ya da sayi metni (virgul/nokta); bozuksa varsayilan 15; 1..90 araligina sikistirilir.
  v_raw := case jsonb_typeof(v_rule -> 'threshold')
             when 'number' then v_rule ->> 'threshold'
             when 'string' then replace(btrim(v_rule ->> 'threshold'), ',', '.')
             else null
           end;
  if v_raw is not null and v_raw ~ '^[0-9]+([.][0-9]+)?$' then
    v_threshold := least(90, greatest(1, v_raw::numeric));
  end if;

  v_drop_pct := (v_ref - coalesce(new.list_price, 0)) / v_ref * 100;
  if v_drop_pct < v_threshold then
    return new;
  end if;

  -- Muafiyet: yalniz owner/gm (src/lib/team/assignable-roles.ts APPROVAL_EXEMPT_ROLES).
  if public.current_profile_role() in ('owner', 'gm') then
    return new;
  end if;

  if v_uid is null then
    raise exception 'Fiyat dusurmesi icin oturum gerekli.' using errcode = '42501';
  end if;

  -- (a) Tuketilmemis onayli talebi atomik tuket.
  select a.id into v_approval
    from public.approval_requests a
   where a.tenant_id = old.tenant_id
     and a.requested_by = v_uid
     and a.status = 'onaylandi'
     and a.consumed_at is null
     and a.decided_at is not null
     and a.decided_at > now() - interval '48 hours'
     and a.requested_value is not null
     and new.list_price >= a.requested_value
     and starts_with(coalesce(a.description, ''), '[oversight:price_drop:' || old.id::text || ']')
   order by a.decided_at desc
   limit 1
   for update;

  if v_approval is not null then
    update public.approval_requests
       set consumed_at = now()
     where id = v_approval and consumed_at is null;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      return new;
    end if;
  end if;

  -- (b) Uygulama yolu onayi bu UPDATE'ten hemen once tuketmistir (consume -> update).
  if exists (
    select 1
      from public.approval_requests a
     where a.tenant_id = old.tenant_id
       and a.requested_by = v_uid
       and a.status = 'onaylandi'
       and a.consumed_at is not null
       and a.consumed_at > now() - interval '5 minutes'
       and a.decided_at is not null
       and a.decided_at > now() - interval '48 hours'
       and a.requested_value is not null
       and new.list_price >= a.requested_value
       and starts_with(coalesce(a.description, ''), '[oversight:price_drop:' || old.id::text || ']')
  ) then
    return new;
  end if;

  raise exception 'Bu fiyat dusurmesi ofis kurali geregi yonetici onayi gerektirir (/app/onaylar).' using errcode = '42501';
end;
$$;

revoke all on function public.guard_property_list_price_drop() from public, anon, authenticated;

drop function if exists public.decide_property_price_proposal_by_token(text, uuid, text, text);
drop function if exists public.cancel_property_price_proposal(uuid);
drop function if exists public.create_property_price_proposal(uuid, numeric, text, jsonb);
drop table if exists public.property_price_proposals;

notify pgrst, 'reload schema';
