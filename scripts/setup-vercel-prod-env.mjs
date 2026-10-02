/**
 * Vercel production ortamına, production build'in zorunlu tuttuğu değişkenleri ekler.
 * (src/lib/deployment-env.ts → assertProductionEnvironment)
 *
 * - Rastgele gizli anahtarlar burada üretilir ve ASLA ekrana/dosyaya yazılmaz;
 *   `vercel env add` stdin'ine tam değer (sondaki satır sonu OLMADAN) verilir.
 * - Yalnız eksik değişkenleri ekler; var olanlara dokunmaz (anahtar döndürmek için
 *   önce `npx vercel env rm <AD> production` çalıştırın).
 * - ENABLE_DEMO_LOGIN / ALLOW_PLATFORM_DEMO production'da tanımlıysa build reddeder;
 *   bu script ENABLE_DEMO_LOGIN'i kaldırır.
 *
 * Kullanım (önce `npx vercel login`): node scripts/setup-vercel-prod-env.mjs
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const ENV = "production";
const run = (args, input) =>
  spawnSync("npx", ["vercel", ...args], { input, encoding: "utf8", shell: process.platform === "win32" });

const listed = run(["env", "ls", ENV]);
if (listed.status !== 0) {
  console.error("Vercel env listesi alınamadı. Önce `npx vercel login` çalıştırın.\n" + (listed.stderr || ""));
  process.exit(1);
}
const existing = new Set([...listed.stdout.matchAll(/^\s*([A-Z][A-Z0-9_]+)\s+/gm)].map((m) => m[1]));

const secret = () => randomBytes(32).toString("hex");
const wanted = [
  { name: "OTP_HMAC_SECRET", value: secret, sensitive: true },
  { name: "TWO_FACTOR_COOKIE_SECRET", value: secret, sensitive: true },
  { name: "PROPERTY_MEDIA_SIGNING_SECRET", value: secret, sensitive: true },
  { name: "HEALTHCHECK_SECRET", value: secret, sensitive: true },
  { name: "RELEASE_MIGRATION", value: () => "20260813000000_core_workflow_invariants.sql", sensitive: false },
  { name: "RELEASE_MIGRATION_CHECKSUM", value: () => "dc942330358fb622", sensitive: false },
];

let failed = false;
for (const item of wanted) {
  if (existing.has(item.name)) {
    console.log(`= ${item.name} zaten tanımlı, atlandı`);
    continue;
  }
  const args = ["env", "add", item.name, ENV, ...(item.sensitive ? ["--sensitive"] : [])];
  const res = run(args, item.value());
  if (res.status === 0) console.log(`+ ${item.name} eklendi`);
  else {
    failed = true;
    console.error(`! ${item.name} eklenemedi: ${(res.stderr || res.stdout || "").trim().split("\n").slice(-2).join(" ")}`);
  }
}

if (existing.has("ENABLE_DEMO_LOGIN")) {
  const res = run(["env", "rm", "ENABLE_DEMO_LOGIN", ENV, "--yes"]);
  if (res.status === 0) console.log("- ENABLE_DEMO_LOGIN production'dan kaldırıldı");
  else {
    failed = true;
    console.error("! ENABLE_DEMO_LOGIN kaldırılamadı: " + (res.stderr || "").trim().split("\n").slice(-1));
  }
}
if (existing.has("ALLOW_PLATFORM_DEMO")) {
  const res = run(["env", "rm", "ALLOW_PLATFORM_DEMO", ENV, "--yes"]);
  console.log(res.status === 0 ? "- ALLOW_PLATFORM_DEMO production'dan kaldırıldı" : "! ALLOW_PLATFORM_DEMO kaldırılamadı");
  if (res.status !== 0) failed = true;
}

console.log(failed ? "\nBazı adımlar başarısız; yukarıdaki hataları kontrol edin." : "\nTamam. Production ortamı build için hazır.");
process.exit(failed ? 1 : 0);
