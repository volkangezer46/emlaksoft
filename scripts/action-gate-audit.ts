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
  "getPlatformStaff",
  "isPlatformStaff",
  // Ham oturum kontrolu
  "getRequestUser",
];

/**
 * Bilinçli istisnalar: kapısı OLMAMASI gereken action'lar.
 * Her biri gerekçesiyle burada; listeye ekleme yapmak bilinçli bir karar olmalı.
 */
const MUAF: Record<string, string> = {
  "auth.ts::signOut": "Çıkış her durumda çalışmalı; oturumu olmayan için de zararsız.",
  "auth.ts::signIn": "Giriş noktasının kendisi — kapı buradan sonra kuruluyor.",
  "auth.ts::signUp": "Kayıt noktası.",
  "demo-login.ts::quickDemoLogin": "Demo girişi; kendi bayrağıyla (ENABLE_DEMO_LOGIN) korunuyor.",
  "contracts.ts::signContractByToken": "İmza bağlantısı token ile korunuyor, oturum gerektirmez.",
  "contracts.ts::submitSignatureByToken": "Aynı token akışı.",
  "compliance.ts::checkAuthorityShield": "Saf hesap; veriye dokunmuyor.",

  // --- Token ile korunan portal akislari (oturum YOK, olmamali) ---
  "customer-portal.ts::getCustomerPortalData": "Musteri portali token ile acilir; oturum gerektirmez.",
  "owner-portal.ts::getOwnerPortalData": "Malik portali token ile acilir.",
  "payment-links.ts::startPaymentLinkCheckout": "Odeme baglantisi token ile; musteri oturum acmaz.",
  "payment-links.ts::markPaymentLinkPaid": "Ayni token akisi; ayrica iyzico canliysa env bayragiyla kapali.",

  // --- Halka acik form ---
  "demo.ts::requestDemo": "Pazarlama sitesindeki demo talep formu; oturum gerektirmez.",

  // --- Acik referans verisi (kiraciya ozel deger icermez) ---
  "geo.ts::listDistricts": "Turkiye idari bolunusu; geo_* tablolari RLS'te herkese acik okunur.",
  "geo.ts::listNeighborhoods": "Ayni.",
  "geo.ts::searchDistricts": "Ayni.",
  "property-management.ts::getLookupValues": "Kullanici istemcisiyle okur; RLS kiraci ayrimini yapar, oturum yoksa bos doner.",
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

function korumali(key: string, all: Map<string, Fn>, derinlik = 0): boolean {
  const fn = all.get(key);
  if (!fn || derinlik > 2) return false;
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

if (acik.length === 0) {
  console.log("BULGU YOK — hepsinde yetki kapısı var (doğrudan ya da delegasyonla).");
  process.exit(0);
}

console.log(`\n[KAPI YOK] ${acik.length} action:`);
for (const f of acik) console.log(`   ${f.key}`);
console.log(
  "\nHer Server Action tarayıcıdan doğrudan çağrılabilir. Kapı ekleyin ya da\n" +
    "bilinçli bir istisnaysa scripts/action-gate-audit.ts içindeki MUAF listesine\n" +
    "GEREKÇESİYLE ekleyin.",
);
process.exit(1);
