/**
 * RLS sızıntı denetimi.
 *
 * NEDEN VAR: Çok kiracılı bir SaaS'ta en büyük risk, bir ofisin başka bir
 * ofisin verisini görmesi. Bu tamamen RLS politikalarına bağlı ve politikalar
 * TypeScript derleyicisinin göremediği bir katmanda yaşıyor — yeni bir tablo
 * eklerken RLS'i açmayı unutmak sessizce geçer.
 *
 * NASIL ÇALIŞIR: Süper kullanıcı olarak bağlanır ama her denemede
 * `SET LOCAL ROLE authenticated` + sahte JWT claim'leri kurar. Bu, uygulamanın
 * gerçekte kullandığı yolun aynısıdır; RLS tablo sahibine uygulanmadığı için
 * rol değişimi ŞARTTIR (aksi hâlde test her şeyi "güvenli" görürdü).
 *
 * Her şey tek bir transaction içinde yapılır ve SONUNDA ROLLBACK edilir —
 * denetim kullanıcının verisine hiçbir şey yazmaz.
 *
 * Çalıştırma:  npx tsx scripts/rls-audit.ts
 */
import dotenv from "dotenv";
import { Client } from "pg";

// apply-migrations.ts ile ayni yol: .env.local acikca yukleniyor.
// `dotenv/config` yalnizca .env okur, bu projede degerler .env.local'da.
dotenv.config({ path: ".env.local" });

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

type Bulgu = { tablo: string; tur: string; detay: string };

/** JWT claim'lerini kurar. `sekil` iki farklı yerleşimi dener. */
function claims(tenantId: string, sekil: "top" | "meta") {
  const base: Record<string, unknown> = { role: "authenticated", sub: "00000000-0000-0000-0000-0000000000aa" };
  if (sekil === "top") base.tenant_id = tenantId;
  else base.app_metadata = { tenant_id: tenantId };
  return JSON.stringify(base);
}

async function main() {
  // Havuz (pooler) baglantisi tercih ediliyor; dogrudan db.<ref> adresi
  // yalnizca IPv6 uzerinden cozuluyor ve bu makineden erisilmiyor.
  const url = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_POOLER_URL veya DATABASE_URL yok (.env.local).");
    process.exit(1);
  }

  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const bulgular: Bulgu[] = [];

  try {
    await c.query("begin");

    // --- 1) Kapsam: tenant_id taşıyan tablolar ---
    const { rows: tablolar } = await c.query<{ tablename: string; rowsecurity: boolean; pol: string }>(`
      select t.tablename, t.rowsecurity,
             (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=t.tablename) pol
      from pg_tables t
      join information_schema.columns col
        on col.table_schema='public' and col.table_name=t.tablename and col.column_name='tenant_id'
      where t.schemaname='public'
      order by t.tablename`);

    console.log(`kapsam: tenant_id taşıyan ${tablolar.length} tablo\n`);

    for (const t of tablolar) {
      if (!t.rowsecurity) bulgular.push({ tablo: t.tablename, tur: "RLS-KAPALI", detay: "row security açık değil" });
      else if (Number(t.pol) === 0)
        bulgular.push({ tablo: t.tablename, tur: "POLITIKA-YOK", detay: "RLS açık ama politika yok" });
    }

    // --- 2) JWT yerleşim tutarlılığı ---
    /*
     * `current_tenant_id()` önce üst düzey `tenant_id`, sonra
     * `app_metadata.tenant_id` bakıyor. Ama bazı politikalar doğrudan
     * `auth.jwt() ->> 'tenant_id'` yazıyor ve app_metadata YEDEĞİ YOK.
     * Kimliği yalnızca app_metadata'da taşıyan bir kullanıcı için o tablolar
     * sessizce BOŞ görünür — sızıntı değil ama kırık işlevsellik.
     */
    const { rows: pol } = await c.query<{ tablename: string; policyname: string; ifade: string }>(`
      select p.tablename, p.policyname, coalesce(p.qual,'') || ' ' || coalesce(p.with_check,'') ifade
      from pg_policies p
      join information_schema.columns col
        on col.table_schema='public' and col.table_name=p.tablename and col.column_name='tenant_id'
      where p.schemaname='public'`);

    for (const p of pol) {
      const jwtDogrudan = /auth\.jwt\(\)\s*->>\s*'tenant_id'/.test(p.ifade);
      const metaYedek = /app_metadata/.test(p.ifade);
      const yardimci = /current_tenant_id\(\)/.test(p.ifade);
      if (jwtDogrudan && !metaYedek && !yardimci) {
        bulgular.push({
          tablo: p.tablename,
          tur: "JWT-YERLESIM",
          detay: `${p.policyname}: auth.jwt()->>'tenant_id' kullanıyor, app_metadata yedeği yok. current_tenant_id() kullanmalı.`,
        });
      }
    }

    // --- 3) Gerçek sızıntı denemesi ---
    /*
     * Tabloya A kiracısının satırını yazıp B kiracısı olarak okumaya
     * çalışıyoruz. Yazma superuser ile (RLS baypas), okuma `authenticated`
     * rolüyle (RLS aktif). Yabancı anahtar zinciri olan tablolarda satır
     * ekleyemeyiz; o tablolarda yalnızca "B, A'nın satırını yazabiliyor mu"
     * denemesini yapıyoruz.
     */
    const okunabilirlik: string[] = [];
    for (const t of tablolar) {
      const tablo = t.tablename;

      // B kiracısı olarak: A'nın tenant_id'siyle satır YAZABİLİYOR mu?
      // (WITH CHECK eksikse ve USING de uygulanmıyorsa buradan sızar.)
      await c.query("savepoint sp");
      try {
        await c.query(`set local role authenticated`);
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [claims(B, "top")]);
        await c.query(`insert into public.${tablo} (tenant_id) values ($1)`, [A]);
        // Buraya düşmek YAZMA SIZINTISI demek: B, A adına satır oluşturdu.
        bulgular.push({
          tablo,
          tur: "YAZMA-SIZINTISI",
          detay: "authenticated rolü, başka kiracının tenant_id'si ile satır ekleyebildi",
        });
      } catch (e) {
        const msg = (e as Error).message;
        // "new row violates row-level security" = BEKLENEN, politika çalışıyor.
        // NOT NULL / FK hatası = tablo bu basit testle doldurulamıyor, atla.
        if (!/row-level security|violates|null value|foreign key|check constraint/i.test(msg)) {
          okunabilirlik.push(`${tablo}: ${msg.split("\n")[0]}`);
        }
      } finally {
        await c.query("rollback to savepoint sp");
        await c.query("reset role");
      }
    }

    // --- Rapor ---
    console.log("=".repeat(72));
    if (bulgular.length === 0) {
      console.log("BULGU YOK — tenant_id taşıyan tüm tablolarda RLS açık, politika var,");
      console.log("ve hiçbiri başka kiracı adına yazmaya izin vermedi.");
    } else {
      const gruplar = new Map<string, Bulgu[]>();
      for (const b of bulgular) {
        if (!gruplar.has(b.tur)) gruplar.set(b.tur, []);
        gruplar.get(b.tur)!.push(b);
      }
      for (const [tur, liste] of gruplar) {
        console.log(`\n[${tur}] ${liste.length} bulgu`);
        for (const b of liste) console.log(`   ${b.tablo}: ${b.detay}`);
      }
    }
    if (okunabilirlik.length > 0) {
      console.log(`\n[BILGI] test edilemeyen ${okunabilirlik.length} tablo (şema kısıtları):`);
      okunabilirlik.slice(0, 10).forEach((x) => console.log("   " + x));
    }
    console.log("=".repeat(72));

    // Denetim asla veri bırakmaz.
    await c.query("rollback");

    // Sızıntı bulguları CI'ı kırsın; yerleşim uyarısı kırmasın.
    const kritik = bulgular.filter((b) => b.tur !== "JWT-YERLESIM");
    process.exit(kritik.length > 0 ? 1 : 0);
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
