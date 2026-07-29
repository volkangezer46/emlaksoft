/**
 * Demo tenant (slug: demo-ofis) için kapsamlı, idempotent demo verisi üretir.
 * Tüm modülleri doldurur: müşteri, portföy, talep, anlaşma, teklif, sözleşme,
 * komisyon, görev, randevu, çağrı, portal, gider/aidat, kira, proje, hedef,
 * vitrin, bölge istatistikleri, bildirim.
 *
 * Usage: npx tsx scripts/seed-demo.ts   (veya: npm run seed:demo)
 *
 * İdempotentlik: her bölüm tenant'a ait mevcut satır sayısına bakar; hedef
 * sayıya ulaşılmışsa bölüm atlanır. Portföyler tekil property_code, bölge
 * istatistikleri unique kısıt üzerinden upsert ile korunur.
 * ASLA demo-ofis dışındaki bir tenant'a yazmaz.
 */
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik (.env.local)");
  process.exit(1);
}

// --- Kazara prod'a çalıştırma freni ---------------------------------------
// Hedef DB host'u ve tenant slug'ı her koşulda yazdırılır. Host local değilse
// (hosted Supabase = potansiyel prod) SEED_CONFIRM=1 olmadan script ÇIKAR:
// bilinen sabit şifreli demo kullanıcıları prod'a sessizce yazılmasın.
const dbHost = new URL(url).hostname;
const isLocalDb = ["localhost", "127.0.0.1", "0.0.0.0", "kong"].includes(dbHost);
console.log(`Hedef DB: ${dbHost} · hedef tenant: demo-ofis`);
if (!isLocalDb && process.env.SEED_CONFIRM !== "1") {
  console.error(
    `DURDURULDU: '${dbHost}' local bir Supabase değil. Bu hedefe demo verisi yazmak` +
      ` istediğinden eminsen SEED_CONFIRM=1 ile tekrar çalıştır.`,
  );
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

// demo-login.ts ile birebir aynı sabitler (src/app/actions/demo-login.ts)
const DEMO_PASSWORD = "Demo1234!";
const DEMO_TENANT_SLUG = "demo-ofis";
const DEMO_TENANT_NAME = "Demo Emlak Ofisi";

// src/lib/demo-personas.ts'teki ofis kişiliklerinden seed'in kullandıkları
const PERSONAS = [
  { id: "owner", email: "sahip@demo.emlaksoft.test", label: "Ofis sahibi", role: "owner" },
  { id: "gm", email: "mudur@demo.emlaksoft.test", label: "Genel müdür", role: "gm" },
  { id: "advisor", email: "danisman@demo.emlaksoft.test", label: "Danışman", role: "advisor" },
] as const;

type Dict = Record<string, unknown>;

function iso(d: Date) {
  return d.toISOString();
}
function daysFromNow(days: number, hour?: number, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  if (hour !== undefined) d.setHours(hour, minute, 0, 0);
  return d;
}
function monthStart(offset: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function dateOnly(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function insertRows(table: string, rows: Dict[]): Promise<Dict[]> {
  if (rows.length === 0) return [];
  const { data, error } = await admin.from(table).insert(rows).select();
  if (error) throw new Error(`${table} insert: ${error.message}`);
  return data ?? [];
}

async function countRows(table: string, tenantId: string): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`${table} sayım: ${error.message}`);
  return count ?? 0;
}

/** Bölüm hedef satır sayısına ulaşmışsa atlar; değilse üretir. */
async function section(label: string, table: string, tenantId: string, expected: number, fn: () => Promise<number>) {
  const existing = await countRows(table, tenantId);
  if (existing >= expected) {
    console.log(`✓ ${label}: mevcut ${existing} kayıt (atlandı)`);
    return;
  }
  const created = await fn();
  console.log(`✓ ${label}: ${created} kayıt üretildi`);
}

// ---------------------------------------------------------------------------
// Tenant + kullanıcılar (demo-login.ts deseni)
// ---------------------------------------------------------------------------
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
    page += 1;
    if (page > 20) return null;
  }
}

async function ensureTenant(): Promise<string> {
  const { data: existing, error: findErr } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", DEMO_TENANT_SLUG)
    .maybeSingle();
  if (findErr) throw new Error(`tenants sorgu: ${findErr.message}`);
  if (existing?.id) {
    console.log(`✓ Tenant: ${DEMO_TENANT_SLUG} mevcut (${existing.id})`);
    return existing.id;
  }

  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 365);
  const { data: created, error } = await admin
    .from("tenants")
    .insert({
      name: DEMO_TENANT_NAME,
      slug: DEMO_TENANT_SLUG,
      plan: "professional",
      status: "active",
      trial_ends_at: iso(trialEnds),
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Demo tenant oluşturulamadı");

  // Abonelik opsiyonel — çakışırsa yoksay (demo-login.ts ile aynı davranış)
  const { error: subErr } = await admin.from("subscriptions").insert({
    tenant_id: created.id,
    plan: "professional",
    status: "active",
    billing_cycle: "monthly",
    amount_try: 5990,
    current_period_start: iso(new Date()),
  });
  if (subErr) console.warn("  (subscriptions atlandı:", subErr.message + ")");

  console.log(`✓ Tenant: ${DEMO_TENANT_SLUG} oluşturuldu (${created.id})`);
  return created.id;
}

async function ensureProfile(tenantId: string, persona: (typeof PERSONAS)[number]): Promise<string> {
  const meta = { tenant_id: tenantId, role: persona.role };
  let userId: string | null = null;

  const { data, error } = await admin.auth.admin.createUser({
    email: persona.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: persona.label },
    app_metadata: meta,
  });
  if (data.user) {
    userId = data.user.id;
  } else {
    const already = error && /already|registered|exists|duplicate/i.test(error.message ?? "");
    if (!already) throw new Error(error?.message ?? "Demo kullanıcı oluşturulamadı");
    userId = await findAuthUserIdByEmail(persona.email);
    if (!userId) throw new Error(`Auth kullanıcısı bulunamadı: ${persona.email}`);
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password: DEMO_PASSWORD,
      email_confirm: true,
      app_metadata: meta,
    });
    if (updErr) throw new Error(updErr.message);
  }

  const { error: profErr } = await admin.from("profiles").upsert(
    { id: userId, tenant_id: tenantId, full_name: persona.label, role: persona.role, is_active: true },
    { onConflict: "id" },
  );
  if (profErr) throw new Error(`profiles upsert: ${profErr.message}`);
  return userId;
}

// ---------------------------------------------------------------------------
// Coğrafya: İstanbul + Kahramanmaraş il/ilçe kayıtları
// ---------------------------------------------------------------------------
type Geo = {
  istanbulId: string;
  marasId: string;
  kadikoyId: string;
  besiktasId: string;
  maltepeId: string;
  onikisubatId: string;
  dulkadirogluId: string;
};

async function ensureGeo(): Promise<Geo> {
  const { data: provinces, error } = await admin
    .from("geo_provinces")
    .select("id, plate_code")
    .in("plate_code", [34, 46]);
  if (error) throw new Error(`geo_provinces: ${error.message}`);
  const istanbulId = provinces?.find((p) => p.plate_code === 34)?.id;
  const marasId = provinces?.find((p) => p.plate_code === 46)?.id;
  if (!istanbulId || !marasId) throw new Error("İstanbul/Kahramanmaraş geo_provinces'te yok — geo seed migration'ı uygulanmamış");

  async function ensureDistrict(provinceId: string, name: string, lat: number, lng: number): Promise<string> {
    const { data: existing } = await admin
      .from("geo_districts")
      .select("id")
      .eq("province_id", provinceId)
      .eq("name", name)
      .maybeSingle();
    if (existing?.id) return existing.id;
    const { data: created, error: insErr } = await admin
      .from("geo_districts")
      .insert({ province_id: provinceId, name, lat, lng })
      .select("id")
      .single();
    if (insErr || !created) throw new Error(`geo_districts ${name}: ${insErr?.message}`);
    return created.id;
  }

  return {
    istanbulId,
    marasId,
    kadikoyId: await ensureDistrict(istanbulId, "Kadıköy", 40.9917, 29.0273),
    besiktasId: await ensureDistrict(istanbulId, "Beşiktaş", 41.0430, 29.0075),
    maltepeId: await ensureDistrict(istanbulId, "Maltepe", 40.9357, 29.1310),
    onikisubatId: await ensureDistrict(marasId, "Onikişubat", 37.5736, 36.9081),
    dulkadirogluId: await ensureDistrict(marasId, "Dulkadiroğlu", 37.5861, 36.9530),
  };
}

// ---------------------------------------------------------------------------
// Ana akış
// ---------------------------------------------------------------------------
async function main() {
  console.log("— EmlakSoft demo veri üretici —");

  const tenantId = await ensureTenant();
  const ownerId = await ensureProfile(tenantId, PERSONAS[0]);
  const gmId = await ensureProfile(tenantId, PERSONAS[1]);
  const advisorId = await ensureProfile(tenantId, PERSONAS[2]);
  console.log("✓ Profiller: sahip / müdür / danışman hazır");

  const geo = await ensureGeo();
  console.log("✓ Coğrafya: İstanbul + Kahramanmaraş ilçeleri hazır");

  // ---------------- Müşteriler (~25) ----------------
  const CUSTOMERS: Array<Dict> = [
    { full_name: "Ahmet Yılmaz", types: ["Alıcı"], source: "portal_sahibinden", birth: "1985-03-14", email: true },
    { full_name: "Ayşe Kaya", types: ["Alıcı"], source: "tavsiye", birth: "1990-07-22", email: true },
    { full_name: "Mehmet Demir", types: ["Mülk sahibi"], source: "ofis_ziyareti", birth: "1972-11-03", email: false },
    { full_name: "Fatma Şahin", types: ["Mülk sahibi"], source: "telefon", birth: null, email: true },
    { full_name: "Mustafa Çelik", types: ["Yatırımcı"], source: "portal_hepsiemlak", birth: "1968-01-30", email: true },
    { full_name: "Emine Arslan", types: ["Alıcı"], source: "sosyal_medya", birth: "1995-05-18", email: false },
    { full_name: "Ali Koç", types: ["Alıcı", "Yatırımcı"], source: "web_sitesi", birth: null, email: true },
    { full_name: "Zeynep Aydın", types: ["Kiracı"], source: "portal_zingat", birth: "1998-09-09", email: true },
    { full_name: "Hüseyin Öztürk", types: ["Mülk sahibi"], source: "tavsiye", birth: "1960-12-25", email: false },
    { full_name: "Hatice Yıldız", types: ["Alıcı"], source: "portal_sahibinden", birth: null, email: true },
    { full_name: "İbrahim Aslan", types: ["Kiracı"], source: "telefon", birth: "1988-04-02", email: false },
    { full_name: "Elif Doğan", types: ["Alıcı"], source: "portal_emlakjet", birth: "1993-06-11", email: true },
    { full_name: "Osman Kılıç", types: ["Mülk sahibi"], source: "ofis_ziyareti", birth: null, email: false },
    { full_name: "Merve Çetin", types: ["Alıcı"], source: "sosyal_medya", birth: "1996-02-28", email: true },
    { full_name: "Ramazan Kara", types: ["Yatırımcı"], source: "tavsiye", birth: "1975-08-15", email: true },
    { full_name: "Sultan Koçak", types: ["Mülk sahibi"], source: "telefon", birth: null, email: false },
    { full_name: "Yusuf Erdoğan", types: ["Alıcı"], source: "portal_sahibinden", birth: "1982-10-07", email: true },
    { full_name: "Esra Güneş", types: ["Kiracı"], source: "web_sitesi", birth: "1999-01-19", email: true },
    { full_name: "Halil Bozkurt", types: ["Alıcı"], source: "portal_hepsiemlak", birth: null, email: false },
    { full_name: "Selin Taş", types: ["Alıcı"], source: "sosyal_medya", birth: "1994-12-01", email: true },
    { full_name: "Kadir Polat", types: ["Mülk sahibi", "Yatırımcı"], source: "tavsiye", birth: "1970-05-05", email: true },
    { full_name: "Büşra Özkan", types: ["Alıcı"], source: "portal_zingat", birth: null, email: true },
    { full_name: "Emre Şimşek", types: ["Alıcı"], source: "telefon", birth: "1991-03-23", email: false },
    { full_name: "Gamze Korkmaz", types: ["Kiracı"], source: "web_sitesi", birth: "1997-07-30", email: true },
    { full_name: "Serkan Avcı", types: ["Yatırımcı"], source: "ofis_ziyareti", birth: "1979-09-17", email: true },
  ];

  await section("Müşteriler", "customers", tenantId, CUSTOMERS.length, async () => {
    const { data: existing } = await admin.from("customers").select("phone").eq("tenant_id", tenantId);
    const seen = new Set((existing ?? []).map((c) => c.phone));
    const rows = CUSTOMERS.map((c, i) => {
      const phone = `05321000${String(i + 1).padStart(3, "0")}`;
      return { c, i, phone };
    })
      .filter((x) => !seen.has(x.phone))
      .map(({ c, i, phone }) => {
        const inIstanbul = i % 3 !== 2;
        return {
          tenant_id: tenantId,
          full_name: c.full_name,
          phone,
          email: c.email ? `${String(c.full_name).toLowerCase().replace(/[^a-z]+/g, ".")}@ornek.com` : null,
          customer_types: c.types,
          source: c.source,
          lead_source: c.source,
          birth_date: c.birth,
          tags: i % 5 === 0 ? ["vip"] : [],
          notes: i % 4 === 0 ? "Demo müşteri — hafta içi 18:00 sonrası aranmalı." : null,
          province_id: inIstanbul ? geo.istanbulId : geo.marasId,
          district_id: inIstanbul ? (i % 2 === 0 ? geo.kadikoyId : geo.maltepeId) : geo.onikisubatId,
          assigned_to: i % 2 === 0 ? advisorId : ownerId,
          created_by: ownerId,
        };
      });
    return (await insertRows("customers", rows)).length;
  });

  const { data: customersData, error: custErr } = await admin
    .from("customers")
    .select("id, full_name, phone, customer_types")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  if (custErr || !customersData?.length) throw new Error(`customers okunamadı: ${custErr?.message}`);
  const customers = customersData;
  const custByName = (name: string) => customers.find((c) => c.full_name === name)?.id ?? customers[0].id;

  // ---------------- Portföyler (~15, lat/lng + fiyat geçmişi) ----------------
  type PropSeed = {
    code: string; title: string; tx: "Satılık" | "Kiralık"; type: string; status: string;
    price: number; lat: number; lng: number; district: string; rooms: string; m2: number;
    walkPrices?: number[]; // sonradan uygulanan fiyat değişimleri (trigger geçmişe yazar)
    floor?: number; heating?: string; age?: number; // features (uygulama anahtarları: floor/heating/building_age)
    health?: "green" | "yellow" | "red"; // price_health — boş bırakılan "Fiyat bekliyor" örneği kalır
  };
  const PROPS: PropSeed[] = [
    { code: "DEMO-001", title: "Kadıköy Moda'da deniz manzaralı 3+1", tx: "Satılık", type: "Daire", status: "live", price: 12500000, lat: 40.9812, lng: 29.0263, district: "kadikoy", rooms: "3+1", m2: 145, walkPrices: [12200000, 11900000], floor: 4, heating: "Kombi (Doğalgaz)", age: 12, health: "green" },
    { code: "DEMO-002", title: "Kadıköy Fenerbahçe'de yenilenmiş 2+1", tx: "Satılık", type: "Daire", status: "live", price: 9800000, lat: 40.9723, lng: 29.0451, district: "kadikoy", rooms: "2+1", m2: 110, walkPrices: [9500000], floor: 2, heating: "Kombi (Doğalgaz)", age: 8, health: "yellow" },
    { code: "DEMO-003", title: "Beşiktaş Levent'te site içi 4+1", tx: "Satılık", type: "Daire", status: "live", price: 18750000, lat: 41.0782, lng: 29.0174, district: "besiktas", rooms: "4+1", m2: 210, walkPrices: [18250000, 17900000], floor: 7, heating: "Merkezi (Pay ölçer)", age: 3, health: "red" },
    { code: "DEMO-004", title: "Beşiktaş Etiler'de kiralık 1+1 rezidans", tx: "Kiralık", type: "Daire", status: "live", price: 45000, lat: 41.0821, lng: 29.0334, district: "besiktas", rooms: "1+1", m2: 75, floor: 12, heating: "Merkezi (Pay ölçer)", age: 2, health: "green" },
    { code: "DEMO-005", title: "Maltepe sahilde 3+1 ara kat", tx: "Satılık", type: "Daire", status: "live", price: 7250000, lat: 40.9219, lng: 29.1247, district: "maltepe", rooms: "3+1", m2: 130, walkPrices: [6950000], floor: 3, heating: "Kombi (Doğalgaz)", age: 15, health: "green" },
    { code: "DEMO-006", title: "Maltepe'de kiralık 2+1 eşyalı", tx: "Kiralık", type: "Daire", status: "live", price: 27500, lat: 40.9354, lng: 29.1512, district: "maltepe", rooms: "2+1", m2: 95, floor: 1, heating: "Kombi (Doğalgaz)", age: 10, health: "yellow" },
    { code: "DEMO-007", title: "Kadıköy Koşuyolu'nda müstakil ev", tx: "Satılık", type: "Müstakil ev", status: "live", price: 22000000, lat: 41.0034, lng: 29.0392, district: "kadikoy", rooms: "5+2", m2: 320, heating: "Yerden ısıtma", age: 25, health: "red" },
    { code: "DEMO-008", title: "Onikişubat'ta yeni bina 3+1", tx: "Satılık", type: "Daire", status: "live", price: 3450000, lat: 37.5793, lng: 36.9012, district: "onikisubat", rooms: "3+1", m2: 150, walkPrices: [3350000, 3275000], floor: 5, heating: "Kombi (Doğalgaz)", age: 1, health: "green" },
    { code: "DEMO-009", title: "Onikişubat'ta kiralık 2+1", tx: "Kiralık", type: "Daire", status: "live", price: 12000, lat: 37.5688, lng: 36.8934, district: "onikisubat", rooms: "2+1", m2: 115, floor: 2, heating: "Kombi (Doğalgaz)", age: 6, health: "green" },
    { code: "DEMO-010", title: "Dulkadiroğlu'nda 4+1 geniş daire", tx: "Satılık", type: "Daire", status: "live", price: 2950000, lat: 37.5878, lng: 36.9571, district: "dulkadiroglu", rooms: "4+1", m2: 175, floor: 4, heating: "Soba", age: 20, health: "yellow" },
    { code: "DEMO-011", title: "Dulkadiroğlu'nda imarlı arsa", tx: "Satılık", type: "Arsa", status: "live", price: 5600000, lat: 37.5912, lng: 36.9663, district: "dulkadiroglu", rooms: "-", m2: 540 },
    { code: "DEMO-012", title: "Onikişubat'ta işyeri — cadde üstü", tx: "Kiralık", type: "İşyeri", status: "live", price: 35000, lat: 37.5761, lng: 36.9143, district: "onikisubat", rooms: "-", m2: 220, floor: 0, heating: "Klima", age: 10, health: "red" },
    { code: "DEMO-013", title: "Kadıköy Caferağa'da satılık 1+1", tx: "Satılık", type: "Daire", status: "reserved", price: 6900000, lat: 40.9861, lng: 29.0228, district: "kadikoy", rooms: "1+1", m2: 68, floor: 1, heating: "Kombi (Doğalgaz)", age: 30, health: "yellow" },
    { code: "DEMO-014", title: "Maltepe'de satılan 2+1 (referans)", tx: "Satılık", type: "Daire", status: "sold", price: 6400000, lat: 40.9401, lng: 29.1385, district: "maltepe", rooms: "2+1", m2: 105, floor: 3, heating: "Kombi (Doğalgaz)", age: 18, health: "green" },
    { code: "DEMO-015", title: "Beşiktaş Ortaköy'de kiraya verilen 2+1", tx: "Kiralık", type: "Daire", status: "rented", price: 55000, lat: 41.0553, lng: 29.0268, district: "besiktas", rooms: "2+1", m2: 100, floor: 5, heating: "Merkezi", age: 7, health: "green" },
  ];
  // Uygulamanın okuduğu KANONİK feature anahtarları (portal-publish/broşür/
  // property-health ile aynı): rooms, sqm, net_sqm, floor, heating, building_age.
  // Eski seed'in oda/brut_m2/bina_yasi anahtarlarını hiçbir bileşen okumuyordu.
  const featuresOf = (p: PropSeed) => ({
    rooms: p.rooms !== "-" ? p.rooms : null,
    sqm: p.m2,
    net_sqm: Math.round(p.m2 * 0.88),
    floor: p.floor ?? null,
    heating: p.heating ?? null,
    building_age: p.age ?? null,
  });
  const districtId = (k: string) =>
    k === "kadikoy" ? geo.kadikoyId : k === "besiktas" ? geo.besiktasId : k === "maltepe" ? geo.maltepeId : k === "onikisubat" ? geo.onikisubatId : geo.dulkadirogluId;
  const provinceOf = (k: string) => (k === "onikisubat" || k === "dulkadiroglu" ? geo.marasId : geo.istanbulId);

  await section("Portföyler", "properties", tenantId, PROPS.length, async () => {
    const { data: existing } = await admin.from("properties").select("property_code").eq("tenant_id", tenantId);
    const seen = new Set((existing ?? []).map((p) => p.property_code));
    let created = 0;
    for (const p of PROPS) {
      if (seen.has(p.code)) continue;
      // Fiyat yürüyüşü gerçekçi olsun: ilk fiyat = en yüksek (walk dizisinin başı)
      const initialPrice = p.walkPrices?.length ? Math.round(p.price * 1.0) : p.price;
      const { data: ins, error } = await admin
        .from("properties")
        .insert({
          tenant_id: tenantId,
          property_code: p.code,
          title: p.title,
          transaction_type: p.tx,
          property_type: p.type,
          status: p.status,
          list_price: initialPrice,
          min_price: Math.round(p.price * 0.94),
          commission_rate: p.tx === "Satılık" ? 2 : 10,
          lat: p.lat,
          lng: p.lng,
          province_id: provinceOf(p.district),
          district_id: districtId(p.district),
          address_line: `${p.title} — demo adres`,
          features: featuresOf(p),
          price_health: p.health ?? null,
          assigned_to: advisorId,
          created_by: ownerId,
        })
        .select("id")
        .single();
      if (error || !ins) throw new Error(`properties ${p.code}: ${error?.message}`);
      created += 1;
      // Fiyat geçmişi: trigger her list_price güncellemesinde kayıt düşer (2-3 değişim)
      for (const next of p.walkPrices ?? []) {
        const { error: updErr } = await admin
          .from("properties")
          .update({ list_price: next, updated_at: iso(new Date()) })
          .eq("id", ins.id);
        if (updErr) throw new Error(`fiyat güncelleme ${p.code}: ${updErr.message}`);
      }
    }
    return created;
  });

  const { data: propsData, error: propErr } = await admin
    .from("properties")
    .select("id, property_code, status, list_price")
    .eq("tenant_id", tenantId);
  if (propErr || !propsData?.length) throw new Error(`properties okunamadı: ${propErr?.message}`);
  const propByCode = (code: string) => propsData.find((p) => p.property_code === code)?.id ?? propsData[0].id;

  // ---- Zenginleştirme (idempotent) -----------------------------------------
  // Daha önce eski anahtarlarla (oda/brut_m2) ve price_health=null ile
  // seed'lenmiş kayıtları kanonik features + çeşitli fiyat sağlığı değerleriyle
  // günceller. Değerler deterministik olduğundan her çalıştırma aynı sonucu
  // yazar; yeni insert edilen kayıtlar için no-op'tur.
  {
    let enriched = 0;
    for (const p of PROPS) {
      const propId = propsData.find((row) => row.property_code === p.code)?.id;
      if (!propId) continue;
      const { error: enrichErr } = await admin
        .from("properties")
        .update({ features: featuresOf(p), price_health: p.health ?? null })
        .eq("id", propId)
        .eq("tenant_id", tenantId);
      if (enrichErr) throw new Error(`properties zenginleştirme ${p.code}: ${enrichErr.message}`);
      enriched += 1;
    }
    console.log(`  Portföy zenginleştirme: ${enriched} kayıt (features + price_health)`);
  }

  // ---------------- Talepler (9) ----------------
  const DEMANDS = [
    { name: "Ahmet Yılmaz", tx: "Satılık", type: "Daire", min: 8000000, max: 13000000, rooms: "3+1", district: geo.kadikoyId, province: geo.istanbulId, urgency: "yüksek" },
    { name: "Ayşe Kaya", tx: "Satılık", type: "Daire", min: 5000000, max: 8000000, rooms: "2+1", district: geo.maltepeId, province: geo.istanbulId, urgency: "orta" },
    { name: "Mustafa Çelik", tx: "Satılık", type: "Arsa", min: 3000000, max: 7000000, rooms: null, district: geo.dulkadirogluId, province: geo.marasId, urgency: "düşük" },
    { name: "Emine Arslan", tx: "Kiralık", type: "Daire", min: 20000, max: 35000, rooms: "2+1", district: geo.maltepeId, province: geo.istanbulId, urgency: "yüksek" },
    { name: "Ali Koç", tx: "Satılık", type: "Daire", min: 15000000, max: 20000000, rooms: "4+1", district: geo.besiktasId, province: geo.istanbulId, urgency: "orta" },
    { name: "Zeynep Aydın", tx: "Kiralık", type: "Daire", min: 10000, max: 15000, rooms: "2+1", district: geo.onikisubatId, province: geo.marasId, urgency: "yüksek" },
    { name: "Hatice Yıldız", tx: "Satılık", type: "Daire", min: 2500000, max: 3600000, rooms: "3+1", district: geo.onikisubatId, province: geo.marasId, urgency: "orta" },
    { name: "Elif Doğan", tx: "Satılık", type: "Daire", min: 6000000, max: 10000000, rooms: "2+1", district: geo.kadikoyId, province: geo.istanbulId, urgency: "düşük" },
    { name: "Serkan Avcı", tx: "Kiralık", type: "İşyeri", min: 25000, max: 40000, rooms: null, district: geo.onikisubatId, province: geo.marasId, urgency: "orta" },
  ];
  await section("Talepler", "customer_demands", tenantId, DEMANDS.length, async () => {
    const rows = DEMANDS.map((d, i) => ({
      tenant_id: tenantId,
      customer_id: custByName(d.name),
      transaction_type: d.tx,
      property_type: d.type,
      province_id: d.province,
      district_id: d.district,
      budget_min: d.min,
      budget_max: d.max,
      rooms: d.rooms,
      min_sqm: d.type === "Arsa" ? 400 : 90,
      urgency: d.urgency,
      status: i % 4 === 3 ? "matched" : i % 3 === 0 ? "new" : "active",
    }));
    return (await insertRows("customer_demands", rows)).length;
  });

  // ---------------- Anlaşmalar (6, farklı aşamalar + 1 kayıp) ----------------
  await section("Anlaşmalar", "deals", tenantId, 6, async () => {
    const rows = [
      { prop: "DEMO-001", cust: "Ahmet Yılmaz", type: "sale", stage: "negotiation", value: 12000000, prob: 60 },
      { prop: "DEMO-005", cust: "Ayşe Kaya", type: "sale", stage: "qualified", value: 7000000, prob: 40 },
      { prop: "DEMO-014", cust: "Yusuf Erdoğan", type: "sale", stage: "won", value: 6400000, prob: 100 },
      { prop: "DEMO-015", cust: "Esra Güneş", type: "rent", stage: "won", value: 55000, prob: 100 },
      { prop: "DEMO-003", cust: "Ali Koç", type: "sale", stage: "new", value: 18000000, prob: 20 },
      { prop: "DEMO-002", cust: "Halil Bozkurt", type: "sale", stage: "lost", value: 9500000, prob: 0, loss: "Fiyat anlaşmazlığı — alıcı başka ofisten aldı" },
    ].map((d) => ({
      tenant_id: tenantId,
      property_id: propByCode(d.prop),
      customer_id: custByName(d.cust),
      deal_type: d.type,
      stage: d.stage,
      deal_value: d.value,
      probability: d.prob,
      loss_reason: d.loss ?? null,
      assigned_to: advisorId,
    }));
    return (await insertRows("deals", rows)).length;
  });

  // Kayıp Satış Dedektörü demosu için ek kayıp anlaşmalar (çeşitli gerekçeler).
  // section() kullanmıyoruz (deals tablosu paylaşımlı); idempotency loss_reason
  // marker'ıyla: aynı gerekçe zaten varsa atlanır.
  {
    const { data: existingLost } = await admin
      .from("deals")
      .select("loss_reason")
      .eq("tenant_id", tenantId)
      .eq("stage", "lost");
    const seenReasons = new Set((existingLost ?? []).map((d) => d.loss_reason));
    const extra = [
      { prop: "DEMO-004", cust: "Zeynep Aydın", value: 8200000, daysAgo: 12, loss: "Finansman/kredi onaylanmadı" },
      { prop: "DEMO-007", cust: "Mustafa Çelik", value: 15500000, daysAgo: 21, loss: "Fiyat anlaşmazlığı — bütçe yetersiz" },
      { prop: "DEMO-008", cust: "Hatice Yıldız", value: 4300000, daysAgo: 30, loss: "Müşteri karardan vazgeçti" },
    ].filter((d) => !seenReasons.has(d.loss));
    if (extra.length) {
      const rows = extra.map((d) => ({
        tenant_id: tenantId,
        property_id: propByCode(d.prop),
        customer_id: custByName(d.cust),
        deal_type: "sale",
        stage: "lost",
        deal_value: d.value,
        probability: 0,
        loss_reason: d.loss,
        assigned_to: advisorId,
        created_at: iso(daysFromNow(-d.daysAgo, 11)),
      }));
      const n = (await insertRows("deals", rows)).length;
      console.log(`✓ Ek kayıp anlaşmalar: ${n} kayıt üretildi`);
    } else {
      console.log("✓ Ek kayıp anlaşmalar: mevcut (atlandı)");
    }
  }

  const { data: dealsData } = await admin
    .from("deals")
    .select("id, stage, deal_value, deal_type, property_id")
    .eq("tenant_id", tenantId);
  const deals = dealsData ?? [];

  // ---------------- Teklifler + pazarlık turları ----------------
  await section("Teklifler", "offers", tenantId, 2, async () => {
    const offers = await insertRows("offers", [
      {
        tenant_id: tenantId, property_id: propByCode("DEMO-001"), customer_id: custByName("Ahmet Yılmaz"),
        created_by: advisorId, amount: 11500000, status: "countered", counter_amount: 12000000,
        valid_until: dateOnly(daysFromNow(10)), submitted_at: iso(daysFromNow(-5)), responded_at: iso(daysFromNow(-2)),
        notes: "Pazarlık sürüyor — alıcı kredi onayı bekliyor.",
      },
      {
        tenant_id: tenantId, property_id: propByCode("DEMO-014"), customer_id: custByName("Yusuf Erdoğan"),
        created_by: advisorId, amount: 6400000, status: "accepted",
        submitted_at: iso(daysFromNow(-20)), responded_at: iso(daysFromNow(-18)),
      },
    ]);
    const negotiating = offers[0].id as string;
    await insertRows("offer_rounds", [
      { tenant_id: tenantId, offer_id: negotiating, round_no: 1, side: "buyer", amount: 11000000, note: "İlk teklif", created_by: advisorId },
      { tenant_id: tenantId, offer_id: negotiating, round_no: 2, side: "seller", amount: 12200000, note: "Satıcı karşı teklifi", created_by: advisorId },
      { tenant_id: tenantId, offer_id: negotiating, round_no: 3, side: "buyer", amount: 11500000, note: "Alıcı yükseltti", created_by: advisorId },
    ]);
    console.log("  ✓ Pazarlık turları: 3 kayıt");
    return offers.length;
  });

  // ---------------- Sözleşmeler (1 taslak + 1 imza bekleyen) ----------------
  await section("Sözleşmeler", "contracts", tenantId, 2, async () => {
    const contracts = await insertRows("contracts", [
      {
        tenant_id: tenantId, created_by: ownerId, property_id: propByCode("DEMO-001"), customer_id: custByName("Ahmet Yılmaz"),
        contract_type: "satis", title: "Satış Vaadi Sözleşmesi — DEMO-001", status: "draft",
        body: "<p>Taraflar arasında DEMO-001 kodlu taşınmazın satışına ilişkin sözleşme taslağıdır.</p>",
      },
      {
        tenant_id: tenantId, created_by: ownerId, property_id: propByCode("DEMO-015"), customer_id: custByName("Esra Güneş"),
        contract_type: "kira", title: "Kira Sözleşmesi — DEMO-015", status: "sent",
        body: "<p>DEMO-015 kodlu taşınmazın kiralanmasına ilişkin sözleşme. Aylık kira 55.000 TL.</p>",
        expires_at: iso(daysFromNow(14)),
      },
    ]);
    await insertRows("contract_signers", [
      { contract_id: contracts[1].id, full_name: "Esra Güneş", phone: "05321000018", email: "esra.gunes@ornek.com", status: "pending" },
    ]);
    console.log("  ✓ İmzacılar: 1 bekleyen");
    return contracts.length;
  });

  // ---------------- Komisyonlar (tahsil + bekleyen, splits) ----------------
  await section("Komisyonlar", "commissions", tenantId, 2, async () => {
    const wonSale = deals.find((d) => d.stage === "won" && d.deal_type === "sale");
    const negotiation = deals.find((d) => d.stage === "negotiation");
    if (!wonSale || !negotiation) throw new Error("Komisyon için anlaşma bulunamadı");
    const rows = [
      {
        tenant_id: tenantId, deal_id: wonSale.id, gross_amount: 256000, vat_amount: 51200, status: "paid",
        splits: [
          { profile_id: advisorId, name: "Danışman", pct: 50, amount: 128000 },
          { profile_id: ownerId, name: "Ofis", pct: 50, amount: 128000 },
        ],
      },
      {
        tenant_id: tenantId, deal_id: negotiation.id, gross_amount: 240000, vat_amount: 48000, status: "calculated",
        splits: [
          { profile_id: advisorId, name: "Danışman", pct: 60, amount: 144000 },
          { profile_id: ownerId, name: "Ofis", pct: 40, amount: 96000 },
        ],
      },
    ];
    return (await insertRows("commissions", rows)).length;
  });

  // ---------------- Görevler (bugün + geciken) ----------------
  await section("Görevler", "tasks", tenantId, 6, async () => {
    const rows = [
      { title: "Ahmet Yılmaz'ı ara — teklif dönüşü", kind: "call", priority: "high", due: daysFromNow(0, 11), cust: "Ahmet Yılmaz" },
      { title: "DEMO-001 tapu evraklarını hazırla", kind: "document", priority: "high", due: daysFromNow(0, 16), prop: "DEMO-001" },
      { title: "Ayşe Kaya'ya eşleşen portföyleri gönder", kind: "followup", priority: "normal", due: daysFromNow(-2, 10), cust: "Ayşe Kaya" },
      { title: "Kira sözleşmesi imza hatırlatması", kind: "followup", priority: "high", due: daysFromNow(-1, 14), cust: "Esra Güneş" },
      { title: "DEMO-008 yerinde fotoğraf çekimi", kind: "visit", priority: "normal", due: daysFromNow(2, 13), prop: "DEMO-008" },
      { title: "Portal ilan teyitlerini yenile", kind: "other", priority: "low", due: daysFromNow(1, 9) },
    ].map((t) => ({
      tenant_id: tenantId,
      title: t.title,
      kind: t.kind,
      priority: t.priority,
      status: "open",
      due_at: iso(t.due),
      customer_id: t.cust ? custByName(t.cust) : null,
      property_id: t.prop ? propByCode(t.prop) : null,
      assigned_to: advisorId,
      created_by: ownerId,
    }));
    return (await insertRows("tasks", rows)).length;
  });

  // ---------------- Randevular (bugün + hafta içi, showing) ----------------
  await section("Randevular", "appointments", tenantId, 5, async () => {
    const rows = [
      { type: "showing", at: daysFromNow(0, 14), cust: "Ahmet Yılmaz", prop: "DEMO-001", status: "confirmed", loc: "Kadıköy Moda" },
      { type: "showing", at: daysFromNow(0, 17), cust: "Emine Arslan", prop: "DEMO-006", status: "pending", loc: "Maltepe" },
      { type: "showing", at: daysFromNow(1, 11), cust: "Ali Koç", prop: "DEMO-003", status: "confirmed", loc: "Levent" },
      { type: "office", at: daysFromNow(2, 10), cust: "Mehmet Demir", prop: null, status: "pending", loc: "Ofis" },
      { type: "valuation", at: daysFromNow(3, 15), cust: "Kadir Polat", prop: null, status: "confirmed", loc: "Onikişubat" },
    ].map((a) => ({
      tenant_id: tenantId,
      appointment_type: a.type,
      scheduled_at: iso(a.at),
      duration_min: 45,
      location: a.loc,
      status: a.status,
      customer_id: custByName(a.cust),
      property_id: a.prop ? propByCode(a.prop) : null,
      assigned_to: advisorId,
      created_by: ownerId,
    }));
    return (await insertRows("appointments", rows)).length;
  });

  // ---------------- Çağrı kayıtları (son 7 gün) ----------------
  await section("Çağrılar", "calls", tenantId, 8, async () => {
    const specs = [
      { cust: "Ahmet Yılmaz", dir: "outbound", days: 0, dur: 340, disp: "Teklif görüşüldü" },
      { cust: "Ayşe Kaya", dir: "inbound", days: 1, dur: 180, disp: "Yeni portföy sordu" },
      { cust: "Emine Arslan", dir: "outbound", days: 2, dur: 95, disp: "Randevu teyidi" },
      { cust: "Halil Bozkurt", dir: "missed", days: 2, dur: null, disp: "Cevapsız — geri aranacak" },
      { cust: "Zeynep Aydın", dir: "inbound", days: 3, dur: 260, disp: "Kiralık talep detayı" },
      { cust: "Mustafa Çelik", dir: "outbound", days: 4, dur: 420, disp: "Arsa yatırımı görüşmesi" },
      { cust: "Hatice Yıldız", dir: "inbound", days: 5, dur: 130, disp: "Fiyat bilgisi" },
      { cust: "Serkan Avcı", dir: "outbound", days: 6, dur: 210, disp: "İşyeri gösterimi planlandı" },
    ];
    const rows = specs.map((s) => {
      const started = daysFromNow(-s.days, 10 + s.days);
      const cust = customers.find((c) => c.full_name === s.cust);
      return {
        tenant_id: tenantId,
        customer_id: cust?.id ?? null,
        direction: s.dir,
        phone: cust?.phone ?? "05320000000",
        duration_sec: s.dur,
        disposition: s.disp,
        handled_by: advisorId,
        started_at: iso(started),
        ended_at: s.dur ? iso(new Date(started.getTime() + s.dur * 1000)) : null,
      };
    });
    return (await insertRows("calls", rows)).length;
  });

  // ---------------- Portal ilanları (canlı + teyitsiz + 1 kapanış) ----------------
  await section("Portal ilanları", "portal_listings", tenantId, 10, async () => {
    const liveSpecs = [
      { prop: "DEMO-001", portal: "sahibinden", staleDays: 1 },
      { prop: "DEMO-001", portal: "hepsiemlak", staleDays: 2 },
      { prop: "DEMO-002", portal: "sahibinden", staleDays: 0 },
      { prop: "DEMO-003", portal: "sahibinden", staleDays: 3 },
      { prop: "DEMO-005", portal: "hepsiemlak", staleDays: 1 },
      { prop: "DEMO-008", portal: "sahibinden", staleDays: 2 },
      { prop: "DEMO-006", portal: "emlakjet", staleDays: 5 },
      { prop: "DEMO-010", portal: "sahibinden", staleDays: 9 }, // 7 gün+ teyitsiz
      { prop: "DEMO-012", portal: "hepsiemlak", staleDays: 11 }, // 7 gün+ teyitsiz
    ];
    const rows = liveSpecs.map((s, i) => ({
      tenant_id: tenantId,
      property_id: propByCode(s.prop),
      portal_name: s.portal,
      portal_listing_id: `demo-${s.prop.toLowerCase()}-${s.portal}`,
      portal_url: `https://www.${s.portal}.com/ilan/demo-${1000 + i}`,
      status: "live",
      published_at: iso(daysFromNow(-30 + i)),
      last_confirmed_at: iso(daysFromNow(-s.staleDays)),
      published_by: advisorId,
    }));
    const created = await insertRows("portal_listings", rows);

    // Kapanış: DEMO-014 satıldı, portal ilanı kaldırıldı + kayıp/kaçak kaydı
    const removed = await insertRows("portal_listings", [{
      tenant_id: tenantId,
      property_id: propByCode("DEMO-014"),
      portal_name: "sahibinden",
      portal_listing_id: "demo-demo-014-sahibinden",
      status: "removed",
      published_at: iso(daysFromNow(-60)),
      last_confirmed_at: iso(daysFromNow(-20)),
      removed_at: iso(daysFromNow(-15)),
      removal_reason: "İlan portalda kapandı — satış ofisimiz üzerinden gerçekleşti",
      removal_meta: { closed_by_us: true, estimated_lost_commission: 0 },
      published_by: advisorId,
    }]);
    await insertRows("listing_closures", [{
      tenant_id: tenantId,
      portal_listing_id: removed[0].id,
      reason: "İlan portalda kapandı — satış ofisimiz üzerinden gerçekleşti",
      deal_happened: true,
      deal_amount: 6400000,
      closed_by_us: true,
      competitor_closed: false,
      estimated_lost_commission: 0,
      created_by: ownerId,
    }]);
    console.log("  ✓ Kapanış kaydı: 1");
    return created.length + removed.length;
  });

  // ---------------- Giderler + aidat ----------------
  await section("Giderler", "expenses", tenantId, 5, async () => {
    const rows = [
      { category: "reklam", title: "Sahibinden doping paketi", amount: 4500, days: -3 },
      { category: "ofis", title: "Ofis kirası (Temmuz)", amount: 35000, days: -20 },
      { category: "ulasim", title: "Gösterim yakıt gideri", amount: 1800, days: -5, prop: "DEMO-008" },
      { category: "egitim", title: "Danışman satış eğitimi", amount: 6000, days: -12 },
      { category: "diger", title: "Tapu harç ödemesi (iade edilecek)", amount: 2250, days: -8, prop: "DEMO-014" },
    ].map((e) => ({
      tenant_id: tenantId,
      created_by: ownerId,
      property_id: e.prop ? propByCode(e.prop) : null,
      category: e.category,
      title: e.title,
      amount: e.amount,
      expense_date: dateOnly(daysFromNow(e.days)),
      notes: "Demo gider kaydı",
    }));
    return (await insertRows("expenses", rows)).length;
  });

  await section("Aidatlar", "property_dues", tenantId, 3, async () => {
    const rows = [
      { prop: "DEMO-004", title: "Rezidans aidatı", amount: 8500, status: "paid", period: monthStart(0) },
      { prop: "DEMO-006", title: "Site aidatı", amount: 2400, status: "unpaid", period: monthStart(0) },
      { prop: "DEMO-015", title: "Apartman aidatı", amount: 1900, status: "unpaid", period: monthStart(-1) },
    ].map((d) => ({
      tenant_id: tenantId,
      created_by: ownerId,
      property_id: propByCode(d.prop),
      title: d.title,
      amount: d.amount,
      period: d.period,
      due_date: d.period,
      status: d.status,
      paid_at: d.status === "paid" ? iso(daysFromNow(-4)) : null,
    }));
    return (await insertRows("property_dues", rows)).length;
  });

  // ---------------- Kira modülü (2 kira + tahakkuk + bakım) ----------------
  await section("Kiralar", "rentals", tenantId, 2, async () => {
    const rentals = await insertRows("rentals", [
      {
        tenant_id: tenantId, property_id: propByCode("DEMO-015"), renter_customer_id: custByName("Esra Güneş"),
        monthly_rent: 55000, due_day: 5, start_date: monthStart(-3), deposit: 110000, status: "active",
        notes: "Demo kira sözleşmesi — Ortaköy 2+1", created_by: ownerId,
      },
      {
        tenant_id: tenantId, property_id: propByCode("DEMO-009"), renter_customer_id: custByName("Zeynep Aydın"),
        monthly_rent: 12000, due_day: 10, start_date: monthStart(-2), deposit: 24000, status: "active",
        notes: "Demo kira sözleşmesi — Onikişubat 2+1", created_by: ownerId,
      },
    ]);
    await insertRows("rent_charges", [
      { tenant_id: tenantId, rental_id: rentals[0].id, period: monthStart(-1), amount: 55000, status: "paid", paid_at: iso(daysFromNow(-25)) },
      { tenant_id: tenantId, rental_id: rentals[0].id, period: monthStart(0), amount: 55000, status: "pending" },
      { tenant_id: tenantId, rental_id: rentals[1].id, period: monthStart(-1), amount: 12000, status: "overdue" },
      { tenant_id: tenantId, rental_id: rentals[1].id, period: monthStart(0), amount: 12000, status: "pending" },
    ]);
    await insertRows("maintenance_requests", [
      {
        tenant_id: tenantId, rental_id: rentals[0].id, title: "Kombi arızası",
        description: "Kiracı kombinin ısıtmadığını bildirdi — servis yönlendirilecek.",
        status: "in_progress", created_by: ownerId,
      },
    ]);
    console.log("  ✓ Kira tahakkukları: 4 (1 gecikmiş) · Bakım talebi: 1");
    return rentals.length;
  });

  // ---------------- Proje + daire stoğu ----------------
  await section("Projeler", "projects", tenantId, 1, async () => {
    const project = await insertRows("projects", [{
      tenant_id: tenantId,
      name: "Marmara Panorama Konutları",
      developer_name: "Demir İnşaat",
      location: "Maltepe, İstanbul",
      district_id: geo.maltepeId,
      delivery_date: dateOnly(daysFromNow(365)),
      description: "2 blok, 24 daire — deniz manzaralı demo projesi.",
      status: "selling",
      created_by: ownerId,
    }]);
    const projectId = project[0].id as string;
    const units: Dict[] = [];
    const soldCustomers = ["Ramazan Kara", "Serkan Avcı", "Kadir Polat", "Ali Koç"];
    let soldIdx = 0;
    for (const block of ["A", "B"]) {
      for (let i = 0; i < 12; i++) {
        const floor = Math.floor(i / 2) + 1;
        const unitNo = `${floor}${i % 2 === 0 ? "A" : "B"}`;
        const idx = (block === "A" ? 0 : 12) + i;
        // Karışık durumlar: satılmış / kapora / rezerve / süresi geçmiş rezerve / boş
        let status = "available";
        let customer: string | null = null;
        let reservedUntil: string | null = null;
        let soldAt: string | null = null;
        if (idx % 6 === 0) {
          status = "sold";
          customer = soldCustomers[soldIdx++ % soldCustomers.length];
          soldAt = iso(daysFromNow(-10 - idx));
        } else if (idx % 6 === 1) {
          status = "reserved";
          customer = "Merve Çetin";
          reservedUntil = iso(daysFromNow(idx === 1 ? -3 : 7)); // idx 1: süresi geçmiş rezervasyon
        } else if (idx % 6 === 2) {
          status = "deposit";
          customer = "Emre Şimşek";
        }
        units.push({
          tenant_id: tenantId,
          project_id: projectId,
          block,
          floor,
          unit_no: unitNo,
          rooms: i % 3 === 0 ? "3+1" : "2+1",
          gross_m2: i % 3 === 0 ? 145 : 110,
          list_price: (i % 3 === 0 ? 5200000 : 4100000) + floor * 150000,
          status,
          customer_id: customer ? custByName(customer) : null,
          reserved_until: reservedUntil,
          sold_at: soldAt,
        });
      }
    }
    const createdUnits = await insertRows("project_units", units);
    console.log(`  ✓ Daire stoğu: ${createdUnits.length} (2 blok × 12)`);
    return project.length;
  });

  // ---------------- Hedefler (bu ay: danışman + ofis) ----------------
  await section("Hedefler", "targets", tenantId, 2, async () => {
    const rows = [
      {
        tenant_id: tenantId, profile_id: advisorId, period: "monthly", period_start: monthStart(0),
        target_deals: 4, target_revenue: 600000, actual_deals: 2, actual_revenue: 256000,
        notes: "Danışman aylık hedefi (demo)",
      },
      {
        tenant_id: tenantId, profile_id: null, period: "monthly", period_start: monthStart(0),
        target_deals: 10, target_revenue: 1500000, actual_deals: 3, actual_revenue: 311000,
        notes: "Ofis geneli aylık hedef (demo)",
      },
    ];
    return (await insertRows("targets", rows)).length;
  });

  // ---------------- Vitrin kayıtlı aramaları ----------------
  await section("Vitrin aramaları", "vitrin_saved_searches", tenantId, 2, async () => {
    const rows = [
      {
        tenant_id: tenantId, name: "Deniz Yalçın", phone: "05335550101", tx_type: "satilik",
        province_id: geo.istanbulId, district_id: geo.kadikoyId, min_price: 8000000, max_price: 13000000, rooms: "3+1",
      },
      {
        tenant_id: tenantId, name: "Canan Ergin", phone: "05335550102", tx_type: "kiralik",
        province_id: geo.marasId, district_id: geo.onikisubatId, max_price: 15000, rooms: "2+1",
      },
    ];
    return (await insertRows("vitrin_saved_searches", rows)).length;
  });

  // ---------------- Bölge istatistik tarihçesi (son 6 ay, 2 ilçe) ----------------
  {
    const rows: Dict[] = [];
    for (let m = 5; m >= 0; m--) {
      const t = 5 - m; // 0..5 — trend katsayısı
      rows.push({
        tenant_id: tenantId, district_id: geo.kadikoyId, period: monthStart(-m), tx_type: "Tümü",
        median_sqm_price: 78000 + t * 2800, active_count: 6 + (t % 3), avg_days_listed: 48 - t * 3, closed_count: t % 2,
      });
      rows.push({
        tenant_id: tenantId, district_id: geo.onikisubatId, period: monthStart(-m), tx_type: "Tümü",
        median_sqm_price: 21500 + t * 900, active_count: 3 + (t % 2), avg_days_listed: 62 - t * 4, closed_count: (t + 1) % 2,
      });
    }
    const { error } = await admin
      .from("region_stats_history")
      .upsert(rows, { onConflict: "tenant_id,district_id,period,tx_type" });
    if (error) throw new Error(`region_stats_history: ${error.message}`);
    console.log(`✓ Bölge istatistikleri: ${rows.length} kayıt (upsert, son 6 ay × 2 ilçe)`);
  }

  // ---------------- Destek talepleri ----------------
  await section("Destek talepleri", "support_tickets", tenantId, 4, async () => {
    const rows = [
      { subject: "Fatura PDF'i inmiyor", body: "Abonelik faturasının PDF indirme butonu hata veriyor.", category: "billing", priority: "high", status: "open", created_by: ownerId, resolved_at: null as string | null },
      { subject: "Portal ilanı Sahibinden'e gitmedi", body: "DEMO-003 ilanını yayınladım ama Sahibinden'de görünmüyor.", category: "bug", priority: "urgent", status: "in_progress", created_by: advisorId, resolved_at: null as string | null },
      { subject: "WhatsApp şablonu önerisi", body: "Randevu hatırlatma için hazır bir şablon eklenebilir mi?", category: "feature", priority: "normal", status: "waiting", created_by: advisorId, resolved_at: null as string | null },
      { subject: "KVKK aydınlatma metni güncellemesi", body: "Yeni mevzuata göre metni güncellemek istiyoruz.", category: "compliance", priority: "normal", status: "resolved", created_by: ownerId, resolved_at: iso(daysFromNow(-2, 15)) },
    ].map((t) => ({ tenant_id: tenantId, ...t }));
    return (await insertRows("support_tickets", rows)).length;
  });

  // ---------------- Kampanyalar (SMS/WhatsApp) ----------------
  await section("Kampanyalar", "campaigns", tenantId, 3, async () => {
    const specs: Array<{
      title: string; channel: "sms" | "whatsapp"; message: string; status: string;
      sent?: number; failed?: number; sentDaysAgo?: number; scheduledDaysAhead?: number;
    }> = [
      { title: "Bahar fırsat portföyleri", channel: "sms", message: "Kadıköy'de yeni satılık daireler yayında! Detay için bize dönün.", status: "done", sent: 24, failed: 1, sentDaysAgo: 6 },
      { title: "Kiralık stok duyurusu", channel: "whatsapp", message: "Yeni kiralık portföylerimiz hazır. Bilgi için yanıtlayın.", status: "scheduled", scheduledDaysAhead: 2 },
      { title: "Yatırımcı bülteni", channel: "sms", message: "Ataşehir arsa yatırım fırsatı — sınırlı sayıda.", status: "draft" },
    ];
    let n = 0;
    for (const s of specs) {
      const total = s.sent != null ? s.sent + (s.failed ?? 0) : 0;
      const [camp] = await insertRows("campaigns", [{
        tenant_id: tenantId, created_by: ownerId, title: s.title, channel: s.channel, message: s.message,
        status: s.status, total_count: total, sent_count: s.sent ?? 0, failed_count: s.failed ?? 0,
        scheduled_at: s.scheduledDaysAhead != null ? iso(daysFromNow(s.scheduledDaysAhead, 10)) : null,
        sent_at: s.sentDaysAgo != null ? iso(daysFromNow(-s.sentDaysAgo, 11)) : null,
      }]);
      n++;
      if (s.status === "done" && camp) {
        const recips = customers.slice(0, 4).map((c, i) => ({
          campaign_id: camp.id, customer_id: c.id, phone: c.phone ?? "05320000000", full_name: c.full_name,
          status: i === 0 ? "failed" : "sent", sent_at: iso(daysFromNow(-(s.sentDaysAgo ?? 6), 11)),
        }));
        await insertRows("campaign_recipients", recips);
      }
    }
    return n;
  });

  // ---------------- Otomasyonlar ----------------
  await section("Otomasyonlar", "automations", tenantId, 3, async () => {
    const specs: Array<{
      name: string; description: string; trigger_type: string; status: string;
      trigger_config?: Dict; run_count?: number; lastRunDaysAgo?: number;
    }> = [
      { name: "Yeni talebe 5 dk'da dokunuş", description: "Yeni talep gelince danışmana görev + müşteriye karşılama mesajı.", trigger_type: "new_demand", status: "active", run_count: 18, lastRunDaysAgo: 0 },
      { name: "14 gün sessiz müşteriyi hatırlat", description: "14 gündür iletişim olmayan sıcak müşteriler için takip görevi aç.", trigger_type: "no_contact_days", trigger_config: { days: 14 }, status: "active", run_count: 7, lastRunDaysAgo: 1 },
      { name: "Yetki bitişine 30 gün kala uyar", description: "Portföy yetki belgesi dolmadan danışmanı uyar.", trigger_type: "auth_expiring", trigger_config: { days: 30 }, status: "draft", run_count: 0 },
    ];
    let n = 0;
    for (const s of specs) {
      const [auto] = await insertRows("automations", [{
        tenant_id: tenantId, created_by: ownerId, name: s.name, description: s.description,
        trigger_type: s.trigger_type, trigger_config: s.trigger_config ?? {}, conditions: [], actions: [{ type: "create_task" }],
        status: s.status, run_count: s.run_count ?? 0,
        last_run_at: s.lastRunDaysAgo != null ? iso(daysFromNow(-s.lastRunDaysAgo, 9)) : null,
      }]);
      n++;
      if ((s.run_count ?? 0) > 0 && auto) {
        await insertRows("automation_logs", [{
          automation_id: auto.id, tenant_id: tenantId, entity_type: "customer", result: "ok",
          actions_taken: [{ type: "create_task", ok: true }],
        }]);
      }
    }
    return n;
  });

  // ---------------- Açık ev günleri ----------------
  await section("Açık ev günleri", "open_houses", tenantId, 3, async () => {
    const specs: Array<{ prop: string; daysAhead: number; hour: number; loc: string; max: number; status: string; visitors: string[] }> = [
      { prop: "DEMO-001", daysAhead: 2, hour: 13, loc: "Kadıköy Moda", max: 20, status: "planned", visitors: [] },
      { prop: "DEMO-006", daysAhead: -3, hour: 14, loc: "Maltepe", max: 15, status: "completed", visitors: ["Emine Arslan", "Ali Koç", "Zeynep Aydın"] },
      { prop: "DEMO-003", daysAhead: 0, hour: 16, loc: "Levent", max: 25, status: "active", visitors: ["Mehmet Demir"] },
    ];
    let n = 0;
    for (const s of specs) {
      const [oh] = await insertRows("open_houses", [{
        tenant_id: tenantId, property_id: propByCode(s.prop), created_by: advisorId,
        scheduled_at: iso(daysFromNow(s.daysAhead, s.hour)), duration_min: 120, location: s.loc,
        notes: "Kapıda kimlik ile giriş.", max_visitors: s.max, visitor_count: s.visitors.length, status: s.status,
      }]);
      n++;
      if (s.visitors.length && oh) {
        const vis = s.visitors.map((name) => {
          const c = customers.find((x) => x.full_name === name);
          return { open_house_id: oh.id, full_name: name, phone: c?.phone ?? null, notes: "Ziyaret etti", created_customer_id: c?.id ?? null, registered_at: iso(daysFromNow(s.daysAhead, s.hour + 1)) };
        });
        await insertRows("open_house_visitors", vis);
      }
    }
    return n;
  });

  // ---------------- Tavsiyeler (referral) ----------------
  await section("Tavsiyeler", "referrals", tenantId, 4, async () => {
    const specs: Array<{ name: string; phone: string; by: string; status: string; note?: string; daysAgo: number }> = [
      { name: "Selin Aksoy", phone: "05330001122", by: "Ahmet Yılmaz", status: "yeni", note: "Kadıköy'de 2+1 kiralık arıyor.", daysAgo: 1 },
      { name: "Burak Şahin", phone: "05340002233", by: "Ayşe Kaya", status: "iletisim", note: "Yatırımlık daire.", daysAgo: 4 },
      { name: "Deniz Yalçın", phone: "05350003344", by: "Emine Arslan", status: "musteri", note: "Ofisten arandı, müşteri kaydı açıldı.", daysAgo: 9 },
      { name: "Onur Kılıç", phone: "05360004455", by: "Ahmet Yılmaz", status: "kazanildi", note: "Maltepe 3+1 satışıyla sonuçlandı.", daysAgo: 18 },
    ];
    const rows = specs.map((s) => ({
      tenant_id: tenantId,
      referrer_customer_id: customers.find((c) => c.full_name === s.by)?.id ?? null,
      referred_name: s.name,
      referred_phone: s.phone,
      referred_note: s.note ?? null,
      status: s.status,
      handled_by: advisorId,
      created_at: iso(daysFromNow(-s.daysAgo, 10)),
    }));
    return (await insertRows("referrals", rows)).length;
  });

  // ---------------- Onay talepleri ----------------
  await section("Onay talepleri", "approval_requests", tenantId, 4, async () => {
    const specs: Array<{
      kind: string; title: string; description: string; amount?: number;
      current?: number; requested?: number; status: string; daysAgo: number; note?: string;
    }> = [
      { kind: "komisyon_indirimi", title: "DEMO-001 komisyon indirimi", description: "Müşteri sadakati için komisyon %3 → %2.5 talebi.", current: 3, requested: 2.5, status: "bekliyor", daysAgo: 1 },
      { kind: "gider", title: "Vitrin reklam bütçesi", description: "Sahibinden vitrin paketi için ek bütçe.", amount: 4500, status: "bekliyor", daysAgo: 2 },
      { kind: "fiyat_degisikligi", title: "DEMO-006 fiyat güncellemesi", description: "Piyasa geri bildirimiyle liste fiyatı düşürülsün.", current: 5200000, requested: 4950000, status: "onaylandi", daysAgo: 6, note: "Piyasa uygun, onaylandı." },
      { kind: "ozel_izin", title: "Hafta sonu ek gösterim izni", description: "Cumartesi 3 ek gösterim için mesai onayı.", status: "bekliyor", daysAgo: 0 },
    ];
    const rows = specs.map((s) => ({
      tenant_id: tenantId,
      kind: s.kind,
      title: s.title,
      description: s.description,
      amount: s.amount ?? null,
      current_value: s.current ?? null,
      requested_value: s.requested ?? null,
      status: s.status,
      requested_by: advisorId,
      decided_by: s.status === "onaylandi" ? ownerId : null,
      decided_at: s.status === "onaylandi" ? iso(daysFromNow(-s.daysAgo + 1, 12)) : null,
      decision_note: s.note ?? null,
      created_at: iso(daysFromNow(-s.daysAgo, 9)),
    }));
    return (await insertRows("approval_requests", rows)).length;
  });

  // ---------------- Duyurular ----------------
  await section("Duyurular", "announcements", tenantId, 3, async () => {
    const rows = [
      { level: "success", title: "Temmuz rekoru!", body: "Bu ay 6 satış kapattık — geçen ayın 2 katı. Herkese teşekkürler 🎉", pinned: true, daysAgo: 1 },
      { level: "info", title: "Yeni portal entegrasyonu", body: "Artık ilanlarınızı tek tıkla Sahibinden ve Hepsiemlak'a gönderebilirsiniz.", pinned: false, daysAgo: 4 },
      { level: "warning", title: "İYS izin kontrolü", body: "Toplu mesaj öncesi müşteri İYS izinlerini kontrol edin; izinsiz gönderim yasal risk.", pinned: false, daysAgo: 8 },
    ].map((a) => ({
      tenant_id: tenantId,
      title: a.title,
      body: a.body,
      level: a.level,
      pinned: a.pinned,
      starts_at: iso(daysFromNow(-a.daysAgo, 9)),
      created_by: ownerId,
      created_at: iso(daysFromNow(-a.daysAgo, 9)),
    }));
    return (await insertRows("announcements", rows)).length;
  });

  // ---------------- İYS izinleri (uyum merkezi) ----------------
  await section("İYS izinleri", "iys_consents", tenantId, 18, async () => {
    const channels = ["sms", "whatsapp"] as const;
    const rows: Dict[] = [];
    customers.slice(0, 12).forEach((c, i) => {
      channels.forEach((ch, j) => {
        // Durum dağılımı: çoğu izinli, bir kısmı ret/bekleyen → kanal risk rozetleri
        // ve uyum zaman çizelgesi anlamlı görünsün.
        const mod = (i + j) % 5;
        const status = mod === 0 ? "denied" : mod === 1 ? "pending" : "granted";
        rows.push({
          tenant_id: tenantId,
          customer_id: c.id,
          channel: ch,
          status,
          source: status === "granted" ? "form" : status === "denied" ? "iys_sorgu" : "panel",
          granted_at: status === "granted" ? iso(daysFromNow(-(10 + i), 10)) : null,
          revoked_at: status === "denied" ? iso(daysFromNow(-(3 + i), 14)) : null,
        });
      });
    });
    return (await insertRows("iys_consents", rows)).length;
  });

  // ---------------- Bildirimler ----------------
  await section("Bildirimler", "notifications", tenantId, 3, async () => {
    const rows = [
      {
        tenant_id: tenantId, user_id: advisorId, kind: "warning",
        title: "Portal ilan teyidi gecikti",
        body: "DEMO-010 ve DEMO-012 ilanları 7 günden uzun süredir teyit edilmedi.",
        href: "/app/portallar",
      },
      {
        tenant_id: tenantId, user_id: advisorId, kind: "info",
        title: "Bugün 2 gösterim randevunuz var",
        body: "14:00 Kadıköy Moda (Ahmet Yılmaz) · 17:00 Maltepe (Emine Arslan)",
        href: "/app/randevular",
      },
      {
        tenant_id: tenantId, user_id: ownerId, kind: "success",
        title: "Komisyon tahsil edildi",
        body: "DEMO-014 satışının 256.000 TL komisyonu tahsil edildi.",
        href: "/app/komisyon",
      },
    ];
    return (await insertRows("notifications", rows)).length;
  });

  console.log("— Demo veri üretimi tamamlandı —");
  console.log(`Tenant: ${DEMO_TENANT_NAME} (${DEMO_TENANT_SLUG}) · ${tenantId}`);
  console.log(`Giriş: ${PERSONAS.map((p) => p.email).join(" / ")} · parola: ${DEMO_PASSWORD}`);
  void gmId; // gm profili giriş için hazırlanır; veri üretiminde doğrudan kullanılmaz
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
