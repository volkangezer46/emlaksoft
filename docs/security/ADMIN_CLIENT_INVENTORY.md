# createAdminClient Envanteri

> ÜRETİLMİŞ DOSYA — elle düzenleme. Yeniden üret: `npx tsx scripts/audit-admin-client.ts --write`.
> Yöntem: statik, heuristik (TS AST + regex). Kanıt düzeyi: "var" = kaynakta `tenant_id` geçiyor, filtrenin
> doğruluğu DOĞRULANMADI. "belirsiz" = işlev ve dosyada tanınan kapı yok; çağıranlar elle incelenmeli.
> Kapsam: `src/**` (test ve `scripts/` hariç). Canlı DB'ye bağlanılmadı.

## Özet

- Toplam birim: **361** (201 dosya) — risk: P0=3, P1=21, P2=337
- Tenant filtresi: var=228, uygulanamaz=79, yok=46, param=6, devir=2
- Kapı türü: public-token=34, dosya-duzeyi=62, platform=91, oturum-izin=78, belirsiz=60, elle-dogrulandi=12, cron=21, webhook-imza=3
- Filtresiz (yok+devir): **48**; RLS'li client'a taşıma adayı: **66**

Risk ölçütü: P0 = tenant filtresi yok/devir VE kapı belirsiz; P1 = filtresiz ama kapı zayıf/oturum-izin
(kiracı kimliği istemciden gelirse IDOR), veya yalnız parametre filtreli + zayıf kapı + yazma; P2 = diğerleri.
Not: cron/platform birimlerinin "filtresiz" olması tasarım gereğidir (kiracılar arası iş); P2 sayılır.

## P0 — filtresiz VE kapısı belirsiz (ÖNCE bunlar elle incelenmeli)

| Dosya:satır | İşlev | Neden admin | Kapı türü | Tenant filtresi | Risk |
|---|---|---|---|---|---|
| `src/app/admin/_dashboards/support-home.tsx:40` | `SupportHome` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/billing/plan-support.ts:85` | `getFoundersStatus` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/billing/plan-support.ts:31` | `getPlanSupport` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |

## P1

| Dosya:satır | İşlev | Neden admin | Kapı türü | Tenant filtresi | Risk |
|---|---|---|---|---|---|
| `src/app/actions/admin-ticket-ops.ts:107` | `updateAdminField` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/actions/agent-profile.ts:206` | `removeAgentPhoto` | Gerekçe doğrulanmadı. | dosya-duzeyi | param (yazma) | P1 |
| `src/app/actions/agent-profile.ts:105` | `saveAgentProfile` | Gerekçe doğrulanmadı. | dosya-duzeyi | param (yazma) | P1 |
| `src/app/actions/agent-profile.ts:176` | `uploadAgentPhoto` | Gerekçe doğrulanmadı. | dosya-duzeyi | param (yazma) | P1 |
| `src/app/actions/appointments-confirm.ts:34` | `respondToAppointmentByToken` | Oturumsuz token'lı public yüzey. | public-token | yok | P1 |
| `src/app/actions/appointments.ts:204` | `regenerateCalendarToken` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | yok (yazma) | P1 |
| `src/app/actions/contracts.ts:504` | `verifySignatureOtp` | Oturumsuz token'lı public yüzey. | public-token | yok (yazma) | P1 |
| `src/app/actions/owner-portal-offers.ts:37` | `respondToOfferByToken` | Oturumsuz token'lı public yüzey. | public-token | yok | P1 |
| `src/app/actions/platform-staff.ts:355` | `resetStaffPassword` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/actions/platform-staff.ts:391` | `signOutStaffSessions` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/admin/_dashboards/billing-home.tsx:43` | `BillingHome` | Gerekçe doğrulanmadı. | belirsiz | param | P1 |
| `src/app/admin/ayarlar/page.tsx:14` | `trialFunctionApplied` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/admin/sistem/schema-checks.ts:55` | `probeSchema` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/api/property-media/[id]/private/route.ts:54` | `GET` | Oturumsuz token'lı public yüzey. | public-token | yok | P1 |
| `src/app/app/sozlesmeler/[id]/page.tsx:85` | `ContractDetailPage` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | yok | P1 |
| `src/app/randevu-teyit/[token]/page.tsx:53` | `AppointmentConfirmPage` | Oturumsuz token'lı public yüzey. | public-token | yok | P1 |
| `src/lib/admin/activity-query.ts:186` | `resolveActorNames` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/ai-advisor.ts:46` | `buildAdvisorContext` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/billing/fulfillment.ts:65` | `transitionCapture` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/billing/reconciliation.ts:172` | `runBillingReconciliation` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/storage-deletion-outbox.ts:160` | `processStorageDeletionOutbox` | Gerekçe doğrulanmadı. | dosya-duzeyi | devir (yazma) | P1 |

## P2

| Dosya:satır | İşlev | Neden admin | Kapı türü | Tenant filtresi | Risk |
|---|---|---|---|---|---|
| `src/app/acik-ev-kayit/[token]/page.tsx:51` | `OpenHouseCheckinPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/account.ts:45` | `updateMyProfile` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/admin-ticket-extra.ts:18` | `searchTicketTenants` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/admin-ticket-extra.ts:43` | `updateTicketMacro` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/admin-ticket-ops.ts:216` | `bulkUpdateTickets` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/actions/admin-ticket-ops.ts:243` | `createTicketMacro` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/admin-ticket-ops.ts:258` | `deleteTicketMacro` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/ai-advisor.ts:61` | `askAdvisor` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/ai-advisor.ts:176` | `deleteAdvisorSession` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/ai-advisor.ts:117` | `listAdvisorSessions` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/ai-advisor.ts:149` | `loadAdvisorSession` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/appointments-suggest.ts:46` | `suggestAlternativeTimesByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/auth.ts:96` | `signIn` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/auth.ts:451` | `signOut` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/app/actions/auth.ts:367` | `signUp` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | param (yazma) | P2 |
| `src/app/actions/booking-public.ts:64` | `createPublicBooking` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/bulk-property.ts:34` | `bulkUpdatePropertyStatus` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/campaigns.ts:81` | `createCampaign` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/campaigns.ts:183` | `sendCampaign` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/compliance.ts:27` | `upsertIysConsent` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/contract-signers.ts:88` | `resendSignerSms` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/contract-signers.ts:41` | `updateContractSigner` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/contracts.ts:607` | `cancelContract` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/contracts.ts:407` | `requestSignatureOtp` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/contracts.ts:219` | `sendContractForSigning` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/contracts.ts:284` | `signContractByToken` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/contracts.ts:105` | `updateContractDraftAtomic` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/app/actions/customer-portal-feedback.ts:46` | `submitMatchFeedbackByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/customer-portal.ts:160` | `getCustomerPortalData` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/customers.ts:896` | `mergeCustomers` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/deals.ts:122` | `updateDealStage` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/demo-login.ts:96` | `ensureDemoTenant` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/demo-login.ts:145` | `ensurePersona` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/demo.ts:80` | `requestDemo` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/error-logs.ts:54` | `reopenErrorLog` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok (yazma) | P2 |
| `src/app/actions/error-logs.ts:31` | `resolveErrorLog` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok (yazma) | P2 |
| `src/app/actions/error-logs.ts:75` | `resolveErrorLogs` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok (yazma) | P2 |
| `src/app/actions/geo-admin.ts:138` | `createDistrict` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/geo-admin.ts:223` | `createNeighborhood` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/geo-admin.ts:190` | `deleteDistrict` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/geo-admin.ts:275` | `deleteNeighborhood` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/geo-admin.ts:76` | `enqueueProvinceGeoSync` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/actions/geo-admin.ts:168` | `updateDistrict` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/geo-admin.ts:252` | `updateNeighborhood` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/geo-admin.ts:42` | `updateProvince` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/kvkk.ts:93` | `purgeStaleCustomers` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/kvkk.ts:43` | `requestCustomerErasure` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/lead-intake.ts:39` | `regenerateLeadToken` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/modules.ts:165` | `setTenantModuleByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/network.ts:1258` | `decideDemandResponse` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/network.ts:1489` | `listMyDemandResponses` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/network.ts:1424` | `listMyNetworkDemands` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/network.ts:633` | `listMyNetworkListings` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/network.ts:687` | `listMyRequests` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/network.ts:1080` | `listNetworkDemandPool` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/network.ts:294` | `listNetworkPool` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/network.ts:479` | `respondCollabRequest` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/network.ts:1182` | `respondToNetworkDemand` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/network.ts:404` | `sendCollabRequest` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/offers.ts:143` | `addOfferRound` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/offers.ts:289` | `convertOfferToDeal` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/offers.ts:44` | `createOffer` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/offers.ts:215` | `updateOffer` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/offers.ts:99` | `updateOfferStatus` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/open-house-public.ts:59` | `registerOpenHouseVisitorByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/open-house.ts:77` | `convertVisitorToCustomer` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/owner-portal.ts:151` | `getOwnerPortalData` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/payment-link-manage.ts:69` | `cancelPaymentLink` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/payment-link-manage.ts:126` | `extendPaymentLink` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/payment-links.ts:83` | `createPaymentLink` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/payment-links.ts:122` | `startPaymentLinkCheckout` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/platform-account.ts:38` | `updateOwnProfile` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-billing-plans.ts:64` | `syncEntitlements` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-billing.ts:44` | `markInvoicePaid` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/platform-billing.ts:146` | `recordInvoiceRefund` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/platform-billing.ts:209` | `resolveCapture` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/app/actions/platform-billing.ts:106` | `voidInvoice` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/platform-coupons.ts:38` | `createCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-coupons.ts:120` | `deleteCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-coupons.ts:106` | `setCouponActive` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-coupons.ts:70` | `updateCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-export.ts:68` | `exportDemoRequestsCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/actions/platform-export.ts:115` | `exportInvoicesCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/actions/platform-export.ts:137` | `exportMembersCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/actions/platform-export.ts:181` | `exportPlatformReportCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/platform-export.ts:43` | `exportSubscriptionsCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/actions/platform-export.ts:24` | `exportTenantsCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-export.ts:157` | `exportTicketsCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/actions/platform-members.ts:263` | `generateMemberResetLink` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/actions/platform-members.ts:137` | `setMemberActiveAsStaff` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/platform-members.ts:91` | `setMemberRoleAsStaff` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/platform-members.ts:225` | `signOutMemberSessions` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/actions/platform-members.ts:47` | `updateMemberProfile` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/platform-notifications.ts:273` | `deleteBroadcast` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-notifications.ts:144` | `listRecentBroadcasts` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/platform-notifications.ts:27` | `markAllPlatformNotificationsRead` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-notifications.ts:14` | `markPlatformNotificationRead` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-notifications.ts:166` | `searchTenantsBroadcast` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-notifications.ts:89` | `sendBroadcast` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-notifications.ts:231` | `updateBroadcast` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-sales-leads.ts:67` | `createDemoLead` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok (yazma) | P2 |
| `src/app/actions/platform-sales-leads.ts:128` | `deleteDemoLead` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-sales-leads.ts:101` | `updateDemoLead` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok (yazma) | P2 |
| `src/app/actions/platform-sales.ts:244` | `addDemoNote` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok (yazma) | P2 |
| `src/app/actions/platform-sales.ts:215` | `assignDemo` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-sales.ts:276` | `convertDemoToTenant` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/platform-sales.ts:401` | `resendConvertedOwnerAccessLink` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/platform-sales.ts:185` | `setDemoStatus` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-staff.ts:39` | `addPlatformStaff` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-staff.ts:188` | `deactivateStaff` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-staff.ts:318` | `generateStaffResetLink` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/app/actions/platform-staff.ts:232` | `reactivateStaff` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-staff.ts:274` | `updateStaffProfile` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-staff.ts:136` | `updateStaffRole` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:1163` | `addTenantPlatformNote` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:993` | `addTenantUserByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:789` | `changeTenantOwnerEmailByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-tenants.ts:561` | `changeTenantSlugByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:196` | `checkOfficeSlugAvailability` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-tenants.ts:250` | `createTenantByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:617` | `extendTenantTrialByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:754` | `resendTenantOwnerAccessLink` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-tenants.ts:701` | `setTenantLifecycleByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-tenants.ts:1069` | `setTenantUserActiveByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:870` | `transferTenantOwnershipByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:491` | `updateTenantProfileByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform.ts:79` | `startImpersonation` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform.ts:221` | `stopImpersonation` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/platform.ts:37` | `updateTenantPlanStatus` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/portal-listings.ts:143` | `closePortalListing` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/portal-listings.ts:63` | `confirmPortalListing` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/portal-listings.ts:94` | `confirmPortalListingsBulk` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/portal-listings.ts:17` | `createPortalListing` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/portal-publish.ts:104` | `publishPropertyToPortal` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/portal-publish.ts:219` | `unpublishPropertyFromPortal` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/portal-publish.ts:167` | `updatePropertyOnPortal` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/projects.ts:411` | `sellUnit` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/properties.ts:93` | `notifyPriceDropToMatchingDemands` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/app/actions/properties.ts:512` | `setPropertyStatus` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/property-management.ts:34` | `changePropertyStatus` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/property-media.ts:398` | `ocrPropertyMediaDocument` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/public-valuation.ts:104` | `estimatePublicValuation` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/actions/public-valuation.ts:35` | `listPublicDistricts` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/actions/public-valuation.ts:209` | `submitValuationLead` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/referral-public.ts:55` | `submitReferralByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/rentals.ts:433` | `applyRentIncrease` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/rentals.ts:57` | `createRental` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/rentals.ts:113` | `endRental` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/rentals.ts:231` | `extendRental` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/rentals.ts:278` | `markDepositReturned` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/rentals.ts:175` | `updateRental` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/sample-data.ts:135` | `clearSampleData` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | uygulanamaz (yazma) | P2 |
| `src/app/actions/sample-data.ts:73` | `seedSampleData` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | param (yazma) | P2 |
| `src/app/actions/subscription-cancel.ts:37` | `requestSubscriptionCancel` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/subscription-cancel.ts:86` | `undoSubscriptionCancel` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/survey-public.ts:49` | `submitSurveyByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/team-member-admin.ts:101` | `sendAccessMail` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/app/actions/team-member-admin.ts:52` | `updateMemberProfile` | auth.admin API'si (RLS ile yapılamaz). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/team.ts:115` | `createTeamMember` | auth.admin API'si (RLS ile yapılamaz). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/team.ts:176` | `updateTeamMember` | auth.admin API'si (RLS ile yapılamaz). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/tenant-integrations.ts:120` | `clearNetgsmCredentials` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tenant-integrations.ts:281` | `clearWhatsAppCredentials` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tenant-integrations.ts:60` | `saveNetgsmCredentials` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tenant-integrations.ts:165` | `saveWhatsAppCredentials` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/ticket-attachments.ts:41` | `deleteTicketAttachment` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/tickets.ts:169` | `createSupportTicket` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tickets.ts:207` | `createSupportTicketAsStaff` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/tickets.ts:296` | `replyTicketAsStaff` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/tickets.ts:362` | `replyTicketAsTenant` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tickets.ts:327` | `setTicketStatusAsTenant` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tickets.ts:395` | `submitTicketCsat` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tickets.ts:106` | `tenantName` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/app/actions/tickets.ts:256` | `updateTicketStatus` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/vitrin-alerts.ts:57` | `createVitrinPriceAlert` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/vitrin.ts:69` | `createVitrinSavedSearch` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/vitrin.ts:160` | `likePublicShare` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/workflow.ts:69` | `convertWorkflow` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/admin/aktivite/page.tsx:170` | `AdminActivityPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/bildirimler/page.tsx:57` | `AdminNotificationsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/billing/faturalar/[id]/page.tsx:28` | `InvoiceDetailPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/billing/kuponlar/page.tsx:18` | `CouponsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/billing/page.tsx:89` | `AdminBillingPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/billing/planlar/page.tsx:18` | `PlansAdminPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/admin/duyuru/page.tsx:40` | `BroadcastPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/geo/[provinceId]/[districtId]/page.tsx:23` | `AdminGeoDistrictPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/geo/[provinceId]/page.tsx:21` | `AdminGeoProvincePage` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/admin/geo/page.tsx:16` | `AdminGeoPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/admin/hatalar/errors-view.tsx:94` | `ErrorsView` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/members/[id]/page.tsx:74` | `AdminMemberDetailPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/members/page.tsx:78` | `AdminMembersPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/page.tsx:52` | `getAdminDashboardData` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/app/admin/raporlar/page.tsx:44` | `AdminReportsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/admin/satis/[id]/page.tsx:24` | `AdminLeadDetailPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/satis/page.tsx:50` | `AdminSalesPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/admin/sistem/system-view.tsx:75` | `SystemView` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/admin/tenants/[id]/page.tsx:96` | `AdminTenantDetailPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/tenants/page.tsx:67` | `AdminTenantsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/tickets/[id]/page.tsx:139` | `AdminTicketDetailPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/tickets/makrolar/page.tsx:10` | `MacrosPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/tickets/page.tsx:233` | `AdminTicketsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/tickets/yeni/page.tsx:11` | `NewAdminTicketPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/anket/[token]/page.tsx:39` | `SurveyPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/api/admin/notifications/route.ts:10` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/api/admin/personel/route.ts:27` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/api/admin/search/route.ts:27` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/api/admin/tenants/[id]/export/route.ts:17` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/api/ai/admin-chat/route.ts:45` | `persistTurn` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/api/cron/abonelik-kontrol/route.ts:14` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/anahtar-gecikme/route.ts:55` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/bolge-snapshot/route.ts:46` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/dogum-gunu/route.ts:23` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/dunning/route.ts:63` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/geo-sync/route.ts:46` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | yok | P2 |
| `src/app/api/cron/gorev-hatirlat/route.ts:15` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/gunluk-ozet/route.ts:21` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/haftalik-ozet/route.ts:51` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/kira-tahakkuk/route.ts:68` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/leak-sla/route.ts:37` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/lig-snapshot/route.ts:41` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/operational-retention/route.ts:22` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | yok | P2 |
| `src/app/api/cron/portal-teyit/route.ts:101` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/proje-vade/route.ts:32` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/randevu-hatirlat/route.ts:18` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/tcmb-kur/route.ts:28` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | uygulanamaz (yazma) | P2 |
| `src/app/api/cron/ticket-sla/route.ts:12` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | yok | P2 |
| `src/app/api/cron/vitrin-alarm/route.ts:24` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | devir | P2 |
| `src/app/api/cron/vitrin-eslesme/route.ts:76` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/customer-files/[id]/download/route.ts:58` | `GET` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/api/health/route.ts:80` | `GET` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/app/api/iyzico/callback/route.ts:60` | `handle` | Oturumsuz dış çağrı (webhook/ödeme geri dönüşü). | webhook-imza | var | P2 |
| `src/app/api/iyzico/webhook/route.ts:121` | `POST` | Oturumsuz dış çağrı (webhook/ödeme geri dönüşü). | webhook-imza | var | P2 |
| `src/app/api/property-media/[id]/download/route.ts:60` | `GET` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/api/property-media/[id]/route.ts:9` | `GET` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/api/takvim/[token]/route.ts:63` | `GET` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/api/ticket-attachments/[id]/route.ts:42` | `GET` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/api/ticket-attachments/finalize/route.ts:54` | `POST` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/api/ticket-attachments/route.ts:88` | `POST` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/api/vitrin-favoriler/route.ts:110` | `POST` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/app/ayarlar/guvenlik/actions.ts:28` | `setTwoFactorSms` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/app/ekip/invite-actions.ts:141` | `createAdvisor` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/app/ekip/invite-actions.ts:31` | `resendInvite` | auth.admin API'si (RLS ile yapılamaz). | oturum-izin | var | P2 |
| `src/app/app/ekip/page.tsx:93` | `TeamPage` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/danisman/[slug]/page.tsx:142` | `AgentCardPage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/danisman/[slug]/page.tsx:107` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/danisman/[slug]/page.tsx:80` | `loadAgent` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/danisman/[slug]/vcard/route.ts:49` | `GET` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/degerleme-raporu/[token]/page.tsx:60` | `PublicValuationReportPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/giris/_lib/login-events.ts:18` | `logLoginEvent` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/giris/dogrulama/actions.ts:265` | `cancelLoginVerification` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/app/giris/dogrulama/actions.ts:202` | `resendLoginCode` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/giris/dogrulama/actions.ts:57` | `verifyLoginCode` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/imza/[token]/page.tsx:32` | `PublicContractSignPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/lead/[token]/page.tsx:16` | `PublicLeadPage` | Oturumsuz token'lı public yüzey. | public-token | uygulanamaz | P2 |
| `src/app/malik-portali/[token]/page.tsx:98` | `MalikPortaliPage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/musteri-portali/[token]/page.tsx:96` | `CustomerPortalPage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/odeme-link/[token]/page.tsx:43` | `PublicPaymentLinkPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/paylas/[token]/page.tsx:64` | `generateMetadata` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/paylas/[token]/page.tsx:127` | `PublicSharePage` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/randevu-al/[token]/page.tsx:46` | `BookingPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/sunum/[token]/page.tsx:80` | `PublicPresentationPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/tavsiye/[token]/page.tsx:49` | `ReferralPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/vitrin/[slug]/[id]/opengraph-image.tsx:16` | `Image` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/[id]/page.tsx:100` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/[id]/page.tsx:162` | `VitrinPropertyPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/vitrin/[slug]/degerleme/page.tsx:22` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/vitrin/[slug]/degerleme/page.tsx:55` | `VitrinDegerlemePage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/favoriler/page.tsx:22` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/vitrin/[slug]/favoriler/page.tsx:37` | `VitrinFavorilerPage` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/vitrin/[slug]/opengraph-image.tsx:13` | `Image` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/page.tsx:63` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/page.tsx:107` | `VitrinPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/lib/activity.ts:17` | `writeActivity` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/admin-badges.ts:35` | `cachedBadges` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/admin/activity-query.ts:104` | `queryActivity` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/automation-engine.ts:503` | `dispatchAutomationEvent` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/automation-engine.ts:689` | `runScheduledAutomations` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/billing/coupon-server.ts:16` | `quoteCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/billing/coupon-server.ts:44` | `redeemCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/billing/fulfillment.ts:299` | `assertBillingPlanPreflight` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/billing/fulfillment.ts:221` | `createCheckoutInvoice` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/billing/fulfillment.ts:103` | `fulfillBillingPaymentAtomic` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/billing/fulfillment.ts:287` | `markCheckoutInvoiceFailed` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/billing/fulfillment.ts:263` | `markCheckoutInvoiceInitialized` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/billing/payment-link-fulfill.ts:20` | `fulfillPaymentLink` | Oturumsuz dış çağrı (webhook/ödeme geri dönüşü). | webhook-imza | var | P2 |
| `src/lib/billing/reconciliation.ts:60` | `reconcileCapture` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/lib/billing/reconciliation.ts:36` | `transitionCapture` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | yok | P2 |
| `src/lib/campaign-delivery.ts:519` | `runCampaignDeliveryWorker` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/cron-heartbeat.ts:16` | `recordHeartbeat` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | uygulanamaz (yazma) | P2 |
| `src/lib/definitions.ts:28` | `loadDefinitions` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/direct-file-upload-cleanup.ts:61` | `cleanupDirectFileUploads` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/direct-file-upload-cleanup.ts:35` | `metadataExists` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/direct-file-upload-server.ts:218` | `finalizeDirectFileUpload` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/direct-file-upload-server.ts:105` | `prepareDirectFileUpload` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/direct-file-upload-server.ts:168` | `updateOwnedLease` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | yok (yazma) | P2 |
| `src/lib/error-log.ts:83` | `logError` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/geo-province-sync.ts:93` | `failClaimedJob` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/geo-province-sync.ts:109` | `runGeoProvinceSyncWorker` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/geo.ts:43` | `getDistrictsCached` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/geo.ts:26` | `getProvincesCached` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/lead-intake.ts:100` | `intakeLead` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/lib/match-notify.ts:23` | `notifyMatchingDemandsForProperty` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/messaging/tenant-providers.ts:79` | `getActiveTenantIntegration` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/messaging/whatsapp-cloud.ts:112` | `existingTenantWhatsAppToken` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/messaging/whatsapp-cloud.ts:317` | `listApprovedTenantWhatsAppTemplates` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/notify.ts:61` | `notifyTenant` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/office-score.ts:55` | `loadOfficeScoreInputsForTenant` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/platform-activity.ts:18` | `logPlatformActivity` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/lib/platform-notify.ts:19` | `notifyPlatformStaff` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/lib/platform-settings.ts:6` | `getPlatformSetting` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/platform-settings.ts:24` | `getPlatformSettingsMany` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/platform-settings.ts:35` | `setPlatformSetting` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/lib/platform.ts:35` | `bootstrapPlatformStaffIfAllowed` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/lib/playbook-trigger.ts:28` | `triggerPlaybooks` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/public-mutation-outbox.ts:59` | `processPublicMutationOutbox` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/push.ts:33` | `sendPushToUser` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/rate-limit.ts:87` | `checkRateLimit` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/seo/sitemap-data.ts:47` | `loadAll` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/seo/store.ts:252` | `listNotFound` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/seo/store.ts:236` | `logNotFound` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/seo/store.ts:268` | `prune404` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/storage-deletion-outbox.ts:66` | `enqueueStorageDeletion` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/support/ticket-category-options.ts:18` | `loadTicketCategoryOptionsForTenant` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/team/member-admin.ts:36` | `authorizeMemberManagement` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/lib/team/member-admin.ts:66` | `loadMemberAccess` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/tenant-guard.ts:129` | `resolveActiveTenant` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/tenant-references.ts:62` | `validateTenantReferences` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/ticket-attachments-access.ts:152` | `authorizeStoredTicketAttachment` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/lib/ticket-attachments-access.ts:77` | `authorizeTicketAttachmentAccess` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/lib/ticket-attachments-cleanup.ts:26` | `cleanupTicketAttachmentUploads` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/webhooks/meta-inbound.ts:175` | `claimEvent` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | yok (yazma) | P2 |
| `src/lib/webhooks/meta-inbound.ts:264` | `ingestMetaDeliveryStatus` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/webhooks/meta-inbound.ts:374` | `ingestMetaInboundMessage` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/webhooks/meta-inbound.ts:159` | `markEvent` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/webhooks/netgsm-inbound.ts:56` | `claimEvent` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | yok (yazma) | P2 |
| `src/lib/webhooks/netgsm-inbound.ts:164` | `ingestNetgsmInbound` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/webhooks/netgsm-inbound.ts:32` | `markEvent` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/webhooks/netgsm-inbound.ts:128` | `quarantineNetgsmEvent` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
