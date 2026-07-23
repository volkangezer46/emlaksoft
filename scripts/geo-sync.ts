/**
 * Geo sync — Türkiye'nin 81 ili, 973 ilçesi ve 32.000+ mahallesini
 * TurkiyeAPI (https://turkiyeapi.dev, MIT) statik veri setinden çekip
 * geo_provinces / geo_districts / geo_neighborhoods tablolarına idempotent
 * şekilde upsert eder. Doğrudan Postgres bağlantısı kullanır (DATABASE_URL /
 * DATABASE_POOLER_URL) — Supabase REST/PostgREST üzerinden 32k satırlık toplu
 * upsert yapmak yerine, hız ve güvenilirlik için pg client tercih edildi.
 *
 * Çalıştırma: npm run geo:sync
 * Kaynak: TurkiyeAPI v2 statik veri seti (quarterly güncellenir).
 *         https://api.turkiyeapi.dev/v2/datasets/{provinces,districts,neighborhoods}.json
 *
 * Var olan pilot il/ilçe/mahalle satırları isim eşleşmesiyle (province_id+name,
 * district_id+name) korunur — id'ler değişmez, sadece eksik alanlar
 * (source_id, population, postal_code, lat/lng) zenginleştirilir.
 */
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const DATASET_BASE = "https://api.turkiyeapi.dev/v2/datasets";

type ApiProvince = {
  id: number;
  name: string;
  population?: number;
  region?: { tr?: string };
  coordinates?: { latitude?: number; longitude?: number };
};

type ApiDistrict = {
  id: number;
  name: string;
  provinceId: number;
  population?: number;
};

type ApiNeighborhood = {
  id: number;
  name: string;
  provinceId: number;
  districtId: number;
  population?: number;
  postalCode?: string;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`${DATASET_BASE}/${name}`);
  if (!res.ok) throw new Error(`${name} indirilemedi: ${res.status}`);
  return (await res.json()) as T;
}

async function getClient(): Promise<pg.Client> {
  const urls = [process.env.DATABASE_POOLER_URL, process.env.DATABASE_URL].filter(Boolean) as string[];
  if (urls.length === 0) throw new Error("DATABASE_POOLER_URL veya DATABASE_URL eksik");

  for (const url of urls) {
    const client = new pg.Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await client.connect();
      console.log("DB bağlantısı OK:", url.replace(/:[^:@]+@/, ":****@"));
      return client;
    } catch (err) {
      console.log("DB bağlantı denemesi başarısız:", String(err).slice(0, 160));
    }
  }
  throw new Error("Hiçbir DB bağlantısı çalışmadı");
}

async function syncProvinces(client: pg.Client, provinces: ApiProvince[]) {
  console.log(`İl senkronu: ${provinces.length} kayıt...`);
  for (const p of provinces) {
    await client.query(
      `update public.geo_provinces
         set name = $2,
             lat = coalesce($3, lat),
             lng = coalesce($4, lng),
             population = $5,
             region = $6
       where plate_code = $1`,
      [p.id, p.name, p.coordinates?.latitude ?? null, p.coordinates?.longitude ?? null, p.population ?? null, p.region?.tr ?? null],
    );
  }
  const { rows } = await client.query("select id, plate_code from public.geo_provinces");
  const map = new Map<number, string>();
  for (const r of rows) map.set(r.plate_code, r.id);
  console.log(`İl haritası hazır: ${map.size} il.`);
  return map;
}

async function syncDistricts(client: pg.Client, districts: ApiDistrict[], provinceMap: Map<number, string>) {
  console.log(`İlçe senkronu: ${districts.length} kayıt...`);
  let upserted = 0;
  for (const batch of chunk(districts, 300)) {
    const values: unknown[] = [];
    const rows: string[] = [];
    let i = 1;
    for (const d of batch) {
      const provinceId = provinceMap.get(d.provinceId);
      if (!provinceId) continue;
      rows.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
      values.push(provinceId, d.name, d.id, d.population ?? null);
    }
    if (rows.length === 0) continue;
    await client.query(
      `insert into public.geo_districts (province_id, name, source_id, population)
       values ${rows.join(",")}
       on conflict (province_id, name)
       do update set source_id = excluded.source_id, population = excluded.population`,
      values,
    );
    upserted += rows.length;
  }
  console.log(`İlçe upsert tamam: ${upserted} kayıt.`);

  const { rows } = await client.query(
    "select id, source_id from public.geo_districts where source_id is not null",
  );
  const map = new Map<number, string>();
  for (const r of rows) map.set(r.source_id, r.id);
  console.log(`İlçe haritası hazır: ${map.size} ilçe.`);
  return map;
}

async function syncNeighborhoods(client: pg.Client, neighborhoods: ApiNeighborhood[], districtMap: Map<number, string>) {
  console.log(`Mahalle senkronu: ${neighborhoods.length} kayıt...`);

  // Kaynak veri setinde aynı ilçe içinde aynı isimli mükerrer mahalle satırları var
  // (farklı source_id, aynı ad) — tek INSERT komutunda aynı çakışma hedefine iki kez
  // dokunmak Postgres tarafından reddedilir, bu yüzden (districtId, name) bazında
  // dedupe edip son kaydı (en güncel source_id) esas alıyoruz.
  const dedupMap = new Map<string, ApiNeighborhood>();
  for (const n of neighborhoods) {
    dedupMap.set(`${n.districtId}::${n.name}`, n);
  }
  const deduped = [...dedupMap.values()];
  console.log(`Mahalle dedupe: ${neighborhoods.length} -> ${deduped.length} benzersiz (ilçe, isim).`);

  let upserted = 0;
  let skipped = 0;
  for (const batch of chunk(deduped, 500)) {
    const values: unknown[] = [];
    const rows: string[] = [];
    let i = 1;
    for (const n of batch) {
      const districtId = districtMap.get(n.districtId);
      if (!districtId) {
        skipped += 1;
        continue;
      }
      rows.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
      values.push(districtId, n.name, n.id, n.postalCode ?? null, n.population ?? null);
    }
    if (rows.length === 0) continue;
    await client.query(
      `insert into public.geo_neighborhoods (district_id, name, source_id, postal_code, population)
       values ${rows.join(",")}
       on conflict (district_id, name)
       do update set source_id = excluded.source_id, postal_code = excluded.postal_code, population = excluded.population`,
      values,
    );
    upserted += rows.length;
  }
  console.log(`Mahalle upsert tamam: ${upserted} kayıt, atlanan: ${skipped}.`);
}

async function main() {
  console.log("Kaynak: TurkiyeAPI v2 statik veri seti (81 il / 973 ilçe / 32.000+ mahalle).");

  const [provinces, districts, neighborhoods] = await Promise.all([
    fetchJson<ApiProvince[]>("provinces.json"),
    fetchJson<ApiDistrict[]>("districts.json"),
    fetchJson<ApiNeighborhood[]>("neighborhoods.json"),
  ]);
  console.log(`İndirildi: ${provinces.length} il, ${districts.length} ilçe, ${neighborhoods.length} mahalle.`);

  const client = await getClient();
  try {
    const provinceMap = await syncProvinces(client, provinces);
    const districtMap = await syncDistricts(client, districts, provinceMap);
    await syncNeighborhoods(client, neighborhoods, districtMap);

    const counts = await client.query(
      `select
         (select count(*)::int from public.geo_provinces) as il,
         (select count(*)::int from public.geo_districts) as ilce,
         (select count(*)::int from public.geo_neighborhoods) as mahalle`,
    );
    console.log("Son durum:", counts.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
