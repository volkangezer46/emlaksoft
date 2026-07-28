-- permission_defaults backfill — MATRIX ile DB kopyası arasındaki sürüklenmeyi kapatır.
--
-- Denetimde (entegrasyon denetimi, dalga L–O) `permission_defaults` tablosunda 21 modül
-- olduğu, `src/lib/permissions.ts` AppModule listesinde ise 27 modül bulunduğu görüldü.
-- Eksik 6 modül: campaigns, contracts, expenses, offers, targets, open_house.
-- Bu modüller kendi migration'larında (kampanya/teklif/sözleşme/gider/hedef/açık ev)
-- tablo + RLS aldı ama `permission_defaults` seed'i atlanmış.
--
-- ETKİ: `public.has_effective_permission()` bugün yalnız commissions / payment_links /
-- profiles(team) politikalarında kullanıldığı için canlı bir erişim kırılması YOKTU;
-- eksiklik latent bir sürüklenme. Ancak ileride bu modüllerin tablolarına role-aware RLS
-- eklenirse (bkz. 20260722000016 dosyasının "follow-up" notu) fonksiyon varsayılanı
-- bulamayıp false dönerdi. CLAUDE.md'deki "yeni modül = 4 kayıt yeri" kuralının
-- 4. ayağı burada kapatılıyor.
--
-- Kaynak: src/lib/permissions.ts DEFAULT_MATRIX ile BİREBİR.

-- ---------- owner + gm: altı modülde de tam yetki (ALL) ----------
insert into public.permission_defaults (role, module, action)
select r, m, a
from (values ('owner'), ('gm')) as roles(r)
cross join (values ('campaigns'), ('contracts'), ('expenses'), ('offers'), ('targets'), ('open_house')) as mods(m)
cross join (values ('view'), ('create'), ('edit'), ('delete')) as acts(a)
on conflict do nothing;

-- ---------- branch_manager: campaigns + contracts → view/create/edit ----------
insert into public.permission_defaults (role, module, action)
select 'branch_manager', m, a
from (values ('campaigns'), ('contracts')) as mods(m)
cross join (values ('view'), ('create'), ('edit')) as acts(a)
on conflict do nothing;

-- ---------- team_lead: campaigns → view, contracts → view/create/edit ----------
insert into public.permission_defaults (role, module, action)
values ('team_lead', 'campaigns', 'view')
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
select 'team_lead', 'contracts', a
from (values ('view'), ('create'), ('edit')) as acts(a)
on conflict do nothing;

-- ---------- advisor: campaigns → view, contracts → view/create/edit ----------
insert into public.permission_defaults (role, module, action)
values ('advisor', 'campaigns', 'view')
on conflict do nothing;

insert into public.permission_defaults (role, module, action)
select 'advisor', 'contracts', a
from (values ('view'), ('create'), ('edit')) as acts(a)
on conflict do nothing;
