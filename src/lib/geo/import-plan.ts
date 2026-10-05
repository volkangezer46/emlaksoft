/**
 * Coğrafya toplu içe aktarma — SAF çekirdek (veritabanı/ağ yok): ayrıştırma, doğrulama, fark planı.
 * Admin ekranı (/admin/geo/ice-aktar) ve CLI (scripts/geo-import.ts) AYNI mantığı kullanır.
 *
 * DOSYA BİÇİMİ (düz satırlar; CSV başlığı veya JSON dizi/nesne):
 *   plate_code, province, district, neighborhood, source_id, postal_code, lat, lng, population
 *   - yalnız province dolu  → il satırı (plate_code zorunlu)
 *   - province + district   → ilçe satırı
 *   - + neighborhood        → mahalle satırı (source_id/postal_code mahalleye aittir)
 *   Başlık eş anlamlıları: plaka, il, ilce, mahalle, kaynak_id, posta_kodu, enlem, boylam, nufus.
 *   JSON: [ {...satir} ] ya da { meta: { source, version, date }, rows: [ ... ] }.
 *
 * KURAL: silme YOK. Kaynakta olmayan kayıt yalnız (mode=full iken, dosyada yer alan illerin altında)
 * PASİFE alınır; pasif kayıt kaynakta görünse bile yeniden etkinleştirilmez.
 */
import { geoKey } from "./normalize";

export type ImportRow = {
  plate_code: number | null;
  province: string;
  district: string;
  neighborhood: string;
  source_id: number | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  population: number | null;
  line: number;
};

export type ImportMeta = { source?: string; version?: string; date?: string };

export type ParsedImport = { rows: ImportRow[]; meta: ImportMeta; errors: string[] };

export type ExistingGeo = {
  provinces: Array<{ id: string; plate_code: number; name: string; lat: number | null; lng: number | null; is_active: boolean }>;
  districts: Array<{ id: string; province_id: string; name: string; source_id: number | null; lat: number | null; lng: number | null; is_active: boolean }>;
  neighborhoods: Array<{ id: string; district_id: string; name: string; source_id: number | null; postal_code: string | null; is_active: boolean }>;
};

export type ImportLevel = "province" | "district" | "neighborhood";

export type GeoOp =
  | {
      op: "insert";
      level: ImportLevel;
      name: string;
      path: string;
      plate: number;
      districtKey?: string; // mahalle için: ilçe anahtarı (aynı ilin içinde)
      sourceId: number | null;
      postalCode: string | null;
      lat: number | null;
      lng: number | null;
      population: number | null;
    }
  | {
      op: "update";
      level: ImportLevel;
      id: string;
      path: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      aliasFrom: string | null;
    }
  | { op: "deactivate"; level: ImportLevel; id: string; name: string; path: string };

export type ImportPlan = {
  ops: GeoOp[];
  summary: {
    add: Record<ImportLevel, number>;
    change: Record<ImportLevel, number>;
    deactivate: Record<ImportLevel, number>;
    unchanged: number;
    skippedInactive: number;
  };
  errors: string[];
  warnings: string[];
};

// ------------------------------------------------------------------ ayrıştırma

const HEADER_ALIASES: Record<string, keyof Omit<ImportRow, "line">> = {
  plate_code: "plate_code", plaka: "plate_code", plaka_kodu: "plate_code",
  province: "province", il: "province",
  district: "district", ilce: "district",
  neighborhood: "neighborhood", mahalle: "neighborhood",
  source_id: "source_id", kaynak_id: "source_id",
  postal_code: "postal_code", posta_kodu: "postal_code",
  lat: "lat", enlem: "lat", latitude: "lat",
  lng: "lng", boylam: "lng", longitude: "lng",
  population: "population", nufus: "population",
};

function headerKey(h: string): keyof Omit<ImportRow, "line"> | null {
  const k = h.trim().replace(/^﻿/, "").toLowerCase().replace(/ı/g, "i").replace(/ç/g, "c").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ğ/g, "g").replace(/[\s-]+/g, "_");
  return HEADER_ALIASES[k] ?? null;
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
};
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v)).replace(/\s+/g, " ").trim();

function toRow(raw: Record<string, unknown>, line: number): ImportRow {
  return {
    plate_code: int(raw.plate_code),
    province: str(raw.province),
    district: str(raw.district),
    neighborhood: str(raw.neighborhood),
    source_id: int(raw.source_id),
    postal_code: str(raw.postal_code) || null,
    lat: num(raw.lat),
    lng: num(raw.lng),
    population: int(raw.population),
    line,
  };
}

export function parseImport(text: string, format?: "csv" | "json"): ParsedImport {
  const errors: string[] = [];
  const body = text.replace(/^﻿/, "");
  const fmt = format ?? (body.trimStart().startsWith("[") || body.trimStart().startsWith("{") ? "json" : "csv");
  const rows: ImportRow[] = [];
  let meta: ImportMeta = {};

  if (fmt === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { rows, meta, errors: ["JSON okunamadı (geçersiz biçim)."] };
    }
    let list: unknown = parsed;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const o = parsed as { meta?: ImportMeta; rows?: unknown };
      if (o.meta && typeof o.meta === "object") meta = { source: str(o.meta.source), version: str(o.meta.version), date: str(o.meta.date) };
      list = o.rows;
    }
    if (!Array.isArray(list)) return { rows, meta, errors: ["JSON bir satır dizisi (veya { meta, rows }) olmalı."] };
    list.forEach((item, i) => {
      if (!item || typeof item !== "object") { errors.push(`Satır ${i + 1}: nesne değil.`); return; }
      const raw: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        const hk = headerKey(k);
        if (hk) raw[hk] = v;
      }
      rows.push(toRow(raw, i + 1));
    });
    return { rows, meta, errors };
  }

  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { rows, meta, errors: ["CSV en az bir başlık ve bir veri satırı içermeli."] };
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = splitCsvLine(lines[0], sep).map(headerKey);
  if (!headers.includes("province")) return { rows, meta, errors: ['CSV başlığında "province" (il) sütunu yok.'] };
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], sep);
    const raw: Record<string, unknown> = {};
    headers.forEach((h, idx) => { if (h) raw[h] = cells[idx]; });
    rows.push(toRow(raw, i + 1));
  }
  return { rows, meta, errors };
}

// ------------------------------------------------------------------ doğrulama

export function validateImportRows(rows: readonly ImportRow[], opts: { mode: "merge" | "full"; existingProvincePlates?: ReadonlySet<number> }): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const filePlates = new Set<number>();
  const plateByName = new Map<string, number>();
  for (const r of rows) {
    if (r.province && !r.district && !r.neighborhood) {
      if (r.plate_code === null) errors.push(`Satır ${r.line}: il satırında plaka kodu zorunlu (${r.province}).`);
      else if (r.plate_code < 1 || r.plate_code > 81) errors.push(`Satır ${r.line}: plaka kodu 01-81 dışında (${r.plate_code}).`);
      else {
        if (filePlates.has(r.plate_code)) errors.push(`Satır ${r.line}: plaka ${r.plate_code} birden çok kez tanımlı.`);
        filePlates.add(r.plate_code);
        plateByName.set(geoKey(r.province, "province"), r.plate_code);
      }
    }
  }
  const known = (p: number) => filePlates.has(p) || opts.existingProvincePlates?.has(p);
  for (const r of rows) {
    if (!r.province) { errors.push(`Satır ${r.line}: il adı boş.`); continue; }
    if (r.neighborhood && !r.district) { errors.push(`Satır ${r.line}: mahalle satırında ilçe zorunlu.`); continue; }
    if (r.district || r.neighborhood) {
      const plate = r.plate_code ?? plateByName.get(geoKey(r.province, "province")) ?? null;
      if (plate === null) errors.push(`Satır ${r.line}: ilçe/mahalle satırının ili belirlenemedi (plaka kodu ya da dosyada il satırı gerekli): ${r.province}`);
      else if (plate < 1 || plate > 81) errors.push(`Satır ${r.line}: plaka kodu 01-81 dışında (${plate}).`);
      else if (!known(plate)) errors.push(`Satır ${r.line}: ilçe/mahalle bağlı olduğu il (${plate}) ne dosyada ne veritabanında var.`);
    }
    if (r.lat !== null && (r.lat < 35 || r.lat > 43)) warnings.push(`Satır ${r.line}: enlem Türkiye aralığı dışında (${r.lat}).`);
    if (r.lng !== null && (r.lng < 25 || r.lng > 45)) warnings.push(`Satır ${r.line}: boylam Türkiye aralığı dışında (${r.lng}).`);
  }
  if (opts.mode === "full") {
    const all = new Set<number>([...filePlates, ...(opts.existingProvincePlates ?? [])]);
    if (filePlates.size !== 81) errors.push(`Tam kaynak modunda dosya 81 ili içermeli (bulunan: ${filePlates.size}).`);
    if (all.size !== 81) errors.push(`Toplam il sayısı 81 olmalı (bulunan: ${all.size}).`);
  }
  return { errors, warnings };
}

// ------------------------------------------------------------------ fark planı

const zero = (): Record<ImportLevel, number> => ({ province: 0, district: 0, neighborhood: 0 });

type DistrictEntry = ExistingGeo["districts"][number];
type NeighEntry = ExistingGeo["neighborhoods"][number];

export function buildImportPlan(rows: readonly ImportRow[], existing: ExistingGeo, opts: { mode: "merge" | "full" }): ImportPlan {
  const plan: ImportPlan = { ops: [], summary: { add: zero(), change: zero(), deactivate: zero(), unchanged: 0, skippedInactive: 0 }, errors: [], warnings: [] };
  const existingPlates = new Set(existing.provinces.map((p) => p.plate_code));
  const v = validateImportRows(rows, { mode: opts.mode, existingProvincePlates: existingPlates });
  plan.errors.push(...v.errors);
  plan.warnings.push(...v.warnings);
  if (plan.errors.length) return plan;

  const provByPlate = new Map(existing.provinces.map((p) => [p.plate_code, p]));
  const plateByNameFile = new Map<string, number>();
  for (const r of rows) if (r.province && !r.district && !r.neighborhood && r.plate_code) plateByNameFile.set(geoKey(r.province, "province"), r.plate_code);
  const plateOf = (r: ImportRow): number => r.plate_code ?? plateByNameFile.get(geoKey(r.province, "province")) ?? 0;

  // Mevcut ilçeler: il → (kaynak kimliği | ad anahtarı)
  const distBySource = new Map<number, DistrictEntry>();
  const distByKey = new Map<string, DistrictEntry>(); // `${provinceId}|${key}`
  for (const d of existing.districts) {
    if (d.source_id !== null) distBySource.set(d.source_id, d);
    distByKey.set(`${d.province_id}|${geoKey(d.name, "district")}`, d);
  }
  const neighBySource = new Map<number, NeighEntry>();
  const neighByKey = new Map<string, NeighEntry>(); // `${districtId}|${key}`
  for (const n of existing.neighborhoods) {
    if (n.source_id !== null) neighBySource.set(n.source_id, n);
    neighByKey.set(`${n.district_id}|${geoKey(n.name, "neighborhood")}`, n);
  }
  const provNameById = new Map(existing.provinces.map((p) => [p.id, p.name]));
  const distNameById = new Map(existing.districts.map((d) => [d.id, d.name]));

  const seenProvinces = new Set<string>();
  const seenDistricts = new Set<string>();
  const seenNeigh = new Set<string>();
  const plannedNewDistricts = new Set<string>(); // `${plate}|${key}`
  const plannedNewNeigh = new Set<string>();
  const touchedProvinceIds = new Set<string>();

  for (const r of rows) {
    const plate = plateOf(r);
    const prov = provByPlate.get(plate);

    if (!r.district && !r.neighborhood) {
      // il satırı
      if (!prov) {
        plan.ops.push({ op: "insert", level: "province", name: r.province, path: `${r.province} (${plate})`, plate, sourceId: null, postalCode: null, lat: r.lat, lng: r.lng, population: r.population });
        plan.summary.add.province++;
        continue;
      }
      seenProvinces.add(prov.id);
      touchedProvinceIds.add(prov.id);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (geoKey(prov.name) !== geoKey(r.province) || prov.name !== r.province) { before.name = prov.name; after.name = r.province; }
      if (r.lat !== null && r.lat !== prov.lat) { before.lat = prov.lat; after.lat = r.lat; }
      if (r.lng !== null && r.lng !== prov.lng) { before.lng = prov.lng; after.lng = r.lng; }
      if (Object.keys(after).length) {
        plan.ops.push({ op: "update", level: "province", id: prov.id, path: prov.name, before, after, aliasFrom: "name" in after ? prov.name : null });
        plan.summary.change.province++;
      } else plan.summary.unchanged++;
      continue;
    }

    if (!prov) {
      // il bu dosyada ekleniyor (insert op yukarıda) → alt kayıtlar da eklenir
    } else touchedProvinceIds.add(prov.id);

    // ilçe
    const dKey = geoKey(r.district, "district");
    const distSource = r.neighborhood ? null : r.source_id;
    const existingDistrict = prov
      ? (distSource !== null ? distBySource.get(distSource) : undefined) ?? distByKey.get(`${prov.id}|${dKey}`)
      : undefined;

    if (!r.neighborhood) {
      // ilçe satırı
      if (!existingDistrict) {
        const pk = `${plate}|${dKey}`;
        if (!plannedNewDistricts.has(pk)) {
          plannedNewDistricts.add(pk);
          plan.ops.push({ op: "insert", level: "district", name: r.district, path: `${r.province} / ${r.district}`, plate, sourceId: r.source_id, postalCode: null, lat: r.lat, lng: r.lng, population: r.population });
          plan.summary.add.district++;
        }
        continue;
      }
      seenDistricts.add(existingDistrict.id);
      if (!existingDistrict.is_active) { plan.summary.skippedInactive++; continue; }
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (existingDistrict.name !== r.district) { before.name = existingDistrict.name; after.name = r.district; }
      if (r.lat !== null && r.lat !== existingDistrict.lat) { before.lat = existingDistrict.lat; after.lat = r.lat; }
      if (r.lng !== null && r.lng !== existingDistrict.lng) { before.lng = existingDistrict.lng; after.lng = r.lng; }
      if (distSource !== null && existingDistrict.source_id === null) { before.source_id = null; after.source_id = distSource; }
      if (Object.keys(after).length) {
        plan.ops.push({ op: "update", level: "district", id: existingDistrict.id, path: `${provNameById.get(existingDistrict.province_id) ?? r.province} / ${existingDistrict.name}`, before, after, aliasFrom: "name" in after ? existingDistrict.name : null });
        plan.summary.change.district++;
      } else plan.summary.unchanged++;
      continue;
    }

    // mahalle satırı
    if (existingDistrict) seenDistricts.add(existingDistrict.id);
    const nKey = geoKey(r.neighborhood, "neighborhood");
    if (!existingDistrict) {
      // ilçe yok: ilçe satırı dosyada ayrıca verilmediyse yine de ilçe ekle
      const pk = `${plate}|${dKey}`;
      if (!plannedNewDistricts.has(pk)) {
        plannedNewDistricts.add(pk);
        plan.ops.push({ op: "insert", level: "district", name: r.district, path: `${r.province} / ${r.district}`, plate, sourceId: null, postalCode: null, lat: null, lng: null, population: null });
        plan.summary.add.district++;
      }
      const nk = `${pk}|${nKey}`;
      if (!plannedNewNeigh.has(nk)) {
        plannedNewNeigh.add(nk);
        plan.ops.push({ op: "insert", level: "neighborhood", name: r.neighborhood, path: `${r.province} / ${r.district} / ${r.neighborhood}`, plate, districtKey: dKey, sourceId: r.source_id, postalCode: r.postal_code, lat: r.lat, lng: r.lng, population: r.population });
        plan.summary.add.neighborhood++;
      }
      continue;
    }
    const existingNeigh = (r.source_id !== null ? neighBySource.get(r.source_id) : undefined) ?? neighByKey.get(`${existingDistrict.id}|${nKey}`);
    if (!existingNeigh) {
      const nk = `${plate}|${dKey}|${nKey}`;
      if (!plannedNewNeigh.has(nk)) {
        plannedNewNeigh.add(nk);
        plan.ops.push({ op: "insert", level: "neighborhood", name: r.neighborhood, path: `${r.province} / ${r.district} / ${r.neighborhood}`, plate, districtKey: dKey, sourceId: r.source_id, postalCode: r.postal_code, lat: r.lat, lng: r.lng, population: r.population });
        plan.summary.add.neighborhood++;
      }
      continue;
    }
    seenNeigh.add(existingNeigh.id);
    if (!existingNeigh.is_active) { plan.summary.skippedInactive++; continue; }
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (existingNeigh.name !== r.neighborhood) { before.name = existingNeigh.name; after.name = r.neighborhood; }
    if (r.postal_code && r.postal_code !== existingNeigh.postal_code) { before.postal_code = existingNeigh.postal_code; after.postal_code = r.postal_code; }
    if (r.source_id !== null && existingNeigh.source_id === null) { before.source_id = null; after.source_id = r.source_id; }
    if (Object.keys(after).length) {
      plan.ops.push({ op: "update", level: "neighborhood", id: existingNeigh.id, path: `${distNameById.get(existingNeigh.district_id) ?? r.district} / ${existingNeigh.name}`, before, after, aliasFrom: "name" in after ? existingNeigh.name : null });
      plan.summary.change.neighborhood++;
    } else plan.summary.unchanged++;
  }

  // Pasife alma: yalnız "tam kaynak" modunda ve yalnız dosyada yer alan illerin altında.
  if (opts.mode === "full") {
    const activeDistrictsOfTouched = existing.districts.filter((d) => d.is_active && touchedProvinceIds.has(d.province_id));
    for (const d of activeDistrictsOfTouched) {
      if (!seenDistricts.has(d.id)) {
        plan.ops.push({ op: "deactivate", level: "district", id: d.id, name: d.name, path: `${provNameById.get(d.province_id) ?? ""} / ${d.name}` });
        plan.summary.deactivate.district++;
      }
    }
    const touchedDistrictIds = new Set(activeDistrictsOfTouched.map((d) => d.id));
    for (const n of existing.neighborhoods) {
      if (!n.is_active || !touchedDistrictIds.has(n.district_id) || seenNeigh.has(n.id)) continue;
      plan.ops.push({ op: "deactivate", level: "neighborhood", id: n.id, name: n.name, path: `${distNameById.get(n.district_id) ?? ""} / ${n.name}` });
      plan.summary.deactivate.neighborhood++;
    }
  }
  return plan;
}

/** Partilere bölme (yarım bırakmama: her parti kendi içinde tutarlı, sıralı uygulanır). */
export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
