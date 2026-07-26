/**
 * Bağımlılık açığı kapısı (Q3).
 *
 * ============================================================================
 * NEDEN DÜZ `npm audit` DEĞİL
 * ============================================================================
 * CI'da adım `continue-on-error` ile duruyordu, yani hiçbir şeyi bloklamıyordu.
 * Düz `npm audit --audit-level=high` eklemek CI'ı KALICI KIRMIZI yapardı ve
 * kırmızı bir CI hiçbir şey söylemez — herkes görmezden gelmeye başlar.
 *
 * Sebep şu (canlı olarak doğrulandı):
 *
 *   npm audit          → 12 high
 *   npm audit --omit=dev →  3 high
 *
 * Yani 9 tanesi DEV-ONLY (eslint → minimatch/brace-expansion DoS); üretime
 * hiç gitmiyor. Kalan 3'ü Next 16.2.11'in KENDİ iç bağımlılıklarında
 * (`postcss`, `sharp`) ve npm'in önerdiği "düzeltme" şu:
 *
 *   fixAvailable: { name: "next", version: "9.3.3", isSemVerMajor: true }
 *
 * Next 16 → 9.3.3 DÜŞÜRMEK. Uygulamayı yok eder. Next 16.2.12 de aynı
 * `postcss 8.4.31`i taşıyor, yani ileri doğru bir düzeltme henüz yok.
 *
 * ============================================================================
 * BU KAPININ YAPTIĞI
 * ============================================================================
 * Üretim bağımlılıklarındaki high/critical açıkları kontrol eder ve
 * BELGELENMİŞ İSTİSNALAR dışında kalan her şeyde CI'ı kırar. Böylece:
 *
 *   · bugünkü çözümsüz durum CI'ı kalıcı kırmızıya çevirmez
 *   · YENİ bir açık eklendiği anda CI kırılır
 *   · istisnalar gerekçesiyle ve çıkış koşuluyla burada yazılı
 *
 * Çalıştırma:  npm run audit:deps
 */
import { execFileSync } from "node:child_process";

/**
 * Bilinçli istisnalar.
 *
 * Her giriş: paket adı → neden bekletiliyor + bu satırın NE ZAMAN silineceği.
 * Bir istisna eklemek bilinçli bir karar olmalı; süresiz kalmamalı.
 */
const ISTISNALAR: Record<string, string> = {
  next:
    "Next 16.2.11'in kendi ic bagimliliklari (postcss, sharp). Ileri dogru " +
    "duzeltme yok; npm'in onerdigi 'fix' Next 9.3.3'e dusurmek. Next bu " +
    "paketleri bump ettiginde bu satir silinecek.",
  postcss:
    "next tarafindan nested olarak geliyor (8.4.31). Dogrudan bagimlilik " +
    "degil; `overrides` ile zorlamak CI'da `npm ci`yi kirdi (bkz. ROADMAP F3). " +
    "Next kendi surumunu yukselttiginde cikacak.",
  sharp:
    "next tarafindan nested olarak geliyor (0.34.5) — libvips CVE'leri. " +
    "Dogrudan bagimlilik olarak eklemek nested kopyayi degistirmiyor " +
    "(dogrulandi). Next bump edene kadar bekliyor.",
};

type Advisory = {
  name: string;
  severity: string;
  isDirect?: boolean;
  fixAvailable?: boolean | { name: string; version: string; isSemVerMajor?: boolean };
};

function audit(): { vulnerabilities: Record<string, Advisory>; metadata?: { vulnerabilities?: Record<string, number> } } {
  /*
   * `npm audit` acik bulundugunda SIFIR OLMAYAN cikis kodu veriyor, bu yuzden
   * execFileSync throw eder. Hata nesnesinin `stdout`u yine gecerli JSON —
   * onu kullaniyoruz. Yakalamadan gecmek betigi acik VARKEN cokertirdi.
   */
  try {
    const out = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      shell: process.platform === "win32",
    });
    return JSON.parse(out);
  } catch (e) {
    const stdout = (e as { stdout?: string }).stdout;
    if (!stdout) throw e;
    return JSON.parse(stdout);
  }
}

const rapor = audit();
const hepsi = Object.entries(rapor.vulnerabilities ?? {});
const ozet = rapor.metadata?.vulnerabilities ?? {};

console.log(`uretim bagimliliklari (dev haric): ${JSON.stringify(ozet)}`);

/*
 * KAPSAM KORUMASI: `vulnerabilities` anahtari hic yoksa ya rapor bicimi
 * degismis ya npm hata vermis demektir. Bu durumda "temiz" demek YANLIS bir
 * guven verir — bu projede daha once iki denetim tam bu sekilde sessizce
 * gecmisti.
 */
if (!rapor.vulnerabilities) {
  console.error("KAPI GUVENILMEZ: npm audit ciktisinda `vulnerabilities` yok. Rapor bicimi degismis olabilir.");
  process.exit(2);
}

const ciddi = hepsi.filter(([, a]) => a.severity === "high" || a.severity === "critical");
const istisnali = ciddi.filter(([ad]) => ad in ISTISNALAR);
const yeni = ciddi.filter(([ad]) => !(ad in ISTISNALAR));

if (istisnali.length > 0) {
  console.log(`\n[BEKLETILEN] ${istisnali.length} belgelenmis istisna:`);
  for (const [ad, a] of istisnali) {
    console.log(`  ${ad} (${a.severity})`);
    console.log(`     ${ISTISNALAR[ad]}`);
  }
}

// Artik gecerli olmayan istisnalar: listeyi temiz tutar.
const cozulmus = Object.keys(ISTISNALAR).filter((ad) => !ciddi.some(([n]) => n === ad));
if (cozulmus.length > 0) {
  console.log(`\n[ARTIK GEREKSIZ] ${cozulmus.length} istisna cozulmus, ISTISNALAR listesinden silinebilir:`);
  cozulmus.forEach((ad) => console.log(`  ${ad}`));
}

if (yeni.length === 0) {
  console.log("\nYENI high/critical acik YOK.");
  process.exit(0);
}

console.log(`\n[YENI ACIK] ${yeni.length} paket — CI kirildi:`);
for (const [ad, a] of yeni) {
  const fix =
    typeof a.fixAvailable === "object"
      ? `${a.fixAvailable.name}@${a.fixAvailable.version}${a.fixAvailable.isSemVerMajor ? " (MAJOR)" : ""}`
      : a.fixAvailable
        ? "var"
        : "yok";
  console.log(`  ${ad} (${a.severity}) · duzeltme: ${fix}`);
}
console.log("");
console.log("Ya duzeltmeyi uygulayin, ya scripts/audit-gate.ts icindeki");
console.log("ISTISNALAR listesine GEREKCE ve CIKIS KOSULU ile ekleyin.");
process.exit(1);
