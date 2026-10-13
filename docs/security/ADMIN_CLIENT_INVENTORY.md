# createAdminClient Envanteri

> ÜRETİLMİŞ DOSYA — elle düzenleme. Yeniden üret: `npx tsx scripts/audit-admin-client.ts --write`.
> Yöntem: statik, heuristik (TS AST + regex). Kanıt düzeyi: "var" = kaynakta `tenant_id` geçiyor, filtrenin
> doğruluğu DOĞRULANMADI. "belirsiz" = işlev ve dosyada tanınan kapı yok; çağıranlar elle incelenmeli.
> Kapsam: `src/**` (test ve `scripts/` hariç). Canlı DB'ye bağlanılmadı.

## Özet

- Toplam birim: **467** (250 dosya) — risk: P0=12, P1=39, P2=416
- Tenant filtresi: var=260, uygulanamaz=127, yok=55, param=17, devir=8
- Kapı türü: public-token=35, dosya-duzeyi=115, platform=84, belirsiz=109, elle-dogrulandi=18, oturum-izin=79, cron=24, webhook-imza=3
- Filtresiz (yok+devir): **63**; RLS'li client'a taşıma adayı: **64**

Risk ölçütü: P0 = tenant filtresi yok/devir VE kapı belirsiz; P1 = filtresiz ama kapı zayıf/oturum-izin
(kiracı kimliği istemciden gelirse IDOR), veya yalnız parametre filtreli + zayıf kapı + yazma; P2 = diğerleri.
Not: cron/platform birimlerinin "filtresiz" olması tasarım gereğidir (kiracılar arası iş); P2 sayılır.

## P0 — filtresiz VE kapısı belirsiz (ÖNCE bunlar elle incelenmeli)

| Dosya:satır | İşlev | Neden admin | Kapı türü | Tenant filtresi | Risk |
|---|---|---|---|---|---|
| `src/app/admin/_dashboards/support-home.tsx:42` | `SupportHome` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/billing/plan-support.ts:93` | `getFoundersStatus` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/billing/plan-support.ts:35` | `getPlanSupport` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/ef-credits/credit-reader.ts:35` | `cachedReady` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/ef-credits/wallet.ts:42` | `efCreditReady` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/geo/admin-store.ts:425` | `getChangeRequest` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/geo/admin-store.ts:352` | `getGeoHealth` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/geo/admin-store.ts:216` | `setActive` | Gerekçe doğrulanmadı. | belirsiz | yok (yazma) | P0 |
| `src/lib/geo/admin-store.ts:252` | `undoMerge` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/geo/admin-store.ts:119` | `usageTotals` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/growth/store.ts:212` | `countClickSafe` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |
| `src/lib/growth/store.ts:225` | `isActivePartnerCode` | Gerekçe doğrulanmadı. | belirsiz | yok | P0 |

## P1

| Dosya:satır | İşlev | Neden admin | Kapı türü | Tenant filtresi | Risk |
|---|---|---|---|---|---|
| `src/app/actions/admin-ticket-ops.ts:106` | `updateAdminField` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/actions/agent-profile.ts:107` | `saveAgentProfile` | Gerekçe doğrulanmadı. | dosya-duzeyi | param (yazma) | P1 |
| `src/app/actions/agent-profile.ts:178` | `uploadAgentPhoto` | Gerekçe doğrulanmadı. | dosya-duzeyi | param (yazma) | P1 |
| `src/app/actions/appointments-confirm.ts:35` | `respondToAppointmentByToken` | Oturumsuz token'lı public yüzey. | public-token | yok | P1 |
| `src/app/actions/contracts.ts:541` | `verifySignatureOtp` | Oturumsuz token'lı public yüzey. | public-token | yok (yazma) | P1 |
| `src/app/actions/geo-admin.ts:119` | `enqueueProvinceGeoSync` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/actions/growth.ts:191` | `createPartner` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok (yazma) | P1 |
| `src/app/actions/growth.ts:218` | `setPartnerStatus` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok (yazma) | P1 |
| `src/app/actions/owner-portal-offers.ts:38` | `respondToOfferByToken` | Oturumsuz token'lı public yüzey. | public-token | yok | P1 |
| `src/app/actions/platform-ops.ts:228` | `triageErrorLog` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok (yazma) | P1 |
| `src/app/actions/platform-staff.ts:356` | `resetStaffPassword` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/actions/platform-staff.ts:392` | `signOutStaffSessions` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/admin/_dashboards/billing-home.tsx:50` | `BillingHome` | Gerekçe doğrulanmadı. | belirsiz | param | P1 |
| `src/app/admin/page.tsx:238` | `countExpiredActive` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/admin/sistem/schema-checks.ts:63` | `probeSchema` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/app/api/property-media/[id]/private/route.ts:55` | `GET` | Oturumsuz token'lı public yüzey. | public-token | yok | P1 |
| `src/app/randevu-teyit/[token]/page.tsx:49` | `AppointmentConfirmPage` | Oturumsuz token'lı public yüzey. | public-token | yok | P1 |
| `src/lib/admin/activity-query.ts:186` | `resolveActorNames` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/ai-advisor.ts:49` | `buildAdvisorContext` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/alerts/engine.ts:137` | `runAlertEvaluation` | Gerekçe doğrulanmadı. | dosya-duzeyi | devir (yazma) | P1 |
| `src/lib/billing/fulfillment.ts:74` | `transitionCapture` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/billing/reconciliation.ts:204` | `runBillingReconciliation` | Gerekçe doğrulanmadı. | dosya-duzeyi | param (yazma) | P1 |
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
| `src/lib/geo/admin-store.ts:415` | `resolveChangeRequest` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok (yazma) | P1 |
| `src/lib/geo/admin-store.ts:191` | `updateEntity` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok (yazma) | P1 |
| `src/lib/geo/admin-store.ts:110` | `usageBreakdown` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/geo/admin-store.ts:130` | `usageRows` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/geo/reader.ts:272` | `geoRowCount` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |
| `src/lib/storage-deletion-outbox.ts:176` | `processStorageDeletionOutbox` | Gerekçe doğrulanmadı. | dosya-duzeyi | devir (yazma) | P1 |
| `src/lib/storage-deletion-outbox.ts:255` | `storageDeletionQueueStats` | Gerekçe doğrulanmadı. | dosya-duzeyi | yok | P1 |

## P2

| Dosya:satır | İşlev | Neden admin | Kapı türü | Tenant filtresi | Risk |
|---|---|---|---|---|---|
| `src/app/acik-ev-kayit/[token]/page.tsx:51` | `OpenHouseCheckinPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/account.ts:49` | `updateMyProfile` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/admin-account-credit.ts:47` | `grantAccountCredit` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/admin-account-credit.ts:94` | `reverseAccountCredit` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/admin-ticket-extra.ts:19` | `searchTicketTenants` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/admin-ticket-extra.ts:44` | `updateTicketMacro` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/admin-ticket-ops.ts:196` | `bulkUpdateTickets` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/actions/admin-ticket-ops.ts:223` | `createTicketMacro` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/admin-ticket-ops.ts:238` | `deleteTicketMacro` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/ai-advisor.ts:62` | `askAdvisor` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/ai-advisor.ts:177` | `deleteAdvisorSession` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/ai-advisor.ts:118` | `listAdvisorSessions` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/ai-advisor.ts:150` | `loadAdvisorSession` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/appointments-suggest.ts:47` | `suggestAlternativeTimesByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/auth.ts:85` | `signIn` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/auth.ts:516` | `signOut` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/app/actions/auth.ts:400` | `signUp` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | var (yazma) | P2 |
| `src/app/actions/booking-public.ts:65` | `createPublicBooking` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/bulk-property.ts:70` | `bulkUpdatePropertyStatus` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/campaigns.ts:140` | `createCampaign` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/campaigns.ts:242` | `sendCampaign` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/compliance.ts:27` | `upsertIysConsent` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/contract-signers.ts:89` | `resendSignerSms` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/contract-signers.ts:42` | `updateContractSigner` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/contracts.ts:644` | `cancelContract` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/contracts.ts:444` | `requestSignatureOtp` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/contracts.ts:256` | `sendContractForSigning` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/contracts.ts:321` | `signContractByToken` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/contracts.ts:142` | `updateContractDraftAtomic` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/app/actions/customer-portal-feedback.ts:47` | `submitMatchFeedbackByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/customer-portal.ts:183` | `getCustomerPortalData` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/customers.ts:944` | `mergeCustomers` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/deals.ts:189` | `updateDealStageWithGate` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/demo-login.ts:121` | `ensureDemoTenant` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/demo-login.ts:174` | `ensurePersona` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/demo-login.ts:113` | `resetDemoPassword` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/actions/document-request-public.ts:228` | `completeDocRequest` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/document-request-public.ts:153` | `finalizeDocRequestUpload` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/document-request-public.ts:78` | `prepareDocRequestUpload` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/document-requests.ts:167` | `getDocumentRequestFileUrl` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | param | P2 |
| `src/app/actions/document-requests.ts:201` | `suggestDocumentFields` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | param | P2 |
| `src/app/actions/error-logs.ts:55` | `reopenErrorLog` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok (yazma) | P2 |
| `src/app/actions/error-logs.ts:32` | `resolveErrorLog` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok (yazma) | P2 |
| `src/app/actions/error-logs.ts:76` | `resolveErrorLogs` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok (yazma) | P2 |
| `src/app/actions/growth.ts:130` | `createRewardRule` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/growth.ts:167` | `setRewardRuleActive` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/kvkk.ts:94` | `purgeStaleCustomers` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/kvkk.ts:44` | `requestCustomerErasure` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/lead-intake.ts:39` | `regenerateLeadToken` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/modules.ts:267` | `setTenantModuleByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/network.ts:1261` | `decideDemandResponse` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/network.ts:1492` | `listMyDemandResponses` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/network.ts:1427` | `listMyNetworkDemands` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/network.ts:635` | `listMyNetworkListings` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/network.ts:689` | `listMyRequests` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/network.ts:1083` | `listNetworkDemandPool` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/network.ts:296` | `listNetworkPool` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/network.ts:481` | `respondCollabRequest` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/network.ts:1185` | `respondToNetworkDemand` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/network.ts:406` | `sendCollabRequest` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/offers.ts:146` | `addOfferRound` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/offers.ts:292` | `convertOfferToDeal` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/offers.ts:47` | `createOffer` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/offers.ts:218` | `updateOffer` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/offers.ts:102` | `updateOfferStatus` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/open-house-public.ts:60` | `registerOpenHouseVisitorByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/open-house.ts:78` | `convertVisitorToCustomer` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/owner-portal.ts:204` | `getOwnerPortalData` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/payment-link-manage.ts:70` | `cancelPaymentLink` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/payment-link-manage.ts:127` | `extendPaymentLink` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/payment-links.ts:85` | `createPaymentLink` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/payment-links.ts:124` | `startPaymentLinkCheckout` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/platform-account.ts:39` | `updateOwnProfile` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-billing-plans.ts:74` | `syncEntitlements` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-billing.ts:72` | `markInvoicePaid` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/platform-billing.ts:178` | `recordInvoiceRefund` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/platform-billing.ts:349` | `resolveCapture` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/app/actions/platform-billing.ts:134` | `voidInvoice` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/platform-coupons.ts:39` | `createCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-coupons.ts:121` | `deleteCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-coupons.ts:107` | `setCouponActive` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-coupons.ts:71` | `updateCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-email-log.ts:36` | `addEmailSuppressionAction` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-email-log.ts:54` | `removeEmailSuppressionAction` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-members.ts:264` | `generateMemberResetLink` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/actions/platform-members.ts:138` | `setMemberActiveAsStaff` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/platform-members.ts:92` | `setMemberRoleAsStaff` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/platform-members.ts:226` | `signOutMemberSessions` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/actions/platform-members.ts:48` | `updateMemberProfile` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/platform-notifications.ts:274` | `deleteBroadcast` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-notifications.ts:145` | `listRecentBroadcasts` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/platform-notifications.ts:28` | `markAllPlatformNotificationsRead` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-notifications.ts:15` | `markPlatformNotificationRead` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-notifications.ts:167` | `searchTenantsBroadcast` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-notifications.ts:90` | `sendBroadcast` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-notifications.ts:232` | `updateBroadcast` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-ops.ts:93` | `createAlertChannel` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-ops.ts:125` | `deleteAlertChannel` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-ops.ts:196` | `muteAlertRule` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-ops.ts:113` | `setAlertChannelEnabled` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-ops.ts:58` | `setCronPaused` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-ops.ts:138` | `testAlertChannel` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-ops.ts:178` | `updateAlertRule` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-sales.ts:188` | `convertDemoToTenant` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/platform-sales.ts:312` | `resendConvertedOwnerAccessLink` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/platform-security.ts:231` | `listStaffMfaStatus` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-security.ts:192` | `resetStaffMfa` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-security.ts:163` | `setMfaEnforcement` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-staff.ts:40` | `addPlatformStaff` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-staff.ts:189` | `deactivateStaff` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-staff.ts:319` | `generateStaffResetLink` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/app/actions/platform-staff.ts:233` | `reactivateStaff` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-staff.ts:275` | `updateStaffProfile` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-staff.ts:137` | `updateStaffRole` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-subscription-fix.ts:109` | `extendSubscriptionPeriod` | Platform personeli: kiracılar arası yönetim paneli. | platform | param (yazma) | P2 |
| `src/app/actions/platform-subscription-fix.ts:61` | `markSubscriptionUnpaid` | Platform personeli: kiracılar arası yönetim paneli. | platform | param (yazma) | P2 |
| `src/app/actions/platform-subscription-ops.ts:85` | `gate` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-tenant-closure.ts:46` | `processOfficeClosureRequestByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:1076` | `addTenantPlatformNote` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:906` | `addTenantUserByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:702` | `changeTenantOwnerEmailByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-tenants.ts:544` | `changeTenantSlugByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:195` | `checkOfficeSlugAvailability` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-tenants.ts:249` | `createTenantByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:667` | `resendTenantOwnerAccessLink` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-tenants.ts:614` | `setTenantLifecycleByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/actions/platform-tenants.ts:982` | `setTenantUserActiveByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:783` | `transferTenantOwnershipByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform-tenants.ts:474` | `updateTenantProfileByAdmin` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz (yazma) | P2 |
| `src/app/actions/platform-trial.ts:45` | `extendTrial` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform.ts:91` | `startImpersonation` | Platform personeli: kiracılar arası yönetim paneli. | platform | var (yazma) | P2 |
| `src/app/actions/platform.ts:233` | `stopImpersonation` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/platform.ts:38` | `updateTenantPlanStatus` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/portal-listings.ts:234` | `closePortalListing` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/portal-listings.ts:152` | `confirmPortalListing` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/portal-listings.ts:184` | `confirmPortalListingsBulk` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/portal-listings.ts:21` | `createPortalListing` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/portal-publish.ts:225` | `publishPropertyToPortal` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/portal-publish.ts:338` | `unpublishPropertyFromPortal` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/portal-publish.ts:286` | `updatePropertyOnPortal` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/projects.ts:546` | `sellUnit` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/properties.ts:139` | `notifyPriceDropToMatchingDemands` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/app/actions/properties.ts:770` | `setPropertyStatus` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/property-media.ts:566` | `ocrPropertyMediaDocument` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/public-valuation.ts:97` | `estimatePublicValuation` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/actions/public-valuation.ts:201` | `submitValuationLead` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/referral-public.ts:56` | `submitReferralByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/rent-receipt-public.ts:114` | `finalizeRentReceiptUpload` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/rent-receipt-public.ts:70` | `prepareRentReceiptUpload` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/rentals.ts:438` | `applyRentIncrease` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/rentals.ts:61` | `createRental` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/rentals.ts:119` | `endRental` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/rentals.ts:237` | `extendRental` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/rentals.ts:284` | `markDepositReturned` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/rentals.ts:181` | `updateRental` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/sample-data.ts:149` | `clearSampleData` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | uygulanamaz | P2 |
| `src/app/actions/sample-data.ts:94` | `seedSampleData` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | param (yazma) | P2 |
| `src/app/actions/subscription-cancel.ts:38` | `requestSubscriptionCancel` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/subscription-cancel.ts:87` | `undoSubscriptionCancel` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/app/actions/survey-public.ts:58` | `submitSurveyByToken` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/actions/survey-public.ts:180` | `submitSurveyTaskByToken` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/team-member-admin.ts:106` | `sendAccessMail` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/app/actions/team-member-admin.ts:57` | `updateMemberProfile` | auth.admin API'si (RLS ile yapılamaz). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/team.ts:69` | `createTeamMember` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | var | P2 |
| `src/app/actions/team.ts:104` | `updateTeamMember` | auth.admin API'si (RLS ile yapılamaz). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/tenant-integrations.ts:121` | `clearNetgsmCredentials` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tenant-integrations.ts:282` | `clearWhatsAppCredentials` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tenant-integrations.ts:61` | `saveNetgsmCredentials` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tenant-integrations.ts:166` | `saveWhatsAppCredentials` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/ticket-attachments.ts:42` | `deleteTicketAttachment` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/actions/tickets.ts:170` | `createSupportTicket` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tickets.ts:208` | `createSupportTicketAsStaff` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/tickets.ts:297` | `replyTicketAsStaff` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/tickets.ts:363` | `replyTicketAsTenant` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tickets.ts:328` | `setTicketStatusAsTenant` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tickets.ts:396` | `submitTicketCsat` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/actions/tickets.ts:107` | `tenantName` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/app/actions/tickets.ts:257` | `updateTicketStatus` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/actions/vitrin-alerts.ts:59` | `createVitrinPriceAlert` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/vitrin.ts:71` | `createVitrinSavedSearch` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/actions/vitrin.ts:155` | `likePublicShare` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/actions/workflow.ts:72` | `convertWorkflow` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/admin/aktivite/page.tsx:171` | `AdminActivityPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/analiz-tarifesi/piyasa-verisi/route.ts:35` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | devir | P2 |
| `src/app/admin/bildirimler/page.tsx:54` | `AdminNotificationsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/billing/faturalar/[id]/page.tsx:28` | `InvoiceDetailPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/billing/kuponlar/page.tsx:20` | `CouponsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/billing/page.tsx:92` | `AdminBillingPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/billing/planlar/page.tsx:50` | `PlansAdminPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | devir | P2 |
| `src/app/admin/duyuru/page.tsx:41` | `BroadcastPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/geo/[provinceId]/page.tsx:35` | `AdminGeoProvincePage` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/admin/geo/bildirimler/page.tsx:29` | `AdminGeoRequestsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/geo/page.tsx:22` | `AdminGeoPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/admin/hatalar/errors-view.tsx:118` | `ErrorsView` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/members/[id]/page.tsx:68` | `AdminMemberDetailPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/members/page.tsx:59` | `AdminMembersPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/muhasebe/defter/page.tsx:45` | `FaturaDefteriPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | devir | P2 |
| `src/app/admin/muhasebe/page.tsx:47` | `MuhasebePage` | Platform personeli: kiracılar arası yönetim paneli. | platform | devir | P2 |
| `src/app/admin/page.tsx:87` | `getAdminDashboardData` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/app/admin/raporlar/page.tsx:58` | `AdminReportsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/seo/pattern-samples.ts:45` | `loadPatternData` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/app/admin/sistem/alerts-view.tsx:55` | `AlertsView` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/sistem/database-view.tsx:31` | `DatabaseView` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/admin/sistem/resources-view.tsx:41` | `ResourcesView` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/sistem/system-view.tsx:147` | `SystemView` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/tenants/[id]/page.tsx:111` | `AdminTenantDetailPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/tenants/page.tsx:88` | `AdminTenantsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/tickets/[id]/page.tsx:141` | `AdminTicketDetailPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/tickets/kvkk/page.tsx:47` | `KvkkQueuePage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/tickets/makrolar/page.tsx:10` | `MacrosPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/admin/tickets/page.tsx:236` | `AdminTicketsPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | var | P2 |
| `src/app/admin/tickets/yeni/page.tsx:11` | `NewAdminTicketPage` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/anket/[token]/page.tsx:47` | `SurveyPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/api/admin/notifications/route.ts:10` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/api/admin/personel/route.ts:27` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/api/admin/search/route.ts:30` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | yok | P2 |
| `src/app/api/admin/tenants/[id]/export/route.ts:17` | `GET` | Platform personeli: kiracılar arası yönetim paneli. | platform | uygulanamaz | P2 |
| `src/app/api/ai/admin-chat/route.ts:45` | `persistTurn` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/app/api/cron/abonelik-kontrol/route.ts:42` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/anahtar-gecikme/route.ts:59` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/anket-gorevleri/route.ts:55` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/bolge-snapshot/route.ts:50` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/dogum-gunu/route.ts:62` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/dunning/route.ts:70` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/ef-kontor-hak/route.ts:73` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/geo-sync/route.ts:49` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | yok | P2 |
| `src/app/api/cron/gorev-hatirlat/route.ts:24` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/gunluk-ozet/route.ts:23` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/haftalik-ozet/route.ts:56` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/havuz-atama/route.ts:33` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | devir | P2 |
| `src/app/api/cron/kira-tahakkuk/route.ts:86` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/leak-sla/route.ts:71` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/lig-snapshot/route.ts:45` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/operational-retention/route.ts:34` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | param (yazma) | P2 |
| `src/app/api/cron/portal-teyit/route.ts:124` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/proje-vade/route.ts:37` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/cron/randevu-hatirlat/route.ts:33` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var | P2 |
| `src/app/api/cron/tcmb-kur/route.ts:32` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | uygulanamaz (yazma) | P2 |
| `src/app/api/cron/ticket-sla/route.ts:21` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | yok | P2 |
| `src/app/api/cron/vitrin-alarm/route.ts:27` | `GET` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | devir | P2 |
| `src/app/api/cron/vitrin-eslesme/route.ts:81` | `run` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | var (yazma) | P2 |
| `src/app/api/customer-files/[id]/download/route.ts:58` | `GET` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/api/expense-receipts/[id]/download/route.ts:54` | `GET` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/api/health/route.ts:93` | `GET` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/app/api/iyzico/callback/route.ts:63` | `handle` | Oturumsuz dış çağrı (webhook/ödeme geri dönüşü). | webhook-imza | var | P2 |
| `src/app/api/iyzico/webhook/route.ts:89` | `POST` | Oturumsuz dış çağrı (webhook/ödeme geri dönüşü). | webhook-imza | var (yazma) | P2 |
| `src/app/api/property-media/[id]/download/route.ts:60` | `GET` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/api/property-media/[id]/route.ts:11` | `GET` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/api/rent-receipts/[noticeId]/route.ts:37` | `GET` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/api/takvim/[token]/route.ts:61` | `GET` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/api/ticket-attachments/[id]/route.ts:42` | `GET` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/api/ticket-attachments/finalize/route.ts:54` | `POST` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/api/ticket-attachments/route.ts:88` | `POST` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/api/vitrin-favoriler/route.ts:118` | `POST` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/app/ayarlar/guvenlik/actions.ts:28` | `setTwoFactorSms` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/app/ekip/invite-actions.ts:141` | `createAdvisor` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var (yazma) | P2 |
| `src/app/app/ekip/invite-actions.ts:31` | `resendInvite` | auth.admin API'si (RLS ile yapılamaz). | oturum-izin | var | P2 |
| `src/app/app/ekip/page.tsx:150` | `TeamPage` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | var | P2 |
| `src/app/app/sozlesmeler/[id]/page.tsx:92` | `ContractDetailPage` | Oturumlu işlem; admin gerekçesi doğrulanmadı (RLS'li client'a taşıma adayı). | oturum-izin | param | P2 |
| `src/app/danisman/[slug]/page.tsx:171` | `AgentCardPage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/danisman/[slug]/page.tsx:121` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/danisman/[slug]/page.tsx:94` | `loadAgent` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/danisman/[slug]/vcard/route.ts:50` | `GET` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/degerleme-raporu/[token]/page.tsx:62` | `PublicValuationReportPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/evrak/[token]/page.tsx:65` | `EvrakPage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/giris/_lib/login-events.ts:18` | `logLoginEvent` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/giris/dogrulama/actions.ts:265` | `cancelLoginVerification` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/app/giris/dogrulama/actions.ts:202` | `resendLoginCode` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/app/giris/dogrulama/actions.ts:57` | `verifyLoginCode` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/imza/[token]/page.tsx:32` | `PublicContractSignPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/lead/[token]/page.tsx:18` | `PublicLeadPage` | Oturumsuz token'lı public yüzey. | public-token | uygulanamaz | P2 |
| `src/app/malik-portali/[token]/page.tsx:113` | `MalikPortaliPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/musteri-portali/[token]/page.tsx:114` | `CustomerPortalPage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/odeme-link/[token]/page.tsx:43` | `PublicPaymentLinkPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/paylas/[token]/page.tsx:78` | `generateMetadata` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/paylas/[token]/page.tsx:141` | `PublicSharePage` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/app/randevu-al/[token]/page.tsx:48` | `BookingPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/sunum/[token]/page.tsx:82` | `PublicPresentationPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/tavsiye/[token]/page.tsx:49` | `ReferralPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/vitrin/[slug]/[id]/opengraph-image.tsx:18` | `Image` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/[id]/page.tsx:137` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/[id]/page.tsx:226` | `VitrinPropertyPage` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/app/vitrin/[slug]/degerleme/page.tsx:26` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/vitrin/[slug]/degerleme/page.tsx:60` | `VitrinDegerlemePage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/favoriler/page.tsx:25` | `generateMetadata` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/vitrin/[slug]/favoriler/page.tsx:41` | `VitrinFavorilerPage` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/app/vitrin/[slug]/opengraph-image.tsx:15` | `Image` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/app/vitrin/[slug]/page.tsx:82` | `loadOfficeHead` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/activity.ts:17` | `writeActivity` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/admin-badges.ts:38` | `cachedBadges` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/admin/activity-query.ts:104` | `queryActivity` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/ai/credits/meter.ts:113` | `charge` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/ai/credits/meter.ts:71` | `getTenantQuotas` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/ai/credits/usage.ts:114` | `getPlatformUsage` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/ai/credits/usage.ts:59` | `getTenantUsage` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/ai/platform-quota.ts:63` | `readPlatformAiQuota` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/ai/platform-quota.ts:25` | `takePlatformAiQuota` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/automation-engine.ts:536` | `dispatchAutomationEvent` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/automation-engine.ts:784` | `runScheduledAutomations` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/billing/coupon-server.ts:16` | `quoteCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/billing/coupon-server.ts:44` | `redeemCoupon` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/billing/credit-pack-purchase.ts:29` | `createCreditPackInvoice` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/billing/fulfillment.ts:427` | `assertBillingPlanPreflight` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/billing/fulfillment.ts:320` | `createCheckoutInvoice` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/billing/fulfillment.ts:113` | `fulfillBillingPaymentAtomic` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/billing/fulfillment.ts:412` | `markCheckoutInvoiceFailed` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/billing/fulfillment.ts:388` | `markCheckoutInvoiceInitialized` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/billing/payment-link-fulfill.ts:22` | `fulfillPaymentLink` | Oturumsuz dış çağrı (webhook/ödeme geri dönüşü). | webhook-imza | var | P2 |
| `src/lib/billing/reconciliation.ts:69` | `reconcileCapture` | Oturumsuz token'lı public yüzey. | public-token | var | P2 |
| `src/lib/billing/reconciliation.ts:45` | `transitionCapture` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | yok | P2 |
| `src/lib/billing/seat-purchase.ts:53` | `cachedSeatSupport` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/billing/seat-purchase.ts:212` | `createSeatInvoice` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/campaign-delivery.ts:524` | `runCampaignDeliveryWorker` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/cron-heartbeat.ts:24` | `recordHeartbeat` | Zamanlanmış iş: oturum yok, tüm kiracılar üzerinde çalışır. | cron | uygulanamaz (yazma) | P2 |
| `src/lib/cron-pause.ts:50` | `beginCronRun` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/lib/definitions.ts:28` | `loadDefinitions` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/direct-file-upload-cleanup.ts:77` | `cleanupDirectFileUploads` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/direct-file-upload-cleanup.ts:52` | `metadataExists` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/direct-file-upload-server.ts:233` | `finalizeDirectFileUpload` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/direct-file-upload-server.ts:118` | `prepareDirectFileUpload` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/direct-file-upload-server.ts:183` | `updateOwnedLease` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | yok (yazma) | P2 |
| `src/lib/doc-request/server.ts:53` | `lookupPublicRequest` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/ef-credits/admin-data.ts:106` | `grantEfCredit` | Gerekçe doğrulanmadı. | dosya-duzeyi | param | P2 |
| `src/lib/ef-credits/admin-data.ts:32` | `listTenantEfBalances` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/ef-credits/admin-data.ts:89` | `readTenantName` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/ef-credits/credit-reader.ts:101` | `readEfBalance` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/ef-credits/credit-reader.ts:140` | `readEfHistory` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/ef-credits/wallet.ts:155` | `getEfReport` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/ef-credits/wallet.ts:127` | `insertEfReport` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/ef-credits/wallet.ts:171` | `listEfReports` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/ef-credits/wallet.ts:192` | `markEfPdfCharged` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/email/log-read.ts:90` | `loadEmailLog` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/email/log-read.ts:124` | `loadEmailSuppressions` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/email/send.ts:73` | `sendLoggedEmail` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/email/webhook.ts:147` | `applyResendEvent` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/error-log.ts:91` | `logError` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/geo-province-sync.ts:94` | `failClaimedJob` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/geo-province-sync.ts:110` | `runGeoProvinceSyncWorker` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/geo/admin-store.ts:268` | `addAlias` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/lib/geo/admin-store.ts:159` | `addAliasInternal` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/lib/geo/admin-store.ts:323` | `applyPlan` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/geo/admin-store.ts:261` | `listAliases` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/geo/admin-store.ts:394` | `listChangeRequests` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
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
| `src/lib/google/db.ts:17` | `db` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/growth-analytics/funnel.ts:132` | `readGrowthFunnel` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/growth/store.ts:75` | `activeRule` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/growth/store.ts:134` | `ensureReferralCode` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/growth/store.ts:347` | `getAdminGrowthOverview` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/growth/store.ts:110` | `getReferralOverview` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/growth/store.ts:159` | `recordSignupAttributionSafe` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/integrations/einvoice/server-writes.ts:24` | `writeEInvoiceResult` | Gerekçe doğrulanmadı. | dosya-duzeyi | param | P2 |
| `src/lib/lead-intake.ts:103` | `intakeLead` | Oturumsuz token'lı public yüzey. | public-token | var (yazma) | P2 |
| `src/lib/match-notify.ts:23` | `notifyMatchingDemandsForProperty` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/measure/buffer.ts:131` | `doFlush` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/measure/collector.ts:48` | `flowLast24h` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/measure/field-data.ts:84` | `readVitalsSummary` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/measure/maintenance.ts:19` | `runMeasureMaintenance` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/messaging/tenant-providers.ts:79` | `getActiveTenantIntegration` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/messaging/whatsapp-cloud.ts:112` | `existingTenantWhatsAppToken` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/messaging/whatsapp-cloud.ts:317` | `listApprovedTenantWhatsAppTemplates` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/notify.ts:88` | `notifyTenant` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/office-score.ts:57` | `loadOfficeScoreInputsForTenant` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/perf/store.ts:135` | `listLabRuns` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/perf/store.ts:149` | `pruneLabRuns` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/lib/perf/store.ts:109` | `upsertLabRun` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/lib/platform-activity.ts:19` | `logPlatformActivity` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/lib/platform-notify.ts:19` | `notifyPlatformStaff` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz (yazma) | P2 |
| `src/lib/platform-settings.ts:6` | `getPlatformSetting` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/platform-settings.ts:46` | `getPlatformSettingsMany` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/platform-settings.ts:25` | `readPlatformSettingStrict` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/platform-settings.ts:83` | `setPlatformSetting` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/platform.ts:41` | `bootstrapPlatformStaffIfAllowed` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz (yazma) | P2 |
| `src/lib/playbook-trigger.ts:28` | `triggerPlaybooks` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/pool/system-assign.ts:21` | `assignPoolEntryAsSystem` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/public-mutation-outbox.ts:59` | `processPublicMutationOutbox` | Gerekçe doğrulanmadı. | dosya-duzeyi | var | P2 |
| `src/lib/public-upload-cleanup.ts:25` | `cleanupAbandonedPublicUploads` | Gerekçe doğrulanmadı. | dosya-duzeyi | var (yazma) | P2 |
| `src/lib/push.ts:41` | `sendPushToUser` | Gerekçe doğrulanmadı. | belirsiz | var (yazma) | P2 |
| `src/lib/rate-limit.ts:87` | `checkRateLimit` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/report-center/context.ts:48` | `buildPlatformContext` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/seo/sitemap-data.ts:78` | `loadAll` | Gerekçe doğrulanmadı. | belirsiz | var | P2 |
| `src/lib/seo/store.ts:323` | `listNotFound` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
| `src/lib/seo/store.ts:307` | `logNotFound` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/seo/store.ts:339` | `prune404` | Sistem/altyapı işi; kapı elle incelendi (bkz. kapı kanıtı). | elle-dogrulandi | uygulanamaz | P2 |
| `src/lib/site-issues/store.ts:29` | `db` | Gerekçe doğrulanmadı. | belirsiz | uygulanamaz | P2 |
| `src/lib/site-media/store.ts:19` | `db` | Gerekçe doğrulanmadı. | dosya-duzeyi | uygulanamaz | P2 |
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
