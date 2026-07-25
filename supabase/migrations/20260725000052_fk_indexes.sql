-- Foreign key indeksleri — 80 indekssiz FK kapatıldı
--
-- BULGU: pg_constraint taraması, public şemasındaki 80 foreign key kolonunun
-- hiçbir indeksin İLK kolonu olmadığını gösterdi. En sıcak tablolar başı
-- çekiyordu: properties (7), appointments (5), customers (5), tasks (5),
-- customer_demands (4), deals (3).
--
-- İKİ YÖNLÜ MALİYET:
--  1) JOIN tarafı: `properties p join profiles pr on pr.id = p.assigned_to`
--     gibi her sorgu çocuk tabloda sıralı tarama yapıyor.
--  2) SİLME tarafı — daha sinsi olan: bir üst kayıt (profil, portföy, müşteri)
--     silindiğinde Postgres FK kısıtını doğrulamak için HER çocuk tabloyu
--     baştan sona tarıyor. "Bir danışmanı sil" işlemi veri büyüdükçe
--     dakikalara çıkabilir.
--
-- Şu anda veri küçük (1 portföy) olduğu için yavaşlık görünmüyor; bu bir
-- saatli bomba. İndeksler boş tabloda maliyetsiz, sonra eklemek pahalı.
--
-- TAKAS: her indeks yazma maliyeti getirir. Yazma hacmi sorun olursa ilk
-- düşürülecekler denetim amaçlı kolonlar: created_by, changed_by, uploaded_by,
-- updated_by, published_by, handled_by. Bunlar nadiren sorgulanır; yalnızca
-- profil silinirken FK kontrolü için gerekli. Okuma yollarındaki (tenant_id,
-- property_id, customer_id, deal_id, assigned_to, *_district_id) indeksler
-- korunmalı.
--
-- Not: tenant_id indeksleri KRİTİK — RLS politikaları ve neredeyse her sorgu
-- bu kolonu filtreliyor.

create index if not exists idx_appointments_assigned_to on public.appointments (assigned_to);
create index if not exists idx_appointments_branch_id on public.appointments (branch_id);
create index if not exists idx_appointments_created_by on public.appointments (created_by);
create index if not exists idx_appointments_customer_id on public.appointments (customer_id);
create index if not exists idx_appointments_property_id on public.appointments (property_id);
create index if not exists idx_automation_logs_tenant_id on public.automation_logs (tenant_id);
create index if not exists idx_automations_created_by on public.automations (created_by);
create index if not exists idx_branches_district_id on public.branches (district_id);
create index if not exists idx_branches_province_id on public.branches (province_id);
create index if not exists idx_calls_customer_id on public.calls (customer_id);
create index if not exists idx_calls_handled_by on public.calls (handled_by);
create index if not exists idx_campaign_recipients_customer_id on public.campaign_recipients (customer_id);
create index if not exists idx_campaigns_created_by on public.campaigns (created_by);
create index if not exists idx_commissions_deal_id on public.commissions (deal_id);
create index if not exists idx_communications_created_by on public.communications (created_by);
create index if not exists idx_contracts_created_by on public.contracts (created_by);
create index if not exists idx_customer_demands_customer_id on public.customer_demands (customer_id);
create index if not exists idx_customer_demands_district_id on public.customer_demands (district_id);
create index if not exists idx_customer_demands_neighborhood_id on public.customer_demands (neighborhood_id);
create index if not exists idx_customer_demands_province_id on public.customer_demands (province_id);
create index if not exists idx_customer_portal_tokens_created_by on public.customer_portal_tokens (created_by);
create index if not exists idx_customer_portal_tokens_tenant_id on public.customer_portal_tokens (tenant_id);
create index if not exists idx_customers_assigned_to on public.customers (assigned_to);
create index if not exists idx_customers_branch_id on public.customers (branch_id);
create index if not exists idx_customers_created_by on public.customers (created_by);
create index if not exists idx_customers_district_id on public.customers (district_id);
create index if not exists idx_customers_province_id on public.customers (province_id);
create index if not exists idx_deals_assigned_to on public.deals (assigned_to);
create index if not exists idx_deals_customer_id on public.deals (customer_id);
create index if not exists idx_deals_property_id on public.deals (property_id);
create index if not exists idx_definitions_tenant_id on public.definitions (tenant_id);
create index if not exists idx_demo_requests_converted_tenant_id on public.demo_requests (converted_tenant_id);
create index if not exists idx_expenses_created_by on public.expenses (created_by);
create index if not exists idx_expenses_property_id on public.expenses (property_id);
create index if not exists idx_invoices_subscription_id on public.invoices (subscription_id);
create index if not exists idx_listing_closures_created_by on public.listing_closures (created_by);
create index if not exists idx_listing_closures_portal_listing_id on public.listing_closures (portal_listing_id);
create index if not exists idx_notifications_user_id on public.notifications (user_id);
create index if not exists idx_offers_customer_id on public.offers (customer_id);
create index if not exists idx_open_house_visitors_created_customer_id on public.open_house_visitors (created_customer_id);
create index if not exists idx_open_house_visitors_open_house_id on public.open_house_visitors (open_house_id);
create index if not exists idx_open_houses_created_by on public.open_houses (created_by);
create index if not exists idx_open_houses_property_id on public.open_houses (property_id);
create index if not exists idx_owner_portal_tokens_created_by on public.owner_portal_tokens (created_by);
create index if not exists idx_owner_portal_tokens_tenant_id on public.owner_portal_tokens (tenant_id);
create index if not exists idx_payment_links_commission_id on public.payment_links (commission_id);
create index if not exists idx_payment_links_created_by on public.payment_links (created_by);
create index if not exists idx_payment_links_customer_id on public.payment_links (customer_id);
create index if not exists idx_platform_settings_updated_by on public.platform_settings (updated_by);
create index if not exists idx_portal_listings_published_by on public.portal_listings (published_by);
create index if not exists idx_profiles_branch_id on public.profiles (branch_id);
create index if not exists idx_properties_assigned_to on public.properties (assigned_to);
create index if not exists idx_properties_branch_id on public.properties (branch_id);
create index if not exists idx_properties_created_by on public.properties (created_by);
create index if not exists idx_properties_district_id on public.properties (district_id);
create index if not exists idx_properties_neighborhood_id on public.properties (neighborhood_id);
create index if not exists idx_properties_province_id on public.properties (province_id);
create index if not exists idx_properties_source_agent on public.properties (source_agent);
create index if not exists idx_property_dues_created_by on public.property_dues (created_by);
create index if not exists idx_property_dues_property_id on public.property_dues (property_id);
create index if not exists idx_property_media_property_id on public.property_media (property_id);
create index if not exists idx_property_media_uploaded_by on public.property_media (uploaded_by);
create index if not exists idx_property_price_history_changed_by on public.property_price_history (changed_by);
create index if not exists idx_property_status_history_changed_by on public.property_status_history (changed_by);
create index if not exists idx_property_status_history_tenant_id on public.property_status_history (tenant_id);
create index if not exists idx_share_links_created_by on public.share_links (created_by);
create index if not exists idx_share_links_tenant_id on public.share_links (tenant_id);
create index if not exists idx_support_tickets_assigned_to on public.support_tickets (assigned_to);
create index if not exists idx_support_tickets_created_by on public.support_tickets (created_by);
create index if not exists idx_targets_profile_id on public.targets (profile_id);
create index if not exists idx_tasks_assigned_to on public.tasks (assigned_to);
create index if not exists idx_tasks_created_by on public.tasks (created_by);
create index if not exists idx_tasks_customer_id on public.tasks (customer_id);
create index if not exists idx_tasks_deal_id on public.tasks (deal_id);
create index if not exists idx_tasks_property_id on public.tasks (property_id);
create index if not exists idx_tenant_role_permissions_updated_by on public.tenant_role_permissions (updated_by);
create index if not exists idx_tenants_district_id on public.tenants (district_id);
create index if not exists idx_tenants_province_id on public.tenants (province_id);
create index if not exists idx_valuations_created_by on public.valuations (created_by);
create index if not exists idx_valuations_property_id on public.valuations (property_id);
