# createAdminClient Envanteri

> ÜRETİLMİŞ DOSYA — elle düzenleme. Yeniden üret: `npx tsx scripts/audit-admin-client.ts --write`.
> Yöntem: statik, heuristik (TS AST + regex). Kanıt düzeyi: "var" = kaynakta `tenant_id` geçiyor, filtrenin
> doğruluğu DOĞRULANMADI. "belirsiz" = işlev ve dosyada tanınan kapı yok; çağıranlar elle incelenmeli.
> Kapsam: `src/**` (test ve `scripts/` hariç). Canlı DB'ye bağlanılmadı.

## Özet

- Toplam birim: **426** (220 dosya) — risk: P0=12, P1=39, P2=375
- Tenant filtresi: var=250, uygulanamaz=93, yok=60, param=15, devir=8
- Kapı türü: public-token=35, dosya-duzeyi=94, platform=81, oturum-izin=78, belirsiz=98, elle-dogrulandi=13, cron=24, webhook-imza=3
- Filtresiz (yok+devir): **68**; RLS'li client'a taşıma adayı: **65**

Risk ölçütü: P0 = tenant filtresi yok/devir VE kapı belirsiz; P1 = filtresiz ama kapı zayıf/oturum-izin
(kiracı kimliği istemciden gelirse IDOR), veya yalnız parametre filtreli + zayıf kapı + yazma; P2 = diğerleri.
Not: cron/platform birimlerinin "filtresiz" olması tasarım gereğidir (kiracılar arası iş); P2 sayılır.

## P0 — filtresiz VE kapısı belirsiz (ÖNCE bunlar elle incelenmeli)

| Dosya:satır | İşlev | Neden admin | Kapı türü | Tenant filtresi | Risk |
|---|---|---|---|---|---|
| `src/app/admin/_dashboards/support-home.tsx:41` | `SupportHome` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/billing/plan-support.ts:85` | `getFoundersStatus` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/billing/plan-support.ts:31` | `getPlanSupport` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/ef-credits/credit-reader.ts:33` | `cachedReady` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/ef-credits/wallet.ts:42` | `efCreditReady` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/geo/admin-store.ts:424` | `getChangeRequest` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/geo/admin-store.ts:352` | `getGeoHealth` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/geo/admin-store.ts:216` | `setActive` | Gerekçe doğrulanmadı. | belirsiz | yok (yazma) | P0 |
| `src/lib/geo/admin-store.ts:252` | `undoMerge` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/geo/admin-store.ts:119` | `usageTotals` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/growth/store.ts:208` | `countClickSafe` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/growth/store.ts:221` | `isActivePartnerCode` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |

## P1

| Dosya:satır | İşlev | Neden admin | Kapı türü | Tenant filtresi | Risk |
|---|---|---|---|---|---|
| `src/app/actions/admin-ticket-ops.ts:105` | `updateAdminField` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/actions/agent-profile.ts:206` | `removeAgentPhoto` | Gerekçe doğrulanmadı. | dosya-duzeyi | param (yazma) | P1 |
| `src/app/actions/agent-profile.ts:105` | `saveAgentProfile` | Gerekçe doğrulanmadı. | dosya-duzeyi | param (yazma) | P1 |
| `src/app/actions/agent-profile.ts:176` | `uploadAgentPhoto` | Gerekçe doğrulanmadı. | dosya-duzeyi | param (yazma) | P1 |
| `src/app/actions/appointments-confirm.ts:34` | `respondToAppointmentByToken` | Oturumsuz token'lı public yüzey. | public-token | yok | P1 |
| `src/app/actions/appointments.ts:227` | `regenerateCalendarToken` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | yok (yazma) | P1 |
| `src/app/actions/contracts.ts:540` | `verifySignatureOtp` | Oturumsuz token'lı public yüzey. | public-token | yok (yazma) | P1 |
| `src/app/actions/geo-admin.ts:119` | `enqueueProvinceGeoSync` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/actions/growth.ts:190` | `createPartner` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok (yazma) | P1 |
| `src/app/actions/growth.ts:217` | `setPartnerStatus` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok (yazma) | P1 |
| `src/app/actions/owner-portal-offers.ts:37` | `respondToOfferByToken` | Oturumsuz token'lı public yüzey. | public-token | yok | P1 |
| `src/app/actions/platform-staff.ts:355` | `resetStaffPassword` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/actions/platform-staff.ts:391` | `signOutStaffSessions` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/admin/_dashboards/billing-home.tsx:48` | `BillingHome` | Gerekçe doğrulanmadı. | belirsiz | param | P1 |
| `src/app/admin/sistem/schema-checks.ts:56` | `probeSchema` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/api/property-media/[id]/private/route.ts:55` | `GET` | Oturumsuz token'lı public yüzey. | public-token | yok | P1 |
| `src/app/app/sozlesmeler/[id]/page.tsx:90` | `ContractDetailPage` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | yok | P1 |
| `src/app/randevu-teyit/[token]/page.tsx:49` | `AppointmentConfirmPage` | Oturumsuz token'lı public yüzey. | public-token | yok | P1 |
| `src/lib/admin/activity-query.ts:186` | `resolveActorNames` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/ai-advisor.ts:47` | `buildAdvisorContext` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/billing/fulfillment.ts:73` | `transitionCapture` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/billing/reconciliation.ts:202` | `runBillingReconciliation` | Gerekçe doğrulanmadı. | dosya-duzeyi | param (yazma) | P1 |
| `src/lib/ef-credits/credit-reader.ts:81` | `readEfBalance` | Gerekçe doğrulanmadı. | belirsiz | param | P1 |
| `src/lib/ef-credits/wallet.ts:51` | `efBalance` | Gerekçe doğrulanmadı. | belirsiz | param | P1 |
| `src/lib/ef-credits/wallet.ts:81` | `efCommit` | Gerekçe doğrulanmadı. | belirsiz | param | P1 |
| `src/lib/ef-credits/wallet.ts:93` | `efRelease` | Gerekçe doğrulanmadı. | belirsiz | param | P1 |
| `src/lib/ef-credits/wallet.ts:63` | `efReserve` | Gerekçe doğrulanmadı. | belirsiz | param | P1 |
| `src/lib/geo/admin-store.ts:344` | `countOf` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/geo/admin-store.ts:167` | `createEntity` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok (yazma) | P1 |
| `src/lib/geo/admin-store.ts:73` | `getAdminRow` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/geo/admin-store.ts:57` | `listAdminRows` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/geo/admin-store.ts:240` | `mergeEntity` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/geo/admin-store.ts:229` | `moveEntity` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/geo/admin-store.ts:414` | `resolveChangeRequest` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok (yazma) | P1 |
| `src/lib/geo/admin-store.ts:191` | `updateEntity` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok (yazma) | P1 |
| `src/lib/geo/admin-store.ts:110` | `usageBreakdown` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/geo/admin-store.ts:130` | `usageRows` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/geo/reader.ts:272` | `geoRowCount` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/storage-deletion-outbox.ts:160` | `processStorageDeletionOutbox` | Gerekçe doğrulanmadı. | dosya-duzeyi | devir (yazma) | P1 |

## P2

| Dosya:satır | İşlev | Neden admin | Kapı türü | Tenant filtresi | Risk |
|---|---|---|---|---|---|
| `src/app/acik-ev-kayit/[token]/page.tsx:51` | `OpenHouseCheckinPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/account.ts:48` | `updateMyProfile` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/admin-account-credit.ts:47` | `grantAccountCredit` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/admin-account-credit.ts:94` | `reverseAccountCredit` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/admin-ticket-extra.ts:18` | `searchTicketTenants` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/admin-ticket-extra.ts:43` | `updateTicketMacro` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/admin-ticket-ops.ts:195` | `bulkUpdateTickets` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/actions/admin-ticket-ops.ts:222` | `createTicketMacro` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/admin-ticket-ops.ts:237` | `deleteTicketMacro` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/ai-advisor.ts:62` | `askAdvisor` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/ai-advisor.ts:177` | `deleteAdvisorSession` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/ai-advisor.ts:118` | `listAdvisorSessions` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/ai-advisor.ts:150` | `loadAdvisorSession` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/appointments-suggest.ts:46` | `suggestAlternativeTimesByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/auth.ts:106` | `signIn` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/auth.ts:487` | `signOut` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/app/actions/auth.ts:377` | `signUp` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | param (yazma) | P2 |
| `src/app/actions/booking-public.ts:64` | `createPublicBooking` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/bulk-property.ts:69` | `bulkUpdatePropertyStatus` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/campaigns.ts:83` | `createCampaign` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/campaigns.ts:185` | `sendCampaign` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/compliance.ts:26` | `upsertIysConsent` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/contract-signers.ts:88` | `resendSignerSms` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/contract-signers.ts:41` | `updateContractSigner` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/contracts.ts:643` | `cancelContract` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/contracts.ts:443` | `requestSignatureOtp` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/contracts.ts:255` | `sendContractForSigning` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/contracts.ts:320` | `signContractByToken` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/contracts.ts:141` | `updateContractDraftAtomic` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/app/actions/customer-portal-feedback.ts:46` | `submitMatchFeedbackByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/customer-portal.ts:172` | `getCustomerPortalData` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/customers.ts:937` | `mergeCustomers` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/deals.ts:166` | `updateDealStage` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/demo-login.ts:96` | `ensureDemoTenant` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/demo-login.ts:145` | `ensurePersona` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/document-request-public.ts:227` | `completeDocRequest` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/document-request-public.ts:152` | `finalizeDocRequestUpload` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/document-request-public.ts:77` | `prepareDocRequestUpload` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/document-requests.ts:166` | `getDocumentRequestFileUrl` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | param | P2 |
| `src/app/actions/document-requests.ts:200` | `suggestDocumentFields` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | param | P2 |
| `src/app/actions/error-logs.ts:54` | `reopenErrorLog` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok (yazma) | P2 |
| `src/app/actions/error-logs.ts:31` | `resolveErrorLog` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok (yazma) | P2 |
| `src/app/actions/error-logs.ts:75` | `resolveErrorLogs` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok (yazma) | P2 |
| `src/app/actions/growth.ts:129` | `createRewardRule` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/growth.ts:166` | `setRewardRuleActive` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
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
| `src/app/actions/owner-portal.ts:153` | `getOwnerPortalData` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/payment-link-manage.ts:69` | `cancelPaymentLink` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/payment-link-manage.ts:126` | `extendPaymentLink` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/payment-links.ts:84` | `createPaymentLink` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/payment-links.ts:123` | `startPaymentLinkCheckout` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/platform-account.ts:38` | `updateOwnProfile` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-billing-plans.ts:73` | `syncEntitlements` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-billing.ts:71` | `markInvoicePaid` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/platform-billing.ts:177` | `recordInvoiceRefund` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/platform-billing.ts:348` | `resolveCapture` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/app/actions/platform-billing.ts:133` | `voidInvoice` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/platform-coupons.ts:38` | `createCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-coupons.ts:120` | `deleteCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-coupons.ts:106` | `setCouponActive` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-coupons.ts:70` | `updateCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-export.ts:69` | `exportDemoRequestsCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/actions/platform-export.ts:113` | `exportInvoicesCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/actions/platform-export.ts:135` | `exportMembersCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/actions/platform-export.ts:179` | `exportPlatformReportCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/platform-export.ts:44` | `exportSubscriptionsCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/actions/platform-export.ts:25` | `exportTenantsCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-export.ts:155` | `exportTicketsCsv` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
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
| `src/app/actions/platform-sales.ts:188` | `convertDemoToTenant` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/platform-sales.ts:312` | `resendConvertedOwnerAccessLink` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/platform-staff.ts:39` | `addPlatformStaff` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-staff.ts:188` | `deactivateStaff` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-staff.ts:318` | `generateStaffResetLink` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/app/actions/platform-staff.ts:232` | `reactivateStaff` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-staff.ts:274` | `updateStaffProfile` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-staff.ts:136` | `updateStaffRole` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-tenant-closure.ts:45` | `processOfficeClosureRequestByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:1162` | `addTenantPlatformNote` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:992` | `addTenantUserByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:788` | `changeTenantOwnerEmailByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-tenants.ts:560` | `changeTenantSlugByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:196` | `checkOfficeSlugAvailability` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-tenants.ts:250` | `createTenantByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:616` | `extendTenantTrialByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:753` | `resendTenantOwnerAccessLink` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-tenants.ts:700` | `setTenantLifecycleByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-tenants.ts:1068` | `setTenantUserActiveByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:869` | `transferTenantOwnershipByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:490` | `updateTenantProfileByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform.ts:90` | `startImpersonation` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform.ts:232` | `stopImpersonation` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/platform.ts:37` | `updateTenantPlanStatus` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/portal-listings.ts:229` | `closePortalListing` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/portal-listings.ts:147` | `confirmPortalListing` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/portal-listings.ts:179` | `confirmPortalListingsBulk` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/portal-listings.ts:19` | `createPortalListing` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/portal-publish.ts:201` | `publishPropertyToPortal` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/portal-publish.ts:314` | `unpublishPropertyFromPortal` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/portal-publish.ts:262` | `updatePropertyOnPortal` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/projects.ts:544` | `sellUnit` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/properties.ts:128` | `notifyPriceDropToMatchingDemands` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/app/actions/properties.ts:721` | `setPropertyStatus` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/property-media.ts:536` | `ocrPropertyMediaDocument` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/public-valuation.ts:97` | `estimatePublicValuation` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/actions/public-valuation.ts:201` | `submitValuationLead` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/referral-public.ts:55` | `submitReferralByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/rentals.ts:434` | `applyRentIncrease` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/rentals.ts:58` | `createRental` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/rentals.ts:114` | `endRental` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/rentals.ts:232` | `extendRental` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/rentals.ts:279` | `markDepositReturned` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/rentals.ts:176` | `updateRental` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/sample-data.ts:148` | `clearSampleData` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | uygulanamaz | P2 |
| `src/app/actions/sample-data.ts:93` | `seedSampleData` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | param (yazma) | P2 |
| `src/app/actions/subscription-cancel.ts:37` | `requestSubscriptionCancel` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/subscription-cancel.ts:86` | `undoSubscriptionCancel` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/survey-public.ts:57` | `submitSurveyByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/survey-public.ts:179` | `submitSurveyTaskByToken` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/team-member-admin.ts:105` | `sendAccessMail` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/app/actions/team-member-admin.ts:56` | `updateMemberProfile` | auth.admin API'si (RLS ile yapılamaz). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/team.ts:67` | `createTeamMember` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | var | P2 |
| `src/app/actions/team.ts:102` | `updateTeamMember` | auth.admin API'si (RLS ile yapılamaz). | oturum-izin | var (yazma) | P2 |
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
| `src/app/actions/vitrin-alerts.ts:58` | `createVitrinPriceAlert` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/vitrin.ts:71` | `createVitrinSavedSearch` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/vitrin.ts:155` | `likePublicShare` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/workflow.ts:69` | `convertWorkflow` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/admin/aktivite/page.tsx:172` | `AdminActivityPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/bildirimler/page.tsx:57` | `AdminNotificationsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/billing/faturalar/[id]/page.tsx:28` | `InvoiceDetailPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/billing/kuponlar/page.tsx:19` | `CouponsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/billing/page.tsx:87` | `AdminBillingPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/billing/planlar/page.tsx:50` | `PlansAdminPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | devir | P2 |
| `src/app/admin/duyuru/page.tsx:41` | `BroadcastPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/geo/[provinceId]/page.tsx:34` | `AdminGeoProvincePage` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/admin/geo/bildirimler/page.tsx:29` | `AdminGeoRequestsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/geo/page.tsx:20` | `AdminGeoPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/admin/hatalar/errors-view.tsx:96` | `ErrorsView` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/members/[id]/page.tsx:67` | `AdminMemberDetailPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/members/page.tsx:60` | `AdminMembersPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/muhasebe/defter/page.tsx:44` | `FaturaDefteriPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | devir | P2 |
| `src/app/admin/muhasebe/disa-aktar/route.ts:38` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | devir | P2 |
| `src/app/admin/muhasebe/page.tsx:48` | `MuhasebePage` | Platform personeli: kiracılar arası yönetim paneli. | platform | devir | P2 |
| `src/app/admin/page.tsx:94` | `getAdminDashboardData` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/app/admin/raporlar/page.tsx:41` | `AdminReportsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/admin/sistem/system-view.tsx:81` | `SystemView` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/admin/tenants/[id]/page.tsx:101` | `AdminTenantDetailPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/tenants/page.tsx:85` | `AdminTenantsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/tickets/[id]/page.tsx:141` | `AdminTicketDetailPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/tickets/makrolar/page.tsx:10` | `MacrosPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/tickets/page.tsx:235` | `AdminTicketsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/tickets/yeni/page.tsx:11` | `NewAdminTicketPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/anket/[token]/page.tsx:45` | `SurveyPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/api/admin/notifications/route.ts:10` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/api/admin/personel/route.ts:27` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/api/admin/search/route.ts:30` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/api/admin/tenants/[id]/export/route.ts:17` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/api/ai/admin-chat/route.ts:45` | `persistTurn` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/api/cron/abonelik-kontrol/route.ts:24` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/anahtar-gecikme/route.ts:54` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/anket-gorevleri/route.ts:50` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/bolge-snapshot/route.ts:47` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/dogum-gunu/route.ts:20` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/dunning/route.ts:63` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/ef-kontor-hak/route.ts:67` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/geo-sync/route.ts:45` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | yok | P2 |
| `src/app/api/cron/gorev-hatirlat/route.ts:20` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/gunluk-ozet/route.ts:19` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/haftalik-ozet/route.ts:53` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/havuz-atama/route.ts:24` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | devir | P2 |
| `src/app/api/cron/kira-tahakkuk/route.ts:73` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/leak-sla/route.ts:68` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/lig-snapshot/route.ts:42` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/operational-retention/route.ts:19` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | devir | P2 |
| `src/app/api/cron/portal-teyit/route.ts:121` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/proje-vade/route.ts:31` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/randevu-hatirlat/route.ts:30` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/tcmb-kur/route.ts:27` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | uygulanamaz (yazma) | P2 |
| `src/app/api/cron/ticket-sla/route.ts:14` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | yok | P2 |
| `src/app/api/cron/vitrin-alarm/route.ts:24` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | devir | P2 |
| `src/app/api/cron/vitrin-eslesme/route.ts:76` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/customer-files/[id]/download/route.ts:58` | `GET` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/api/health/route.ts:93` | `GET` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/app/api/iyzico/callback/route.ts:63` | `handle` | Oturumsuz dış çağrı (webhook/ödeme geri dönüşü). | webhook-imza | var | P2 |
| `src/app/api/iyzico/webhook/route.ts:89` | `POST` | Oturumsuz dış çağrı (webhook/ödeme geri dönüşü). | webhook-imza | var (yazma) | P2 |
| `src/app/api/property-media/[id]/download/route.ts:60` | `GET` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/api/property-media/[id]/route.ts:10` | `GET` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/api/takvim/[token]/route.ts:59` | `GET` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/api/ticket-attachments/[id]/route.ts:42` | `GET` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/api/ticket-attachments/finalize/route.ts:54` | `POST` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/api/ticket-attachments/route.ts:88` | `POST` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/api/vitrin-favoriler/route.ts:117` | `POST` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/app/ayarlar/guvenlik/actions.ts:28` | `setTwoFactorSms` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/app/ekip/invite-actions.ts:141` | `createAdvisor` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/app/ekip/invite-actions.ts:31` | `resendInvite` | auth.admin API'si (RLS ile yapılamaz). | oturum-izin | var | P2 |
| `src/app/app/ekip/page.tsx:94` | `TeamPage` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/danisman/[slug]/page.tsx:150` | `AgentCardPage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/danisman/[slug]/page.tsx:115` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/danisman/[slug]/page.tsx:88` | `loadAgent` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/danisman/[slug]/vcard/route.ts:49` | `GET` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/degerleme-raporu/[token]/page.tsx:62` | `PublicValuationReportPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/evrak/[token]/page.tsx:65` | `EvrakPage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/giris/_lib/login-events.ts:18` | `logLoginEvent` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/giris/dogrulama/actions.ts:265` | `cancelLoginVerification` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/app/giris/dogrulama/actions.ts:202` | `resendLoginCode` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/giris/dogrulama/actions.ts:57` | `verifyLoginCode` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/imza/[token]/page.tsx:32` | `PublicContractSignPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/lead/[token]/page.tsx:18` | `PublicLeadPage` | Oturumsuz token'lı public yüzey. | public-token | uygulanamaz | P2 |
| `src/app/malik-portali/[token]/page.tsx:108` | `MalikPortaliPage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/musteri-portali/[token]/page.tsx:117` | `CustomerPortalPage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/odeme-link/[token]/page.tsx:43` | `PublicPaymentLinkPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/paylas/[token]/page.tsx:78` | `generateMetadata` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/paylas/[token]/page.tsx:141` | `PublicSharePage` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/randevu-al/[token]/page.tsx:48` | `BookingPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/sunum/[token]/page.tsx:82` | `PublicPresentationPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/tavsiye/[token]/page.tsx:49` | `ReferralPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/vitrin/[slug]/[id]/opengraph-image.tsx:17` | `Image` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/[id]/page.tsx:126` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/[id]/page.tsx:193` | `VitrinPropertyPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/vitrin/[slug]/degerleme/page.tsx:26` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/vitrin/[slug]/degerleme/page.tsx:60` | `VitrinDegerlemePage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/favoriler/page.tsx:25` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/vitrin/[slug]/favoriler/page.tsx:41` | `VitrinFavorilerPage` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/vitrin/[slug]/opengraph-image.tsx:14` | `Image` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/page.tsx:76` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/page.tsx:125` | `VitrinPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/lib/activity.ts:17` | `writeActivity` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/admin-badges.ts:37` | `cachedBadges` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/admin/activity-query.ts:104` | `queryActivity` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/ai/credits/meter.ts:113` | `charge` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/ai/credits/meter.ts:71` | `getTenantQuotas` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/ai/credits/usage.ts:114` | `getPlatformUsage` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/ai/credits/usage.ts:59` | `getTenantUsage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/automation-engine.ts:518` | `dispatchAutomationEvent` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/automation-engine.ts:745` | `runScheduledAutomations` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/billing/coupon-server.ts:16` | `quoteCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/billing/coupon-server.ts:44` | `redeemCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/billing/credit-pack-purchase.ts:28` | `createCreditPackInvoice` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/billing/fulfillment.ts:418` | `assertBillingPlanPreflight` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/billing/fulfillment.ts:313` | `createCheckoutInvoice` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/billing/fulfillment.ts:112` | `fulfillBillingPaymentAtomic` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/billing/fulfillment.ts:403` | `markCheckoutInvoiceFailed` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/billing/fulfillment.ts:379` | `markCheckoutInvoiceInitialized` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/billing/payment-link-fulfill.ts:22` | `fulfillPaymentLink` | Oturumsuz dış çağrı (webhook/ödeme geri dönüşü). | webhook-imza | var | P2 |
| `src/lib/billing/reconciliation.ts:69` | `reconcileCapture` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/lib/billing/reconciliation.ts:45` | `transitionCapture` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | yok | P2 |
| `src/lib/billing/seat-purchase.ts:53` | `cachedSeatSupport` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/billing/seat-purchase.ts:197` | `createSeatInvoice` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/campaign-delivery.ts:524` | `runCampaignDeliveryWorker` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/cron-heartbeat.ts:16` | `recordHeartbeat` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | uygulanamaz (yazma) | P2 |
| `src/lib/definitions.ts:28` | `loadDefinitions` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/direct-file-upload-cleanup.ts:61` | `cleanupDirectFileUploads` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/direct-file-upload-cleanup.ts:35` | `metadataExists` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/direct-file-upload-server.ts:218` | `finalizeDirectFileUpload` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/direct-file-upload-server.ts:105` | `prepareDirectFileUpload` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/direct-file-upload-server.ts:168` | `updateOwnedLease` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | yok (yazma) | P2 |
| `src/lib/doc-request/server.ts:53` | `lookupPublicRequest` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/ef-credits/admin-data.ts:106` | `grantEfCredit` | Gerekçe doğrulanmadı. | dosya-duzeyi | param | P2 |
| `src/lib/ef-credits/admin-data.ts:32` | `listTenantEfBalances` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/ef-credits/admin-data.ts:89` | `readTenantName` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/ef-credits/credit-reader.ts:97` | `readEfHistory` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/ef-credits/wallet.ts:155` | `getEfReport` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/ef-credits/wallet.ts:127` | `insertEfReport` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/ef-credits/wallet.ts:171` | `listEfReports` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/ef-credits/wallet.ts:189` | `markEfPdfCharged` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/error-log.ts:83` | `logError` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/geo-province-sync.ts:94` | `failClaimedJob` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/geo-province-sync.ts:110` | `runGeoProvinceSyncWorker` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/geo/admin-store.ts:268` | `addAlias` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/lib/geo/admin-store.ts:159` | `addAliasInternal` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/lib/geo/admin-store.ts:323` | `applyPlan` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/geo/admin-store.ts:261` | `listAliases` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/geo/admin-store.ts:393` | `listChangeRequests` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/geo/admin-store.ts:289` | `listVersions` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/geo/admin-store.ts:319` | `loadExisting` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/geo/admin-store.ts:275` | `removeAlias` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/lib/geo/admin-store.ts:309` | `rollbackVersion` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/geo/admin-store.ts:327` | `versionsAvailable` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/geo/backfill.ts:34` | `applyTenantGeoMatches` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/lib/geo/backfill.ts:17` | `listTenantGeoCandidates` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/geo/reader.ts:241` | `getGeoTotals` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/geo/reader.ts:152` | `getNeighborhood` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/geo/reader.ts:250` | `getNeighborhoodsByIds` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/geo/reader.ts:57` | `loadDistricts` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/geo/reader.ts:81` | `loadNeighborhoodsOf` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/geo/reader.ts:41` | `loadProvinces` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/geo/resolve.ts:18` | `loadAliases` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/growth/store.ts:75` | `activeRule` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/growth/store.ts:134` | `ensureReferralCode` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/growth/store.ts:343` | `getAdminGrowthOverview` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/growth/store.ts:110` | `getReferralOverview` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/growth/store.ts:158` | `recordSignupAttributionSafe` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/lead-intake.ts:100` | `intakeLead` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/lib/match-notify.ts:23` | `notifyMatchingDemandsForProperty` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/messaging/tenant-providers.ts:79` | `getActiveTenantIntegration` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/messaging/whatsapp-cloud.ts:112` | `existingTenantWhatsAppToken` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/messaging/whatsapp-cloud.ts:317` | `listApprovedTenantWhatsAppTemplates` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/notify.ts:88` | `notifyTenant` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/office-score.ts:57` | `loadOfficeScoreInputsForTenant` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/platform-activity.ts:18` | `logPlatformActivity` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/lib/platform-notify.ts:19` | `notifyPlatformStaff` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/lib/platform-settings.ts:6` | `getPlatformSetting` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/platform-settings.ts:24` | `getPlatformSettingsMany` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/platform-settings.ts:58` | `setPlatformSetting` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/platform.ts:35` | `bootstrapPlatformStaffIfAllowed` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/lib/playbook-trigger.ts:28` | `triggerPlaybooks` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/pool/system-assign.ts:20` | `assignPoolEntryAsSystem` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/public-mutation-outbox.ts:59` | `processPublicMutationOutbox` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/push.ts:33` | `sendPushToUser` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/rate-limit.ts:87` | `checkRateLimit` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/seo/sitemap-data.ts:49` | `loadAll` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/seo/store.ts:252` | `listNotFound` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/seo/store.ts:236` | `logNotFound` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/seo/store.ts:268` | `prune404` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/storage-deletion-outbox.ts:66` | `enqueueStorageDeletion` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/support/ticket-category-options.ts:18` | `loadTicketCategoryOptionsForTenant` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/team/member-admin.ts:36` | `authorizeMemberManagement` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/lib/team/member-admin.ts:66` | `loadMemberAccess` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/tenant-guard.ts:136` | `resolveActiveTenant` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
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
