-- 20261014022000 geri alma: 'engine_stalled' uyarı kuralı kaldırılır (CHECK kısıtı mevcut tanımdan 'engine_stalled'
-- çıkarılarak daraltılır; diğer anahtarlar korunur). Açık 'engine_stalled' olayları kapanır. Sunucu betiği kural satırı
-- yokken kod varsayılanıyla değerlendirmeyi sürdürür; tamamen durdurmak için betiğin eski sürümü kurulmalı.
set local lock_timeout = '5s';

do $$
declare
  v_def text;
begin
  if to_regclass('public.alert_rules') is null then
    return;
  end if;
  update public.alert_events set resolved_at = now() where rule_key = 'engine_stalled' and resolved_at is null;
  delete from public.alert_rules where key = 'engine_stalled';
  select pg_catalog.pg_get_constraintdef(c.oid)
    into v_def
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.alert_rules'::regclass and c.conname = 'alert_rules_key';
  if v_def is not null and position('''engine_stalled''' in v_def) > 0 then
    alter table public.alert_rules drop constraint alert_rules_key;
    execute format(
      'alter table public.alert_rules add constraint alert_rules_key %s',
      replace(replace(v_def, '''engine_stalled''::text, ', ''), ', ''engine_stalled''::text', '')
    );
  end if;
end $$;

notify pgrst, 'reload schema';
