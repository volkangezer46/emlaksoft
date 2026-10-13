-- 20261013004910 geri alma: onarımla kurulan push_subscriptions tablosu YALNIZ BOŞSA düşürülür.
-- Abonelik kaydı varsa (kullanıcılar bildirim açmış) hiçbir şey yapılmaz: tabloyu düşürmek kayıtları siler ve
-- 20260722000013 ledger'da uygulanmış göründüğü için tablo bir daha kendiliğinden gelmez.
do $$
begin
  if pg_catalog.to_regclass('public.push_subscriptions') is not null then
    if not exists (select 1 from public.push_subscriptions) then
      drop table public.push_subscriptions;
    else
      raise notice 'push_subscriptions boş değil; geri alma atlandı';
    end if;
  end if;
end $$;
notify pgrst, 'reload schema';
