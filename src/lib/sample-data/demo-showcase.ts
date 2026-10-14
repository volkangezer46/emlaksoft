/**
 * DEMO VİTRİN ZENGİNLEŞTİRMESİ (YD1; SAF — ağ/DB yok). `scripts/seed-demo.ts` (demo-ofis) bu verilerle müşteriye giden
 * çıktıları (broşür, sunum, paylaş, vitrin) gerçek kalitede doldurur: ilan açıklaması (`features.description`, tek okuma
 * `readPropertyDescription`), mahalle, örnek görseller (sunucuda SVG → WebP üretilir, harici kaynak/lisans yok; görselin
 * üzerinde "Örnek görsel" yazar), danışman/ofis telefonu ve geçmiş tarihli satış zaman çizelgesi.
 * Yalnız demo-ofis içindir: `sample:true` örnek veri akışı (Demo veriyle başla) bu modülü KULLANMAZ.
 */

export type ShowcaseProperty = {
  code: string;
  title: string;
  tx: "Satılık" | "Kiralık";
  type: string;
  rooms: string;
  m2: number;
  floor?: number;
  heating?: string;
  age?: number;
  district: string;
};

/** Portföy kodu → mahalle adı (geo_neighborhoods.name; ilçe içinde aranır, bulunmazsa atlanır). */
export const DEMO_NEIGHBORHOODS: Readonly<Record<string, string>> = {
  "DEMO-001": "Caferağa",
  "DEMO-002": "Fenerbahçe",
  "DEMO-003": "Levent",
  "DEMO-004": "Etiler",
  "DEMO-005": "Altayçeşme",
  "DEMO-006": "Bağlarbaşı",
  "DEMO-007": "Koşuyolu",
  "DEMO-008": "Atatürk",
  "DEMO-009": "Barbaros",
  "DEMO-010": "Acıbadem",
  "DEMO-011": "Beylerbeyi",
  "DEMO-012": "Atatürk",
  "DEMO-013": "Caferağa",
  "DEMO-014": "Cevizli",
  "DEMO-015": "Ortaköy",
  "DEMO-016": "Fenerbahçe",
  "DEMO-017": "Altayçeşme",
  "DEMO-018": "Barbaros",
  "DEMO-019": "Kuzguncuk",
};

const DISTRICT_LABEL: Readonly<Record<string, string>> = {
  kadikoy: "Kadıköy",
  besiktas: "Beşiktaş",
  maltepe: "Maltepe",
  atasehir: "Ataşehir",
  uskudar: "Üsküdar",
  sisli: "Şişli",
};

/** Demo kişiliklerinin telefonları (saklama biçimi `05XXXXXXXXX`; müşteri numaralarıyla çakışmaz). */
export const DEMO_STAFF_PHONES: Readonly<Record<"owner" | "gm" | "advisor", string>> = {
  owner: "05321009901",
  gm: "05321009902",
  advisor: "05321009903",
};
/** Ofis sabit hattı (İstanbul Anadolu, `0XXXXXXXXXX`). */
export const DEMO_OFFICE_PHONE = "02165550100";

/**
 * Kapanmış portföylerin zaman çizelgesi: kapanış kaç gün önce. Portföy kaydı kapanıştan 90 gün önce açılmış, ertesi
 * gün yayına alınmış sayılır. Böylece listede "satıldı" portföyün tarihi bugünden SONRA görünmez (eski seed gelecek
 * tarihli created_at bırakıyordu).
 */
export const DEMO_CLOSED_TIMELINE: Readonly<Record<string, number>> = {
  "DEMO-014": 20,
  "DEMO-015": 30,
  "DEMO-016": 135,
  "DEMO-017": 100,
  "DEMO-018": 70,
  "DEMO-019": 45,
};

const DAY_MS = 86_400_000;

export function closedTimeline(code: string, nowMs: number): { createdAt: string; publishedAt: string; closedAt: string } | null {
  const days = DEMO_CLOSED_TIMELINE[code];
  if (days === undefined) return null;
  const closed = nowMs - days * DAY_MS;
  return {
    createdAt: new Date(closed - 90 * DAY_MS).toISOString(),
    publishedAt: new Date(closed - 89 * DAY_MS).toISOString(),
    closedAt: new Date(closed).toISOString(),
  };
}

/** İlan açıklaması (deterministik; 5000 karakter sınırının çok altında). */
export function demoDescription(p: ShowcaseProperty): string {
  const district = DISTRICT_LABEL[p.district] ?? "İstanbul";
  const hood = DEMO_NEIGHBORHOODS[p.code];
  const place = hood ? `${district} ${hood} Mahallesi` : district;
  const rent = p.tx === "Kiralık";
  if (p.type === "Arsa") {
    return [
      `${p.title}.`,
      `${place}'nde ${p.m2.toLocaleString("tr-TR")} m² ${rent ? "kiralık" : "satılık"} arsa. İmar durumu ve tapu bilgileri ofisimizde incelenmeye hazırdır.`,
      "Ana yola yakın, altyapısı tamamlanmış bölgede; yatırım ve konut projesi için uygundur.",
      "Parsel sorgusu ve yer gösterimi için ofisimizden randevu alabilirsiniz.",
    ].join("\n\n");
  }
  if (p.type === "İşyeri") {
    return [
      `${p.title}.`,
      `${place}'nde cadde üstünde ${p.m2} m² ${rent ? "kiralık" : "satılık"} işyeri. Geniş vitrin cephesi, yüksek tavan ve kolay erişim.`,
      `${p.heating ? `Isıtma/soğutma: ${p.heating}. ` : ""}Mağaza, ofis, showroom ve hizmet işletmeleri için uygundur.`,
      "Kira sözleşmesi ve yer gösterimi için ofisimizle iletişime geçin.",
    ].join("\n\n");
  }
  const facts: string[] = [];
  if (p.rooms && p.rooms !== "-") facts.push(p.rooms);
  facts.push(`${p.m2} m² brüt (${Math.round(p.m2 * 0.88)} m² net)`);
  const building: string[] = [];
  if (p.floor !== undefined) building.push(p.floor === 0 ? "giriş katında" : `${p.floor}. katta`);
  if (p.age !== undefined) building.push(p.age <= 2 ? "yeni binada" : `${p.age} yaşındaki binada`);
  return [
    `${p.title}.`,
    `${place}'nde ${facts.join(", ")} ${rent ? "kiralık" : "satılık"} ${p.type.toLocaleLowerCase("tr-TR")}.${building.length ? ` Daire ${building.join(", ")} yer alıyor.` : ""}`,
    `${p.heating ? `Isıtma: ${p.heating}. ` : ""}Aydınlık salon, kullanışlı mutfak ve ferah odalar; ulaşım, okul ve alışveriş noktalarına yürüme mesafesinde.`,
    rent
      ? "Kira bedeli, depozito ve sözleşme koşulları için ofisimizden bilgi alabilirsiniz."
      : "Tapu ve iskân bilgileri hazırdır; kredi uygunluğu ve yer gösterimi için ofisimizden randevu alabilirsiniz.",
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Örnek görseller (SVG; seed sırasında sharp ile WebP'ye çevrilir)
// ---------------------------------------------------------------------------

export type DemoScene = "exterior" | "living" | "kitchen" | "bedroom" | "view" | "land" | "shop";

/** Portföy türüne göre görsel sırası (ilki kapak). */
export function demoScenesFor(type: string): DemoScene[] {
  if (type === "Arsa") return ["land", "view"];
  if (type === "İşyeri") return ["shop", "exterior"];
  if (type === "Müstakil ev") return ["exterior", "living", "view"];
  return ["exterior", "living", "kitchen", "bedroom"];
}

const PALETTES = [
  { sky: "#cfe3f5", wall: "#f3ede4", accent: "#2f6f8f", wood: "#b88a5a", floor: "#d9c3a5" },
  { sky: "#f6dcc8", wall: "#eef1f4", accent: "#8a4f7d", wood: "#9c7653", floor: "#cdb79a" },
  { sky: "#d8eedf", wall: "#f5f0e8", accent: "#3c7a5a", wood: "#a97e57", floor: "#d7c2a3" },
  { sky: "#e1dcf3", wall: "#f2efe9", accent: "#4b5fa8", wood: "#8f6a4c", floor: "#c9b394" },
] as const;

function paletteFor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length]!;
}

function badge(): string {
  return `<g><rect x="24" y="24" rx="14" width="196" height="44" fill="#000" fill-opacity="0.45"/><text x="122" y="54" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" fill="#fff">Örnek görsel</text></g>`;
}

function sceneBody(scene: DemoScene, c: (typeof PALETTES)[number]): string {
  switch (scene) {
    case "exterior": {
      const windows: string[] = [];
      for (let row = 0; row < 5; row += 1) {
        for (let col = 0; col < 4; col += 1) {
          windows.push(`<rect x="${400 + col * 105}" y="${180 + row * 95}" width="70" height="60" rx="4" fill="#bcd6ea" stroke="#fff" stroke-width="4"/>`);
        }
      }
      return `<rect width="1200" height="800" fill="${c.sky}"/><circle cx="1010" cy="140" r="60" fill="#fff6d6"/>
<rect x="360" y="140" width="480" height="560" fill="${c.wall}" stroke="#c9c2b6" stroke-width="4"/>${windows.join("")}
<rect x="555" y="620" width="90" height="80" fill="${c.accent}"/><rect x="0" y="700" width="1200" height="100" fill="#9fb59a"/>
<circle cx="230" cy="600" r="90" fill="#6e9a6a"/><rect x="220" y="600" width="20" height="100" fill="${c.wood}"/>
<circle cx="980" cy="610" r="80" fill="#7aa676"/><rect x="970" y="610" width="20" height="90" fill="${c.wood}"/>`;
    }
    case "living":
      return `<rect width="1200" height="800" fill="${c.wall}"/><rect x="0" y="600" width="1200" height="200" fill="${c.floor}"/>
<rect x="700" y="120" width="380" height="330" fill="${c.sky}" stroke="#fff" stroke-width="12"/><line x1="890" y1="120" x2="890" y2="450" stroke="#fff" stroke-width="8"/>
<rect x="140" y="430" width="460" height="150" rx="30" fill="${c.accent}"/><rect x="120" y="390" width="500" height="80" rx="30" fill="${c.accent}" fill-opacity="0.85"/>
<rect x="160" y="580" width="20" height="40" fill="${c.wood}"/><rect x="560" y="580" width="20" height="40" fill="${c.wood}"/>
<rect x="680" y="560" width="260" height="20" rx="8" fill="${c.wood}"/><rect x="700" y="580" width="16" height="50" fill="${c.wood}"/><rect x="904" y="580" width="16" height="50" fill="${c.wood}"/>
<rect x="1040" y="500" width="60" height="100" rx="10" fill="#c97b4f"/><circle cx="1070" cy="460" r="60" fill="#6e9a6a"/>
<rect x="250" y="170" width="220" height="150" fill="#fff" stroke="${c.wood}" stroke-width="10"/>`;
    case "kitchen":
      return `<rect width="1200" height="800" fill="${c.wall}"/><rect x="0" y="640" width="1200" height="160" fill="${c.floor}"/>
<rect x="80" y="120" width="1040" height="160" fill="#fff" stroke="#d8d2c8" stroke-width="4"/>
${[0, 1, 2, 3, 4].map((i) => `<rect x="${100 + i * 205}" y="140" width="185" height="120" rx="6" fill="${c.accent}" fill-opacity="0.18"/>`).join("")}
<rect x="80" y="420" width="1040" height="220" fill="${c.accent}"/><rect x="60" y="400" width="1080" height="30" fill="#e9e4dc"/>
<rect x="480" y="300" width="240" height="100" fill="${c.sky}" stroke="#fff" stroke-width="8"/>
<circle cx="300" cy="380" r="18" fill="#555"/><circle cx="360" cy="380" r="18" fill="#555"/>
<rect x="840" y="330" width="40" height="70" rx="8" fill="${c.wood}"/>`;
    case "bedroom":
      return `<rect width="1200" height="800" fill="${c.wall}"/><rect x="0" y="620" width="1200" height="180" fill="${c.floor}"/>
<rect x="300" y="300" width="600" height="80" rx="16" fill="${c.wood}"/><rect x="280" y="380" width="640" height="200" rx="24" fill="#fff"/>
<rect x="280" y="470" width="640" height="110" rx="20" fill="${c.accent}" fill-opacity="0.75"/>
<rect x="330" y="400" width="180" height="60" rx="20" fill="#eef1f4"/><rect x="690" y="400" width="180" height="60" rx="20" fill="#eef1f4"/>
<rect x="140" y="470" width="110" height="110" rx="8" fill="${c.wood}"/><circle cx="195" cy="430" r="40" fill="#ffe7a8"/>
<rect x="950" y="470" width="110" height="110" rx="8" fill="${c.wood}"/>
<rect x="470" y="110" width="260" height="150" fill="${c.sky}" stroke="#fff" stroke-width="10"/>`;
    case "view":
      return `<rect width="1200" height="800" fill="${c.sky}"/><circle cx="900" cy="200" r="80" fill="#fff3c4"/>
<rect x="0" y="430" width="1200" height="370" fill="#4f8fb8"/>
${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${60 + i * 140}" y="${330 - (i % 3) * 50}" width="100" height="${100 + (i % 3) * 50}" fill="#8c9aa8"/>`).join("")}
<path d="M0 430 L1200 430" stroke="#dce9f2" stroke-width="6"/>
<path d="M140 560 q60 -20 120 0 t120 0" stroke="#dce9f2" stroke-width="5" fill="none"/>
<path d="M640 640 q60 -20 120 0 t120 0" stroke="#dce9f2" stroke-width="5" fill="none"/>
<path d="M500 520 l90 0 l-20 30 l-60 0 z" fill="#fff"/><rect x="540" y="470" width="8" height="50" fill="#fff"/>`;
    case "land":
      return `<rect width="1200" height="800" fill="${c.sky}"/><path d="M0 420 Q300 340 600 400 T1200 380 L1200 800 L0 800 Z" fill="#a9c48c"/>
<path d="M0 520 Q400 470 800 520 T1200 500 L1200 800 L0 800 Z" fill="#c8b37a"/>
<rect x="260" y="560" width="680" height="170" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="24 16"/>
${[0, 1, 2, 3].map((i) => `<circle cx="${120 + i * 300}" cy="${400 - (i % 2) * 20}" r="50" fill="#5f8f58"/><rect x="${112 + i * 300}" y="${400 - (i % 2) * 20}" width="16" height="70" fill="${c.wood}"/>`).join("")}`;
    case "shop":
      return `<rect width="1200" height="800" fill="${c.sky}"/><rect x="160" y="160" width="880" height="540" fill="${c.wall}" stroke="#c9c2b6" stroke-width="4"/>
<rect x="200" y="200" width="800" height="90" fill="${c.accent}"/>
${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${200 + i * 100} 290 l100 0 l-10 50 l-80 0 z" fill="${i % 2 ? "#fff" : c.accent}"/>`).join("")}
<rect x="220" y="370" width="560" height="300" fill="#bcd6ea" stroke="#fff" stroke-width="8"/><rect x="820" y="400" width="160" height="270" fill="${c.wood}"/>
<rect x="0" y="700" width="1200" height="100" fill="#9aa3ad"/>`;
  }
}

/** 1200×800 örnek görsel (SVG metni). Aynı portföy + sahne her zaman aynı görseli üretir. */
export function demoSceneSvg(scene: DemoScene, seed: string): string {
  const c = paletteFor(`${seed}:${scene}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">${sceneBody(scene, c)}${badge()}</svg>`;
}
