// RSC yükünü dosyaya yazar (analiz için). Kullanım: MSYS_NO_PATHCONV=1 npx tsx scripts/perf/rsc-dump.mts /app/musteriler out.txt
import dotenv from "dotenv";
import { writeFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { deriveDemoPassword } from "../../src/lib/demo-credentials.ts";

dotenv.config({ path: ".env.local", quiet: true });
const BASE = process.env.PERF_BASE || "https://emlaksoft.vercel.app";
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
const res = await fetch(BASE + process.argv[2], { headers: { cookie, rsc: "1" } });
writeFileSync(process.argv[3], Buffer.from(await res.arrayBuffer()));
