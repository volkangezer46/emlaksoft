// Canlı oturumlu hız ölçümü (salt-okunur GET). Çalıştır (Git Bash): MSYS_NO_PATHCONV=1 npx tsx scripts/perf/measure-live.mts [demo-email] ["/app,/app/lig"]
import dotenv from "dotenv";
import { createServerClient } from "@supabase/ssr";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });
const BASE = process.env.BASE || "https://emlaksoft.vercel.app";
const REPS = Number(process.env.REPS || 3);
const email = process.argv[2] || "sahip@demo.emlaksoft.test";
const jar = new Map<string, string>();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const secret = process.env.DEMO_LOGIN_SECRET?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";

const supabase = createServerClient(url, anon, {
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)),
  },
});
const { error } = await supabase.auth.signInWithPassword({ email, password: deriveDemoPassword(secret, email) });
if (error) {
  console.error("giris hatasi:", error.message);
  process.exit(1);
}
const cookie = [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
const pages = (process.argv[3] || "/app,/app/musteriler,/app/portfoyler,/app/talepler,/app/anlasmalar,/app/randevular,/app/gorevler,/app/komisyon,/app/raporlar,/app/lig,/app/giderler,/app/kiralama,/app/aidat,/app/ilan-kontrol,/app/performansim,/app/ekip").split(",");
console.log("sayfa | durum | ttfb ms (3 tur) | toplam ms | server-timing (son tur)");
for (const p of pages) {
  const ttfb: number[] = [];
  const tot: number[] = [];
  let st = "";
  let status = 0;
  for (let i = 0; i < REPS; i++) {
    const t0 = performance.now();
    const res = await fetch(BASE + p, { headers: { cookie, "user-agent": "emlaksoft-perf-probe" }, redirect: "manual" });
    const t1 = performance.now();
    await res.arrayBuffer();
    const t2 = performance.now();
    status = res.status;
    ttfb.push(Math.round(t1 - t0));
    tot.push(Math.round(t2 - t0));
    st = res.headers.get("server-timing") ?? "";
  }
  const sorted = [...tot].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  console.log(`${p} | ${status} | ttfb ${ttfb.join("/")} | toplam ${tot.join("/")} | p95 ${p95} max ${sorted[sorted.length - 1]} | ${st}`);
}
