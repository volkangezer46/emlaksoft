-- MIGRATION 20261014022000_alert_engine_pulse_rule.sql (SN2 — uyarı motoru nabız kuralı)
-- NE YAPAR: alert_rules'a 'engine_stalled' kuralını ekler (AD10 uyarı merkezi). Kural SUNUCU tarafında değerlendirilir:
--   scripts/sunucu/error-watch.sh dakikada bir `alert-send.py engine-check` çağırır; uyari-motoru kalp atışı
--   (cron_heartbeats.job = 'uyari-motoru') eşik dakikası boyunca gelmezse Telegram/e-posta/webhook uyarısı gider ve
--   alert_events'e (source='host', fingerprint 'engine_stalled') yazılır; nabız dönünce "düzeldi".
--   CHECK kısıtı mevcut tanımdan türetilerek genişletilir (başka paketlerin eklediği anahtarlar korunur; liste elle
--   yeniden yazılmaz — 20261014006000 kvkk_sla deseni). Tohum satırı: açık, eşik 20 dk, tekrar 60 dk.
-- BAĞIMLILIK: 20261013004900_ops_alerts.sql (alert_rules). Tablo yoksa hiçbir şey yazmadan çıkar (kod varsayılanla çalışır).
-- KOD: migration yokken sunucu betiği kuralı kod varsayılanıyla (açık, 20 dk, 60 dk) değerlendirir; Uyarılar sekmesinde
--   kural görünür ama kaydetme "kurulum bekliyor" der. Rozet varsayılan eşikle çalışır.
-- GERİ ALMA: supabase/rollbacks/20261014022000_alert_engine_pulse_rule.rollback.sql.
-- RİSK: düşük (CHECK genişlemesi + tek tohum satırı; mevcut veri değişmez). İdempotent.
-- SALT-OKUNUR DOĞRULAMA: select key, enabled, threshold, repeat_minutes from public.alert_rules where key = 'engine_stalled';

set local lock_timeout = '5s';

do $$
declare
  v_def text;
begin
  if to_regclass('public.alert_rules') is null then
    return; -- AD10 henüz yok: kural kod varsayılanıyla çalışır
  end if;
  select pg_catalog.pg_get_constraintdef(c.oid)
    into v_def
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.alert_rules'::regclass and c.conname = 'alert_rules_key';
  if v_def is not null and position('''engine_stalled''' in v_def) = 0 then
    if position('ARRAY[' in v_def) = 0 then
      raise exception 'alert_rules_key beklenen biçimde değil: %', v_def;
    end if;
    alter table public.alert_rules drop constraint alert_rules_key;
    execute format('alter table public.alert_rules add constraint alert_rules_key %s', replace(v_def, 'ARRAY[', 'ARRAY[''engine_stalled''::text, '));
  end if;
  insert into public.alert_rules (key, enabled, threshold, repeat_minutes) values
    ('engine_stalled', true, 20, 60)
  on conflict (key) do nothing;
end $$;

notify pgrst, 'reload schema';
