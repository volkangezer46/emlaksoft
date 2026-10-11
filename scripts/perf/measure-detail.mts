// Detay/yönetici sayfa ölçümü (salt-okunur GET). Yerel `next start` (EMLAKSOFT_SERVER_TIMING=1, log SERVER_LOG) + canlı Supabase.
// Çalıştır: SERVER_LOG=/tmp/server.log BASE=http://localhost:3100 npx tsx scripts/perf/measure-detail.mts [email] ["@ilk:/app/musteriler,/admin"]
// Çıktı: sayfa | tur süreleri | DB tur | bölüm süreleri | HTML(RSC gömülü) KB. İstekler arası >=1 sn, sayfa başına 3 tur.
import dotenv from "dotenv";
import fs from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });
const BASE = process.env.BASE || "http://localhost:3100";
const LOG = process.env.SERVER_LOG || "/tmp/server.log";
const email = process.argv[2] || "sahip@demo.emlaksoft.test";
const jar = new Map<string, string>();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const secret = process.env.DEMO_LOGIN_SECRET?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
const supabase = createServerClient(url, anon, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) },
});
const { error } = await supabase.auth.signInWithPassword({ email, password: deriveDemoPassword(secret, email) });
if (error) {
  console.error("giris hatasi:", error.message);
  process.exit(1);
}
const cookie = [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const logSize = () => (fs.existsSync(LOG) ? fs.statSync(LOG).size : 0);
const readFrom = (pos: number) => fs.readFileSync(LOG).subarray(pos).toString("utf8");
const pages = (process.argv[3] || "").split(",").filter(Boolean);
for (let i = 0; i < pages.length; i++) {
  const m = /^@ilk:(\/(?:app|admin)\/[a-z-]+)$/.exec(pages[i]);
  if (!m) continue;
  const html = await (await fetch(BASE + m[1], { headers: { cookie }, redirect: "manual" })).text();
  const hit = new RegExp(`${m[1]}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`).exec(html);
  pages[i] = hit ? `${m[1]}/${hit[1]}` : m[1];
  await sleep(1000);
}
console.log("sayfa | durum | tur süreleri ms | sıcak DB tur | bölümler (son tur) | HTML(RSC gömülü) KB");
for (const p of pages) {
  const times: number[] = [];
  let last = "";
  let status = 0;
  let turs = 0;
  let rsc = 0;
  let depth = 0;
  for (let i = 0; i < 3; i++) {
    await sleep(1100);
    const pos = logSize();
    const t0 = performance.now();
    const res = await fetch(BASE + p, { headers: { cookie }, redirect: "manual" });
    const chunks: Uint8Array[] = [];
    const reader = res.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const buf = { byteLength: chunks.reduce((n, c) => n + c.byteLength, 0) };
    times.push(Math.round(performance.now() - t0));
    status = res.status; if (res.status >= 300 && i === 0) console.log("  yönlendirme ->", res.headers.get("location"));
    rsc = Math.round(buf.byteLength / 1024);
    await sleep(150);
    const lines = readFrom(pos).split("\n").filter((l) => l.includes("[server-timing]"));
    turs = lines.filter((l) => /db-/.test(l)).length;
    // DB derinliği: bitiş zamanlarını 40 ms'den yakın olanları aynı dalga sayarak kümeler (sıralı tur sayısı ~ derinlik).
    const ends = lines.map((l) => Number(/bitis=(\d+)/.exec(l)?.[1] ?? 0)).filter(Boolean).sort((a, b) => a - b);
    depth = ends.reduce((n, e, k) => (k === 0 || e - ends[k - 1] > 40 ? n + 1 : n), 0);
    const dup = new Map<string, number>();
    for (const l of lines) {
      const n = /db-([a-z0-9-]+)/.exec(l)?.[1];
      if (n) dup.set(n, (dup.get(n) ?? 0) + 1);
    }
    const dups = [...dup].filter(([, c]) => c > 1).map(([n, c]) => `${n}x${c}`).join(",");
    last = `dalga=${depth} tekrar[${dups}] ` + lines.map((l) => l.replace("[server-timing] ", "").replace(/ bitis=\d+/, "").replace(";dur=", "=")).join(" ");
  }
  console.log(`${p} | ${status} | toplam ${times.join("/")} | ${turs} | ${last.slice(0, 700)} | ${rsc}`);
}
