/**
 * Herkese açık ilan konumu — TEK KAYNAK (SK8 B152, varsayılan gizlilik).
 *
 * NEDEN: portföy formundaki "Adres özeti" alanı açık adres (cadde, sokak, kapı no) taşıyor; vitrin ilanı, paylaşım
 * linki ve JSON-LD bunu olduğu gibi basıyor, harita ~1 m hassasiyetli işaret ve Google `maps?q=lat,lng` veriyordu.
 * Kural: herkese açık yüzeyde konum MAHALLE/İLÇE düzeyindedir. Koordinat 3 ondalığa (~110 m) yuvarlanır ve ilana özgü
 * SABİT bir kaydırma (≤ ~250 m) eklenir (her açılışta aynı; ortalama alınarak gerçek noktaya inilemez); haritada işaret
 * yerine yaklaşık daire çizilir. JSON-LD'de `streetAddress` yazılmaz, Google bağlantısı mahalle/ilçe aramasıdır, vitrin
 * araması `address_line` üzerinde yapılmaz.
 *
 * Geri alınabilir: "Açık adresi ve tam konumu göster" anahtarı sahip kararına bağlı (karar.json ownerInputs B152). O
 * gelene kadar `PUBLIC_EXACT_LOCATION` kapalıdır; açılırsa eski (tam) davranış bu modülden döner.
 */
export const PUBLIC_EXACT_LOCATION = false;

/** Haritadaki yaklaşık dairenin temsil ettiği yarıçap (metre) — bilgi metni için. */
export const APPROX_RADIUS_M = 400;

const MAX_SHIFT_DEG = 0.0022;

export type PublicLocationInput = {
  id: string;
  addressLine?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  neighborhood?: string | null;
  district?: string | null;
  province?: string | null;
};

export type PublicLocation = {
  /** Gösterilecek konum metni ("Mahalle, İlçe, İl"); açık adres yok. Boşsa "". */
  text: string;
  /** Google Haritalar mahalle/ilçe araması (koordinat değil); metin yoksa null. */
  mapsHref: string | null;
  /** Yaklaşık merkez (en çok 3 ondalık); koordinat yoksa null. */
  approx: { lat: number; lng: number } | null;
  /** Haritada tam işaret mi (yalnız açık konum anahtarıyla) yoksa yaklaşık daire mi. */
  exact: boolean;
  /** JSON-LD streetAddress — yalnız açık konum anahtarı açıkken; aksi halde null. */
  streetAddress: string | null;
};

/** FNV-1a 32 bit — ilana özgü sabit kaydırma için (kriptografik değil, yalnız kararlılık). */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** İlan kimliğinden [-1, 1] aralığında iki sabit sayı. */
function unitPair(id: string): [number, number] {
  const a = hash32(`lat:${id}`);
  const b = hash32(`lng:${id}`);
  return [(a / 0xffffffff) * 2 - 1, (b / 0xffffffff) * 2 - 1];
}

function toNum(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function approximateCoords(id: string, lat: number, lng: number): { lat: number; lng: number } {
  const [u, v] = unitPair(id);
  return { lat: round3(round3(lat) + u * MAX_SHIFT_DEG), lng: round3(round3(lng) + v * MAX_SHIFT_DEG) };
}

export function publicLocation(input: PublicLocationInput): PublicLocation {
  const area = [input.neighborhood, input.district, input.province].map((s) => (s ?? "").trim()).filter(Boolean);
  const lat = toNum(input.lat);
  const lng = toNum(input.lng);
  const hasCoords = lat != null && lng != null;

  if (PUBLIC_EXACT_LOCATION) {
    const text = [(input.addressLine ?? "").trim(), ...area].filter(Boolean).join(", ");
    return {
      text,
      mapsHref: hasCoords
        ? `https://www.google.com/maps?q=${lat},${lng}`
        : text
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`
          : null,
      approx: hasCoords ? { lat: lat!, lng: lng! } : null,
      exact: true,
      streetAddress: (input.addressLine ?? "").trim() || null,
    };
  }

  const text = area.join(", ");
  return {
    text,
    mapsHref: text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : null,
    approx: hasCoords ? approximateCoords(input.id, lat!, lng!) : null,
    exact: false,
    streetAddress: null,
  };
}

/** OSM gömülü harita adresi: yaklaşık merkezde geniş kutu, işaret YOK (daire bileşende çizilir). */
export function osmEmbedSrc(loc: Pick<PublicLocation, "approx" | "exact">): string | null {
  if (!loc.approx) return null;
  const { lat, lng } = loc.approx;
  const f = (n: number) => n.toFixed(loc.exact ? 5 : 3);
  const dLng = loc.exact ? 0.006 : 0.012;
  const dLat = loc.exact ? 0.004 : 0.008;
  const bbox = `${f(lng - dLng)}%2C${f(lat - dLat)}%2C${f(lng + dLng)}%2C${f(lat + dLat)}`;
  const marker = loc.exact ? `&marker=${f(lat)}%2C${f(lng)}` : "";
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik${marker}`;
}

/** OSM'de aç bağlantısı (işaretsiz, mahalle ölçeği). */
export function osmOpenHref(loc: Pick<PublicLocation, "approx" | "exact">): string | null {
  if (!loc.approx) return null;
  const { lat, lng } = loc.approx;
  const f = (n: number) => n.toFixed(loc.exact ? 5 : 3);
  return loc.exact
    ? `https://www.openstreetmap.org/?mlat=${f(lat)}&mlon=${f(lng)}#map=16/${f(lat)}/${f(lng)}`
    : `https://www.openstreetmap.org/#map=15/${f(lat)}/${f(lng)}`;
}
