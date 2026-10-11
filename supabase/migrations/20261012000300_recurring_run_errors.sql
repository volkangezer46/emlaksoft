-- Konsey #19 (SQL kismi): recurring_run_due hatalari ARTIK sayiyla birlikte DIZI olarak doner.
-- Eski govde "exception when others -> v_failed + 1" ile nedeni yutuyordu; cron heartbeat yalniz sayiyi gorebiliyordu.
-- Yeni: 'errors' = en cok 20 oge {rule_id, step (run|remind), code (SQLSTATE), message (en cok 200 karakter)}.
-- Baz: 20261010000900_recurring_rules.sql govdesi (baska migration bu fonksiyonu degistirmedi); davranis ayni, yalniz hata dizisi eklenir.
-- Yetkiler create or replace ile korunur; yine de acikca yeniden verilir (yalniz service_role).

create or replace function public.recurring_run_due(p_today date, p_skip_tenants uuid[] default '{}')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.recurring_rules%rowtype;
  v_occ uuid;
  v_inserted integer;
  v_res text;
  v_loop integer;
  v_posted integer := 0;
  v_drafts integer := 0;
  v_skipped integer := 0;
  v_reminded integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_period date;
begin
  if p_today is null then return jsonb_build_object('outcome', 'invalid_input'); end if;

  for r in
    select * from public.recurring_rules x
     where x.active and x.next_due is not null and x.next_due <= p_today and not (x.tenant_id = any (coalesce(p_skip_tenants, '{}')))
     order by x.next_due, x.id limit 1000
  loop
    begin
      v_loop := 0;
      -- Cron birkaç gün çalışmadıysa kaçan dönemler de (en çok 12) üretilir; kural başlangıcından önce hiçbir dönem üretilmez.
      while v_loop < 12 loop
        select * into r from public.recurring_rules x where x.id = r.id and x.active and x.next_due is not null and x.next_due <= p_today for update;
        exit when not found;
        v_period := r.next_period;
        insert into public.recurring_occurrences (tenant_id, rule_id, period, due_date, amount, status)
        values (r.tenant_id, r.id, v_period, r.next_due, r.amount, 'pending')
        on conflict (rule_id, period) do nothing
        returning id into v_occ;
        get diagnostics v_inserted = row_count;
        if v_inserted > 0 then
          if r.mode = 'auto' then
            v_res := public.recurring_post_occurrence(v_occ, null, r.created_by);
            if v_res = 'posted' then
              v_posted := v_posted + 1;
              perform public.recurring_notify(r.id, 'Düzenli ödeme kaydedildi',
                r.title || ' · ' || public.recurring_money_text(r.amount) || ' hesabınıza işlendi.',
                'info', 'recurring-post:' || r.id::text || ':' || v_period::text);
            else
              update public.recurring_occurrences set status = 'skipped', skip_reason = v_res, decided_at = pg_catalog.now() where id = v_occ;
              v_skipped := v_skipped + 1;
              perform public.recurring_notify(r.id, 'Düzenli ödeme kaydedilemedi',
                r.title || ' bu ay kaydedilemedi (' ||
                case v_res when 'archived' then 'hesap arşivde' when 'before_opening' then 'tarih hesap açılışından önce' else 'kayıt zaten var' end || ').',
                'warning', 'recurring-fail:' || r.id::text || ':' || v_period::text);
            end if;
          else
            v_drafts := v_drafts + 1;
            perform public.recurring_notify(r.id, 'Onay bekleyen ödeme',
              r.title || ' · ' || public.recurring_money_text(r.amount) || ' — onayınızı bekliyor.',
              'warning', 'recurring-draft:' || v_occ::text);
          end if;
        end if;
        perform public.recurring_advance(r.id, v_period);
        v_loop := v_loop + 1;
      end loop;
    exception when others then
      v_failed := v_failed + 1;
      if pg_catalog.jsonb_array_length(v_errors) < 20 then
        v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rule_id', r.id, 'step', 'run', 'code', SQLSTATE, 'message', pg_catalog.left(SQLERRM, 200)));
      end if;
    end;
  end loop;

  -- Vade -3 gün hatırlatması (kural başına vade başına bir kez).
  for r in
    select * from public.recurring_rules x
     where x.active and x.next_due is not null and x.next_due > p_today and x.next_due <= p_today + 3
       and x.remind_for is distinct from x.next_due and not (x.tenant_id = any (coalesce(p_skip_tenants, '{}')))
     order by x.next_due, x.id limit 1000
  loop
    begin
      perform public.recurring_notify(r.id, 'Yaklaşan düzenli ödeme',
        r.title || ' · ' || public.recurring_money_text(r.amount) || ' · ' || pg_catalog.to_char(r.next_due, 'DD.MM.YYYY') ||
        case when r.mode = 'auto' then ' tarihinde otomatik kaydedilecek.' else ' tarihinde onayınıza sunulacak.' end,
        'info', 'recurring-remind:' || r.id::text || ':' || r.next_due::text);
      update public.recurring_rules set remind_for = r.next_due where id = r.id;
      v_reminded := v_reminded + 1;
    exception when others then
      v_failed := v_failed + 1;
      if pg_catalog.jsonb_array_length(v_errors) < 20 then
        v_errors := v_errors || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rule_id', r.id, 'step', 'remind', 'code', SQLSTATE, 'message', pg_catalog.left(SQLERRM, 200)));
      end if;
    end;
  end loop;

  return jsonb_build_object('outcome', 'ok', 'posted', v_posted, 'drafts', v_drafts, 'skipped', v_skipped, 'reminded', v_reminded, 'failed', v_failed, 'errors', v_errors);
end;
$$;

revoke all on function public.recurring_run_due(date, uuid[]) from public, anon, authenticated;
grant execute on function public.recurring_run_due(date, uuid[]) to service_role;
