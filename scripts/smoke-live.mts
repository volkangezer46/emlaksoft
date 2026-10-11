// Dağıtım sonrası SALT-OKUNUR duman testi: demo sahip + danışman oturumuyla /app altındaki dinamik olmayan
// tüm sayfaları GET eder. Denetler: HTTP durumu, hata sınırı metni ("şu anda açılamadı"), yanıt süresi (>2,5 sn uyarı).
// Çalıştır: npm run smoke:live   (BASE=https://... , SMOKE_USERS=a@x,b@y ile değiştirilebilir)
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
      const res = await fetch(BASE + p, { headers: { cookie, "user-agent": "emlaksoft-smoke-live" }, redirect: "manual" });
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
