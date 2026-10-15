/**
 * Server Action yetki kapısı denetimi.
 *
 * NEDEN VAR: Bir Server Action, tarayıcıdan doğrudan çağrılabilen bir uç
 * noktadır. Gövdesinde yetki kontrolü yoksa herkes çağırabilir — ve bunu
 * TypeScript göremez, ESLint göremez, test yazılmadıysa hiçbir şey göremez.
 * "Yeni action ekledim, kapıyı koymayı unuttum" sessizce geçen bir hatadır.
 *
 * NASIL ÇALIŞIR: `src/app/actions/*.ts` içindeki `"use server"` dosyalarında
 * her `export async function` gövdesinde bilinen kapı çağrılarından biri
 * aranır. Bulunamazsa, aynı dosyadaki BAŞKA bir fonksiyonu çağırıp çağırmadığı
 * kontrol edilir (delegasyon: `setMemberRole` → `updateTeamMember` gibi) ve o
 * fonksiyonun kapısı devralınır. İki seviye takip edilir.
 *
 * SINIRI DÜRÜSTÇE: Bu statik bir tarama. Kapının VARLIĞINI doğrular, DOĞRU
 * kapı olduğunu değil — `requirePermission("customers","view")` yazması
 * gereken yerde `requireActiveTenant()` varsa bu denetim geçer. Yine de en
 * sık hatayı (kapıyı tamamen unutmak) yakalar.
 *
 * Çalıştırma:  npm run audit:actions
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Bilinen kapı çağrıları. YENİ BİR KAPI YARDIMCISI EKLERSENİZ BURAYA DA EKLEYİN,
 * yoksa denetim yanlış alarm verir.
 *
 * Not: Liste ilk yazıldığında `requireRoleManager` ve `requireActiveTenant`
 * eksikti ve denetim 37 yanlış pozitif üretti. Kapı adlarının tek yerde
 * toplanmasının sebebi bu.
 */
const GATES = [
  // Kiraci tarafi
  "requirePermission",
  "requireModulePage",
  "requireActiveTenant",
  "requireManager",
  "requireRoleManager",
  // Platform (super admin) tarafi
  "requirePlatformStaff",
  "requirePlatformModule",
  "requireSiteMediaWriter", // src/lib/site-media/upload.ts: requirePlatformModule("sitecontent") + yalniz super_admin
  "guardPlatformAction",
  "getPlatformStaff",
  "getPlatformStaffIdentity",
  "isPlatformStaff",
  // Ham oturum kontrolu
  "getRequestUser",
];

/**
 * Bilinçli istisnalar: kapısı OLMAMASI gereken action'lar.
 * Her biri gerekçesiyle burada; listeye ekleme yapmak bilinçli bir karar olmalı.
 */
const MUAF: Record<string, string> = {
  "kvkk-public.ts::submitKvkkApplication": "Herkese açık KVKK başvuru formu (vatandaş başvurusu; oturum yok, olamaz): IP başına 5/saat ve e-posta başına 4/saat hız sınırı, zod doğrulaması, başvuru e-posta koduyla doğrulanana kadar işleme alınmaz (verifyKvkkApplication).",
  "kvkk-public.ts::verifyKvkkApplication": "Herkese açık KVKK başvurusunun e-posta doğrulaması (oturum yok, olamaz): IP başına 20/saat hız sınırı, başvuru başına deneme tavanı, süreli kod, kod yalnız HMAC özeti olarak saklı (verifyOtpHash); başarıda denetim kaydı.",
  "auth.ts::signOut": "Çıkış her durumda çalışmalı; oturumu olmayan için de zararsız.",
  "auth.ts::signIn": "Giriş noktasının kendisi — kapı buradan sonra kuruluyor.",
  "auth.ts::signUp": "Kayıt noktası.",
  "demo-login.ts::quickDemoLogin": "Demo girişi; kendi bayrağıyla (ENABLE_DEMO_LOGIN) korunuyor.",
  // Platform personeli işlemleri: tasarım gereği kiracılar arası; hedef ofis parametredir, kapı platform rol/modül kapısıdır
  // (kiracı kapısı değil). Her biri UUID doğrular, gerekçe ister ve platform_audit_logs'a önce/sonra yazar.
  "platform-subscription-fix.ts::markSubscriptionUnpaid": "Platform 'billing' modül kapısı (requirePlatformModule); hedef ofis personel seçimi, denetim izli.",
  "platform-subscription-fix.ts::extendSubscriptionPeriod": "Platform 'billing' modül kapısı; 1-90 gün sınırı, gerekçe ve denetim izi.",
  "platform-notifications.ts::searchTenantUsersBroadcast": "Platform 'broadcast' personeli (super_admin/ops) kapısı; doğrudan mesaj için seçilen ofisin aktif kullanıcı adlarını listeler (salt okunur, UUID doğrulanır).",
  "platform-trial.ts::extendTrial":"Platform personeli + canChangeTrial rol kapısı; yalnız deneme ofisinde, ≤90 gün, gerekçe ve denetim izi.",
  "contracts.ts::signContractByToken": "İmza bağlantısı token ile korunuyor, oturum gerektirmez.",
  "contracts.ts::submitSignatureByToken": "Aynı token akışı.",

  // --- Token ile korunan portal akislari (oturum YOK, olmamali) ---
  "customer-portal.ts::getCustomerPortalData": "Musteri portali token ile acilir; oturum gerektirmez.",
  "owner-portal.ts::getOwnerPortalData": "Malik portali token ile acilir.",
  "payment-links.ts::startPaymentLinkCheckout": "Odeme baglantisi token ile; musteri oturum acmaz.",
  "payment-links.ts::markPaymentLinkPaid": "Ayni token akisi; ayrica iyzico canliysa env bayragiyla kapali.",

  // --- Halka acik form ---
  "demo.ts::requestDemo": "Pazarlama sitesindeki demo talep formu; oturum gerektirmez.",

  // --- Token'li public sayfalarin action'lari (oturum YOK, olmamali) ---
  // Ortak koruma deseni: UUID regex on eleme + admin client + checkRateLimit + honeypot;
  // yazma islemleri token'in cozdugu tek kayda sabit, kullanicidan tenant_id alinmaz.
  "appointments-confirm.ts::respondToAppointmentByToken": "Randevu teyit baglantisi token ile acilir.",
  "appointments-suggest.ts::suggestAlternativeTimesByToken":
    "Randevu teyit baglantisindaki musteri onerisi: UUID confirm_token dogrulanir, IP hiz siniri (deny), tenant filtreli tek randevu notuna yazar; durum degismez.",
  "booking-public.ts::createPublicBooking": "Online randevu rezervasyonu; token danismanin booking_settings kaydini cozer.",
  "open-house-public.ts::registerOpenHouseVisitorByToken": "Acik ev QR self check-in; token etkinlige sabit.",
  "owner-portal-offers.ts::respondToOfferByToken": "Malik portalinda teklif onay/ret; token ile.",
  "owner-price-proposal.ts::decideOwnerPriceProposal": "Malik portalinda fiyat onerisi onay/ret/not; token ve oneri-portfoy eslesmesi SQL RPC icinde (20261012000800), service_role yok, IP hiz siniri.",
  "customer-portal-feedback.ts::submitMatchFeedbackByToken": "Musteri portali begen/gec geri bildirimi; token ile.",
  "customer-portal-requests.ts::submitPortalRequest": "Musteri portali teklif/erteleme/bakim istegi; token ve sahiplik SQL RPC icinde (20261007000620), service_role yok.",
  "survey-public.ts::submitSurveyByToken": "NPS memnuniyet anketi; token ankete sabit.",
  "survey-public.ts::submitSurveyTaskByToken": "Anketör görevi bağlı linki; UUID token tek göreve sabit, IP hız sınırı (deny), honeypot, modül ve ofis aktiflik denetimi, tenant filtreli yazım.",
  "referral-public.ts::submitReferralByToken": "Tavsiye formu; token referral_links kaydina sabit.",
  "document-request-public.ts::prepareDocRequestUpload": "Evrak linki yukleme izni; token SHA-256 ozetiyle cozulur (sure/iptal/limit), IP+token hiz siniri (deny), tek nesnelik izin.",
  "document-request-public.ts::finalizeDocRequestUpload": "Evrak linki dosya dogrulamasi; ayni token akisi, bayt/imza dogrulamasi, tenant token'in cozdugu kayda sabit.",
  "document-request-public.ts::completeDocRequest": "Evrak linkini tek kullanimlik kapatir; ayni token akisi ve hiz siniri.",
  "rent-receipt-public.ts::prepareRentReceiptUpload": "Kiraci Odedim dekontu yukleme izni; musteri portali token'i portal_rent_receipt_target RPC'siyle cozulur (sure/sahiplik/bekleyen bildirim), IP+token hiz siniri (deny), tek nesnelik imza, jpg/png/pdf <=5 MB.",
  "rent-receipt-public.ts::finalizeRentReceiptUpload": "Kiraci dekontu bayt/imza dogrulamasi; ayni token akisi, ofis/kiraci/bildirim token'in cozdugu kayda sabit.",
  "vitrin-alerts.ts::createVitrinPriceAlert": "Vitrin fiyat alarmi; yayindaki ilana sabit, ofis ici bildirim uretir.",
  "vitrin.ts::createVitrinSavedSearch": "Vitrin kayitli arama; ziyaretci oturum acmaz.",
  "vitrin.ts::likePublicShare": "Paylasim baglantisinda begeni sayaci.",
  "presentation-feedback.ts::submitPresentationFeedback":
    "Sunum linkinde ilan bazinda ilgileniyorum/degil + not: UUID token tek sunuma cozulur, ilan sunumun property_ids listesinde olmali, IP+token hiz siniri (deny), honeypot, ofis aktif + modul acik; tenant/musteri sunumdan gelir.",

  // --- Halka acik huniler (pazarlama/vitrin) ---
  "public-valuation.ts::listPublicDistricts": "Salt okunur geo listesi; kiraciya ozel veri icermez.",
  "public-valuation.ts::estimatePublicValuation": "Vitrin degerleme hesabi; rate limit'li, kayit yazmaz.",
  "public-valuation.ts::submitValuationLead": "Satici basvuru formu; rate limit + KVKK onayi ile.",
  "password-reset.ts::requestPasswordReset": "Sifre sifirlama talebi; dogasi geregi oturumsuz, kullanici varligini sizdirmaz.",

  // --- OTP ve webhook: kendi sirriyla korunanlar ---
  "contracts.ts::requestSignatureOtp": "E-imza OTP talebi; imza token'i uzerinden, kod SMS ile dogrulanir.",
  "contracts.ts::verifySignatureOtp": "OTP dogrulama; deneme sayaci ve sure siniri kendi icinde.",
  // --- Acik referans verisi (kiraciya ozel deger icermez) ---
  "geo.ts::listDistricts": "Turkiye idari bolunusu; geo_* tablolari RLS'te herkese acik okunur.",
  "geo.ts::listNeighborhoods": "Ayni.",
  "portal-publish.ts::getConfiguredPortals": "Yalnizca hangi portal adaptorlerinin yapilandirildigini doner; veri icermez.",
};

const GATE_RE = new RegExp(`\\b(${GATES.join("|")})\\s*\\(`);

type Fn = { key: string; file: string; name: string; body: string; exported: boolean };

function collect(dir: string): Map<string, Fn> {
  const out = new Map<string, Fn>();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    if (!src.includes('"use server"')) continue;

    /*
     * `export` eslesmeye DAHIL: m.index "export" kelimesinin basini gosteriyor.
     * Ilk yazimda `export`i m.index'in ONCESINDE aramistim; hicbir zaman
     * bulamadi ve denetim 0 action gorup "temiz" dedi. Hicbir seye bakmadan
     * gecen bir denetim, denetim olmamasindan kotudur — bu yuzden asagida
     * ayrica bir "kapsam sifir" korumasi var.
     */
    const re = /(export\s+)?(async\s+)?function\s+(\w+)\s*\(/g;
    const hits: { name: string; at: number; exported: boolean }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      hits.push({ name: m[3], at: m.index, exported: Boolean(m[1]) });
    }
    for (let i = 0; i < hits.length; i++) {
      const bas = hits[i].at;
      const son = i + 1 < hits.length ? hits[i + 1].at : src.length;
      out.set(`${f}::${hits[i].name}`, {
        key: `${f}::${hits[i].name}`,
        file: f,
        name: hits[i].name,
        body: src.slice(bas, son),
        exported: hits[i].exported,
      });
    }
  }
  return out;
}

/*
 * Derinlik 3: gercek zincirler dort kademeye cikabiliyor —
 * ornek: approveLeaveForm -> approveLeave -> setLeaveStatus -> leaveGate(requirePermission)
 * (staff-leaves.ts). Sinir 2'yken bu zincir "kapisiz" gorunuyordu.
 */
function korumali(key: string, all: Map<string, Fn>, derinlik = 0): boolean {
  const fn = all.get(key);
  if (!fn || derinlik > 3) return false;
  if (GATE_RE.test(fn.body)) return true;

  // Delegasyon: aynı dosyadaki başka bir fonksiyonu çağırıyorsa onun kapısı geçerli.
  for (const [k2, f2] of all) {
    if (k2 === key || f2.file !== fn.file) continue;
    if (new RegExp(`\\b${f2.name}\\s*\\(`).test(fn.body) && korumali(k2, all, derinlik + 1)) return true;
  }
  return false;
}

const all = collect("src/app/actions");
const exported = [...all.values()].filter((f) => f.exported);
const acik = exported.filter((f) => !MUAF[f.key] && !korumali(f.key, all));

console.log(`kapsam: ${exported.length} dışa açık server action, ${Object.keys(MUAF).length} bilinçli muafiyet`);

/*
 * KAPSAM KORUMASI: Bir tarama hatası yüzünden hiç fonksiyon bulunamazsa
 * denetim sessizce "temiz" derdi. Bu gerçekten oldu (ilk sürümde `export`
 * yanlış yerde aranıyordu, kapsam 0 çıktı ve BULGU YOK yazdı). Alt sınır
 * kaba ama etkili: dosyalar duruyorsa en az bu kadar action olmalı.
 */
const MIN_KAPSAM = 40;
if (exported.length < MIN_KAPSAM) {
  console.error(
    `
DENETIM GUVENILMEZ: yalnızca ${exported.length} action bulundu, en az ${MIN_KAPSAM} bekleniyordu.
` +
      "Tarama bozulmuş olabilir. 'BULGU YOK' sonucuna güvenmeyin.",
  );
  process.exit(2);
}

/* ===========================================================================
 * IKINCI KONTROL: service_role + cagiranin verdigi kiraci kimligi
 * ===========================================================================
 * `createAdminClient()` RLS'i TAMAMEN atlar. Bir Server Action hem bunu
 * kullanip hem de kiraci/kullanici kimligini PARAMETRE olarak aliyorsa,
 * hedefi cagiran seciyor demektir — kiraci izolasyonu ortadan kalkar.
 *
 * Bu tam olarak `notifyTenant`ta bulunan sekildi: uc nokta + service_role +
 * parametreden gelen tenantId + kapi yok. lib/ altina tasinarak coazuldu.
 *
 * lib/ altindaki ayni sekil SORUN DEGIL: orasi uc nokta degil, yalnizca
 * sunucu kodu import edebiliyor.
 */
const RISKLI_PARAM = /\btenantId\b|\btenant_id\b|\buserId\b|\buser_id\b/;

/*
 * DENETIMIN KENDI KENDINI SINAMASI.
 *
 * Bu satirlar bir hatadan dogdu: yukaridaki desen bir noktada kelime siniri
 * yerine GERCEK BACKSPACE karakteri (0x08) iceriyordu. Kaynak kodda goze
 * normal gorunuyordu, RegExp.source bile dogru basiyordu — ama hicbir seyle
 * eslesmiyordu. Kontrol sessizce her zaman "temiz" diyordu.
 *
 * Bir denetimin en tehlikeli hali, BAKMADAN gecmesidir. Bu yuzden calisma
 * aninda bilinen bir POZITIF ve bir NEGATIF ornekle kendini sinar.
 */
const SINAMA_POZITIF = "export async function x(tenantId: string)";
const SINAMA_NEGATIF = "export async function y(formData: FormData)";
if (!RISKLI_PARAM.test(SINAMA_POZITIF) || RISKLI_PARAM.test(SINAMA_NEGATIF)) {
  console.error("DENETIM BOZUK: RISKLI_PARAM deseni kendi sinama orneklerinde basarisiz. Sonuclara guvenmeyin.");
  process.exit(2);
}

const svcAcik = exported.filter((f) => {
  if (!f.body.includes("createAdminClient()")) return false;
  const imza = f.body.slice(0, f.body.indexOf(")") + 1);
  return RISKLI_PARAM.test(imza) && !MUAF[f.key];
});

/* ===========================================================================
 * UCUNCU KONTROL (SK10 / B166): yetki reddini YUTAN void eylem
 * ===========================================================================
 * `requirePermission` cagiran ve disa acik bir eylem `Promise<void>` dondurmemeli: void eylemde kapi reddi
 * (`if (!gate.ok) return;`) istemciye hic ulasmaz; iyimser arayuz "Teyit edildi" der, kullanici yetkisiz
 * oldugunu ogrenmez. Eylem `{ ok } | { error }` dondurur (src/lib/action-outcome.ts); dogrudan `<form action>`
 * olarak kullaniliyorsa form uyumlu asiri yukleme eklenir (`export function f(fd): Promise<void>;`).
 * TABAN: bu kural yazildiginda baska paketlerin dosyalarinda kalan eylemler (her biri sahibiyle); YENI void eylem
 * kirar, listede olup artik void olmayan (bayat) anahtar da kirar -> liste kendiliginden daralir.
 */
const VOID_TABAN: Record<string, string> = {
  "customers.ts::reassignCustomer": "SK7 (customers.ts) kendi bulgusu kapsaminda {ok|error} donusune cevirir.",
  "properties.ts::setPropertyStatus": "SK9 (properties.ts): karar.json B166 dagilimi; <=5 hedefinde kalan kullanim.",
  "properties.ts::reassignProperty": "SK9 (properties.ts): karar.json B166 dagilimi; <=5 hedefinde kalan kullanim.",
  "property-media.ts::deletePropertyMedia": "SK9 (property-media.ts): karar.json B166 dagilimi; <=5 hedefinde kalan kullanim.",
  "property-media.ts::setCoverPropertyMedia": "SK9 (property-media.ts): karar.json B166 dagilimi; <=5 hedefinde kalan kullanim.",
};
const VOID_HEADER_RE = /\)\s*:\s*Promise<void>\s*$/;
const voidGated = exported
  .filter((f) => {
    const brace = f.body.indexOf("{");
    const header = brace >= 0 ? f.body.slice(0, brace) : f.body;
    return VOID_HEADER_RE.test(header) && /\brequirePermission\s*\(/.test(f.body);
  })
  .map((f) => f.key);
const voidYeni = voidGated.filter((k) => !VOID_TABAN[k]);
const voidBayat = Object.keys(VOID_TABAN).filter((k) => !voidGated.includes(k));
console.log(`void + requirePermission eylem: ${voidGated.length} (taban ${Object.keys(VOID_TABAN).length})`);

// Bayat taban anahtarı yalnız UYARI: sahibi paket eylemini çevirdiğinde bu betiği bilmeden kırılmasın.
if (voidBayat.length > 0) {
  console.log(`[UYARI VOID-TABAN-BAYAT] ${voidBayat.length} anahtar artık void değil; VOID_TABAN'dan silinebilir:`);
  for (const k of voidBayat) console.log(`   ${k}`);
}

if (acik.length === 0 && svcAcik.length === 0 && voidYeni.length === 0) {
  console.log("BULGU YOK — hepsinde yetki kapısı var (doğrudan ya da delegasyonla).");
  console.log("service_role kullanan action'larda çağıran kaynaklı kiracı kimliği yok.");
  console.log("Yetki reddini yutan yeni void eylem yok.");
  process.exit(0);
}

if (voidYeni.length > 0) {
  console.log(`\n[VOID-EYLEM] ${voidYeni.length} action requirePermission çağırıp Promise<void> döndürüyor:`);
  for (const k of voidYeni) console.log(`   ${k}`);
  console.log("Yetki reddi istemciye ulaşmalı: { ok } | { error } döndürün (src/lib/action-outcome.ts).");
}

if (svcAcik.length > 0) {
  console.log(`\n[SERVICE_ROLE + PARAMETRE] ${svcAcik.length} action:`);
  for (const f of svcAcik) console.log(`   ${f.key}`);
  console.log(
    "\nBu action'lar RLS'i atlayan istemciyi kullanıyor ve hedef kiracıyı\n" +
      "çağırandan alıyor. Kimliği yetki kapısının sonucundan (gate.tenantId)\n" +
      "alın ya da fonksiyonu lib/ altına taşıyıp uç nokta olmaktan çıkarın.",
  );
}

if (acik.length > 0) {
  console.log("");
  console.log("[KAPI YOK] " + acik.length + " action:");
  for (const f of acik) console.log("   " + f.key);
  console.log("");
  console.log("Her Server Action tarayicidan dogrudan cagrilabilir. Kapi ekleyin ya da");
  console.log("bilincli bir istisnaysa scripts/action-gate-audit.ts icindeki MUAF");
  console.log("listesine GEREKCESIYLE ekleyin.");
}

process.exit(1);
