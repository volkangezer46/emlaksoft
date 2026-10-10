// Server action desenlerinin GERÇEK ağ gecikmesiyle önce/sonra ölçümü (salt-okunur: yalnız head/select sorgusu).
// Çalıştır (Git Bash): MSYS_NO_PATHCONV=1 npx tsx scripts/perf/measure-action-patterns.mts
//
// Ölçülen desenler (her biri gerçek Supabase PostgREST tur süresiyle):
//  1) Yetki kapısı: ÖNCE 3 ardışık tur (yetki -> modül -> duraklatma)  /  SONRA Promise.all (tek tur süresi)
//  2) Yan etkiler: ÖNCE yanıttan ÖNCE 3 await (audit, otomasyon, playbook)  /  SONRA after() = yanıt süresine 0 ms
//  3) Toplu aşama (100 kayıt x 2 tur: oku + RPC yerine okuma): ÖNCE ardışık  /  SONRA 6'lı sınırlı eşzamanlılık
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local", quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const turn = async () => {
  const { error } = await sb.from("tenants").select("id", { head: true, count: "estimated" }).limit(1);
  if (error) throw new Error(error.message);
};
const time = async (fn: () => Promise<void>) => {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rep = async (n: number, fn: () => Promise<void>) => {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(await time(fn));
  return Math.round(median(xs));
};

await turn(); // ısınma (TLS/bağlantı)
const single = await rep(7, turn);
console.log(`tek tur (medyan): ${single} ms`);

const gateBefore = await rep(5, async () => {
  await turn();
  await turn();
  await turn();
});
const gateAfter = await rep(5, async () => {
  await Promise.all([turn(), turn(), turn()]);
});
console.log(`yetki kapısı: once ${gateBefore} ms -> sonra ${gateAfter} ms`);

const sideBefore = await rep(5, async () => {
  await turn(); // audit
  await turn(); // otomasyon
  await turn(); // playbook
});
const sideAfter = await rep(5, async () => {
  /* after(): yanıt yolunda bekleme yok */
});
console.log(`yan etkiler (yanit suresine eklenen): once ${sideBefore} ms -> sonra ${sideAfter} ms`);

const N = Number(process.env.N || 100);
const perRecord = async () => {
  await turn();
  await turn();
};
const bulkBefore = await rep(1, async () => {
  for (let i = 0; i < N; i++) await perRecord();
});
const bulkAfter = await rep(1, async () => {
  let cursor = 0;
  const worker = async () => {
    while (cursor < N) {
      cursor++;
      await perRecord();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
});
console.log(`toplu asama ${N} kayit: once (ardisik) ${bulkBefore} ms -> sonra (6'li) ${bulkAfter} ms`);
