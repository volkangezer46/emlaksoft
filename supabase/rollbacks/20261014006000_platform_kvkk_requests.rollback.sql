-- 20261014006000 geri alma: platform KVKK başvuru tablosu düşer ve 'kvkk_sla' uyarı kuralı kaldırılır (CHECK kısıtı
-- mevcut tanımdan 'kvkk_sla' çıkarılarak daraltılır; diğer anahtarlar korunur). Açık 'kvkk_sla' uyarı olayları kapanır.
-- DİKKAT: başvuru kayıtları (yasal yanıt kanıtı) silinir; geri almadan önce Raporlar > "KVKK başvuru defteri" alınmalı.
set local lock_timeout = '5s';

do $$
declare
  v_def text;
begin
  if to_regclass('public.alert_rules') is null then
    return;
  end if;
  update public.alert_events set resolved_at = now() where rule_key = 'kvkk_sla' and resolved_at is null;
  delete from public.alert_rules where key = 'kvkk_sla';
  select pg_catalog.pg_get_constraintdef(c.oid)
    into v_def
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.alert_rules'::regclass and c.conname = 'alert_rules_key';
  if v_def is not null and position('''kvkk_sla''' in v_def) > 0 then
    alter table public.alert_rules drop constraint alert_rules_key;
    execute format(
      'alter table public.alert_rules add constraint alert_rules_key %s',
      replace(replace(v_def, '''kvkk_sla''::text, ', ''), ', ''kvkk_sla''::text', '')
    );
  end if;
end $$;

drop table if exists public.platform_kvkk_requests;
notify pgrst, 'reload schema';
