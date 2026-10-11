// Dağıtım sonrası SALT-OKUNUR duman testi: demo sahip + danışman oturumuyla /app altındaki dinamik olmayan
// tüm sayfaları GET eder. Denetler: HTTP durumu, hata sınırı metni ("şu anda açılamadı"), yanıt süresi (>2,5 sn uyarı).
// Çalıştır: npm run smoke:live   (BASE=https://... , SMOKE_USERS=a@x,b@y ile değiştirilebilir)
// Yük koruması: SMOKE_DELAY_MS=300 (istekler arası bekleme), SMOKE_MAX_REQUESTS=400 (toplam sınır), 429/5xx'te geri çekilme.
// Çıkış kodu: 1 = en az bir hata (durum >=400, hata sınırı, oturum düştü); yavaş sayfa yalnız uyarıdır.
import dotenv from "dotenv";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { deriveDemoPassword } from "../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });

const BASE = (process.env.BASE || "https://emlaksoft.vercel.app").replace(/\/$/, "");
const SLOW_MS = Number(process.env.SLOW_MS || 2500);
const USERS = (process.env.SMOKE_USERS || "sahip@demo.emlaksoft.test,danisman@demo.emlaksoft.test").split(",");
const ERROR_TEXT = "şu anda açılamadı";
// Canlıya yük bindirmemek için (docs/HAFIZA.md 2026-10-11 Supabase yük dersi): istekler arası bekleme
// (SMOKE_DELAY_MS, varsayılan 300), toplam istek sınırı (SMOKE_MAX_REQUESTS, varsayılan 400),
// 429/5xx'te üstel geri çekilme.
const DELAY_MS = Number(process.env.SMOKE_DELAY_MS || 300);
const MAX_REQUESTS = Number(process.env.SMOKE_MAX_REQUESTS || 400);
let requestCount = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bekleme + sınır + 429/5xx geri çekilmesiyle GET; sınır aşılırsa null döner. */
async function politeFetch(input: string, init: RequestInit): Promise<Response | null> {
  let backoff = 2000;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (requestCount >= MAX_REQUESTS) return null;
    requestCount++;
    await sleep(DELAY_MS);
    const res = await fetch(input, init);
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt === 2) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : backoff);
    backoff *= 2;
  }
  return null;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const secret =
  process.env.DEMO_LOGIN_SECRET?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";

/** src/app/app altındaki dinamik segmentsiz (köşeli parantezsiz) page.tsx yolları; route group URL'e girmez. */
function staticPages(): string[] {
  const root = join(process.cwd(), "src", "app", "app");
  const out: string[] = [];
  const rec = (dir: string, segs: string[]) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name.startsWith("_") || e.name.startsWith("[") || e.name.startsWith("@")) continue;
        rec(join(dir, e.name), e.name.startsWith("(") ? segs : [...segs, e.name]);
      } else if (e.name === "page.tsx") out.push(["/app", ...segs].join("/"));
    }
  };
  rec(root, []);
  return out.sort();
}

async function login(email: string): Promise<string> {
  const jar = new Map<string, string>();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password: deriveDemoPassword(secret, email) });
  if (error) throw new Error(`${email} girişi başarısız: ${error.message}`);
  return [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
}

const pages = staticPages();
let failures = 0;
let slow = 0;
console.log(`Duman testi: ${BASE} | ${pages.length} sayfa | kullanıcılar: ${USERS.join(", ")}`);

for (const email of USERS) {
  let cookie: string;
  try {
    cookie = await login(email);
  } catch (e) {
    console.error(String((e as Error).message));
    failures++;
    continue;
  }
  console.log(`\n== ${email}`);
  for (const p of pages) {
    const t0 = performance.now();
    let status = 0;
    let note = "";
    let bad = false;
    try {
      const res = await politeFetch(BASE + p, { headers: { cookie, "user-agent": "emlaksoft-smoke-live" }, redirect: "manual" });
      if (!res) {
        console.log(`\nİstek sınırı doldu (SMOKE_MAX_REQUESTS=${MAX_REQUESTS}); kalan sayfalar atlandı.`);
        console.log(`Özet: ${failures} hata, ${slow} yavaş uyarı`);
        process.exit(failures > 0 ? 1 : 0);
      }
      const body = await res.text();
      const ms = Math.round(performance.now() - t0);
      status = res.status;
      const loc = res.headers.get("location") ?? "";
      if (status >= 300 && status < 400) {
        // Yetki/paket kapısı başka yere yönlendirebilir (normal); oturum düşmesi (/giris) hatadır.
        if (/\/giris/.test(loc)) {
          bad = true;
          note = `oturum yok -> ${loc}`;
        } else note = `yönlendirme -> ${loc}`;
      } else if (status >= 400) {
        bad = true;
        note = "HTTP hatası";
      } else if (body.includes(ERROR_TEXT)) {
        bad = true;
        note = `hata sınırı: "${ERROR_TEXT}"`;
      }
      const isSlow = ms > SLOW_MS;
      if (isSlow) slow++;
      if (bad) failures++;
      if (bad || isSlow || note) console.log(`${bad ? "HATA " : isSlow ? "YAVAŞ" : "bilgi"} ${p} | ${status} | ${ms} ms ${note}`);
    } catch (e) {
      failures++;
      console.log(`HATA  ${p} | istek başarısız: ${(e as Error).message}`);
    }
  }
}

console.log(`\nÖzet: ${failures} hata, ${slow} yavaş uyarı (> ${SLOW_MS} ms)`);
process.exit(failures > 0 ? 1 : 0);
