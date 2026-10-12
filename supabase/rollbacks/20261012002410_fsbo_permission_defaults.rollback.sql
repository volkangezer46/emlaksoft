-- 20261012002410 geri alma: prospecting varsayilan izinleri silinir (kullanici istisnalari etkilenmez).
delete from public.permission_defaults where module = 'prospecting';
