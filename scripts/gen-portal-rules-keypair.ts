/**
 * Öğrenen eklenti kuralları için ECDSA P-256 imza anahtar çifti üretir ve YALNIZ stdout'a basar (dosyaya ya da ortama
 * YAZMAZ). Kullanım:
 *
 *   npx tsx scripts/gen-portal-rules-keypair.ts [kid]      # kid varsayılan: k1
 *
 * Sonra (sahip, elle):
 *   1. Açık JWK → `src/lib/portal-transfer/rule-keys.ts` içindeki RULE_PUBLIC_KEYS'e `{ "<kid>": { ...jwk } }` olarak eklenir
 *      (eklenti paketine gömülür; mağaza paketi gerektirir).
 *   2. PKCS8 PEM → sunucu ortamına PORTAL_RULES_SIGNING_KEY (tek satır için satır sonları `\n` kaçışlı), kid →
 *      PORTAL_RULES_SIGNING_KID. Özel anahtar depoya, veritabanına ya da sohbet/kayıt geçmişine KONMAZ.
 */
import { generateKeyPairSync } from "node:crypto";

const kid = (process.argv[2] ?? "k1").trim();
if (!/^[A-Za-z0-9._-]{1,40}$/.test(kid)) {
  console.error("kid yalnız harf, rakam, nokta, alt çizgi ve tire içerebilir (1-40).");
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

console.log(`# kid: ${kid}`);
console.log("# 1) rule-keys.ts → RULE_PUBLIC_KEYS:");
console.log(JSON.stringify({ [kid]: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } }, null, 2));
console.log("\n# 2) Sunucu ortamı (GİZLİ; yalnız .env.production'a):");
console.log(`PORTAL_RULES_SIGNING_KID=${kid}`);
console.log(`PORTAL_RULES_SIGNING_KEY="${pem.trim().replace(/\n/g, "\\n")}"`);
