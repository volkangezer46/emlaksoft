// RSC yük boyutu ölçümü (salt-okunur GET, `RSC: 1`): her sayfa için çözülmüş bayt, ilk bayt ve toplam süre.
// Çalıştır (Git Bash): MSYS_NO_PATHCONV=1 npx tsx scripts/perf/rsc-size.mts ["/app,/app/musteriler"] [base]
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });
const BASE = process.argv[3] || "https://emlaksoft.vercel.app";
const email = "sahip@demo.emlaksoft.test";
const jar = new Map<string, string>();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const secret = process.env.DEMO_LOGIN_SECRET?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
const sb = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) } });
const { error } = await sb.auth.signInWithPassword({ email, password: deriveDemoPassword(secret, email) });
if (error) {
  console.error("giris:", error.message);
  process.exit(1);
}
const cookie = [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
const pages = (process.argv[2] || "/app,/app/musteriler,/app/portfoyler,/app/talepler,/app/anlasmalar,/app/randevular,/app/gorevler,/app/komisyon,/app/raporlar,/app/lig,/app/giderler,/app/kiralama,/app/aidat,/app/ekip").split(",");
console.log("sayfa | KB (çözülmüş) | ttfb ms | toplam ms");
for (const p of pages) {
  const t0 = performance.now();
  const res = await fetch(BASE + p, { headers: { cookie, rsc: "1", "next-url": p, "user-agent": "emlaksoft-perf-probe" }, redirect: "manual" });
  const t1 = performance.now();
  const buf = await res.arrayBuffer();
  const t2 = performance.now();
  console.log(`${p} | ${(buf.byteLength / 1024).toFixed(0)} | ${Math.round(t1 - t0)} | ${Math.round(t2 - t0)} | ${res.status}`);
}
