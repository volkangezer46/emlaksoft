-- Güvenlik sertleştirmesi (denetim bulgusu)
--
-- tenant_integrations.credentials içinde Netgsm KULLANICI ADI + ŞİFRESİ düz
-- metin saklanıyor (bkz. 20260726000060). Mevcut politikalar tenant'ın HER
-- üyesine (advisor dahil) select/insert/update/delete veriyordu — yani sıradan
-- bir danışman, tarayıcıdan PostgREST'e doğrudan istekle ofisin SMS şifresini
-- okuyabilir veya değiştirebilirdi.
--
-- Düzeltme: user_permission_overrides (20260726000067) desenine çekildi —
-- yalnız owner/gm okur ve yazar. Sunucu tarafı SMS gönderim yolu
-- (src/app/imza/_lib/sms.ts) service_role ile okuduğu için ETKİLENMEZ.
-- /app/ayarlar sayfası ve saveNetgsmCredentials / clearNetgsmCredentials
-- action'ları kullanıcı oturumuyla çalışır; ayar düzenleme zaten owner/gm
-- yetkisi gerektirdiğinden davranış değişmez (yetkisiz roller artık maskeli
-- formda mevcut kaydı da göremez — istenen budur).

drop policy if exists tenant_integrations_read   on public.tenant_integrations;
drop policy if exists tenant_integrations_insert on public.tenant_integrations;
drop policy if exists tenant_integrations_update on public.tenant_integrations;
drop policy if exists tenant_integrations_delete on public.tenant_integrations;

create policy tenant_integrations_read on public.tenant_integrations for select
  using (
    tenant_id = public.current_tenant_id()
    and public.current_profile_role() in ('owner', 'gm')
  );

create policy tenant_integrations_insert on public.tenant_integrations for insert
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_profile_role() in ('owner', 'gm')
  );

create policy tenant_integrations_update on public.tenant_integrations for update
  using (
    tenant_id = public.current_tenant_id()
    and public.current_profile_role() in ('owner', 'gm')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_profile_role() in ('owner', 'gm')
  );

create policy tenant_integrations_delete on public.tenant_integrations for delete
  using (
    tenant_id = public.current_tenant_id()
    and public.current_profile_role() in ('owner', 'gm')
  );
