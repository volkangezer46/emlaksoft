/**
 * Bina / daire girdi doğrulaması (SAF). Server action'ları ham değerleri bu fonksiyonlarla temizler; hata Türkçe ve kullanıcıya gösterilebilir.
 */
import { parseMoneyInput } from "@/lib/money-input";
import { isDistributionMethod, type DistributionMethod } from "./distribution";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Ondalıklı sayı (virgül ya da nokta); en çok `maxDecimals` hane, işaret ve harf reddedilir. Boş = null. */
export function parseDecimal(raw: unknown, opts: { maxDecimals: number; max: number }): { ok: true; value: number | null } | { ok: false } {
  if (raw == null) return { ok: true, value: null };
  const s = String(raw).trim().replace(",", ".");
  if (s === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false };
  const [, frac = ""] = s.split(".");
  if (frac.length > opts.maxDecimals) return { ok: false };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > opts.max) return { ok: false };
  return { ok: true, value: n };
}

const clean = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

export type BuildingInput = {
  name: string;
  address: string | null;
  /** Coğrafya kimlikleri (GeoSelect); sunucu `resolveChainForSave` ile doğrular ve görünen adı yazar. */
  provinceId: string | null;
  districtId: string | null;
  managedByOffice: boolean;
  feeType: "percent" | "fixed" | null;
  feeValue: number | null;
  dueDay: number;
  defaultDistribution: DistributionMethod;
  notes: string | null;
};

export function parseBuildingInput(raw: Record<string, unknown>): { ok: true; value: BuildingInput } | { ok: false; error: string } {
  const name = String(raw.name ?? "").trim();
  if (name.length < 1 || name.length > 120) return { ok: false, error: "Bina / site adı 1-120 karakter olmalı." };
  const managedByOffice = raw.managedByOffice === true || raw.managedByOffice === "true" || raw.managedByOffice === "on";
  const feeTypeRaw = String(raw.feeType ?? "");
  let feeType: "percent" | "fixed" | null = null;
  let feeValue: number | null = null;
  if (managedByOffice && (feeTypeRaw === "percent" || feeTypeRaw === "fixed")) {
    feeType = feeTypeRaw;
    const money = parseMoneyInput(raw.feeValue as string | number | null | undefined, { allowZero: true, max: feeType === "percent" ? 100 : 1_000_000_000 });
    if (!money.ok || money.value == null) {
      return { ok: false, error: feeType === "percent" ? "Yönetim ücreti oranı 0-100 arasında olmalı." : "Yönetim ücreti tutarını girin." };
    }
    feeValue = money.value;
  }
  const geo = { provinceId: String(raw.provinceId ?? raw.province_id ?? "").trim(), districtId: String(raw.districtId ?? raw.district_id ?? "").trim() };
  if ((geo.provinceId && !isUuid(geo.provinceId)) || (geo.districtId && !isUuid(geo.districtId))) return { ok: false, error: "Seçilen il / ilçe geçersiz." };
  if (geo.districtId && !geo.provinceId) return { ok: false, error: "İlçe seçmek için il seçilmelidir." };
  const geoOut = { provinceId: geo.provinceId || null, districtId: geo.districtId || null };
  const dueDay = Math.trunc(Number(raw.dueDay ?? 5));
  if (!(dueDay >= 1 && dueDay <= 28)) return { ok: false, error: "Vade günü 1-28 arasında olmalı." };
  const dist = String(raw.defaultDistribution ?? "equal");
  if (!isDistributionMethod(dist)) return { ok: false, error: "Dağıtım yöntemi geçersiz." };
  return {
    ok: true,
    value: {
      name,
      address: clean(raw.address, 300),
      provinceId: geoOut.provinceId,
      districtId: geoOut.districtId,
      managedByOffice,
      feeType,
      feeValue,
      dueDay,
      defaultDistribution: dist,
      notes: clean(raw.notes, 1000),
    },
  };
}

export type UnitInput = {
  block: string | null;
  floor: number | null;
  unitNo: string;
  areaM2: number | null;
  landShare: number | null;
  fixedAmount: number | null;
  ownerCustomerId: string | null;
  tenantCustomerId: string | null;
  rentalId: string | null;
  propertyId: string | null;
  payer: "owner" | "tenant";
  notes: string | null;
};

export function parseUnitInput(raw: Record<string, unknown>): { ok: true; value: UnitInput } | { ok: false; error: string } {
  const unitNo = String(raw.unitNo ?? "").trim();
  if (unitNo.length < 1 || unitNo.length > 20) return { ok: false, error: "Daire numarası 1-20 karakter olmalı." };
  const block = clean(raw.block, 20);
  const floorRaw = String(raw.floor ?? "").trim();
  let floor: number | null = null;
  if (floorRaw !== "") {
    const f = Number(floorRaw);
    if (!Number.isInteger(f) || f < -10 || f > 200) return { ok: false, error: "Kat -10 ile 200 arasında bir tam sayı olmalı." };
    floor = f;
  }
  const area = parseDecimal(raw.areaM2, { maxDecimals: 2, max: 100000 });
  if (!area.ok || (area.value != null && area.value <= 0)) return { ok: false, error: "Metrekare 0'dan büyük bir sayı olmalı (en çok 2 ondalık)." };
  const land = parseDecimal(raw.landShare, { maxDecimals: 4, max: 1_000_000 });
  if (!land.ok) return { ok: false, error: "Arsa payı geçerli bir sayı olmalı (en çok 4 ondalık)." };
  const fixed = parseMoneyInput(raw.fixedAmount as string | number | null | undefined, { allowZero: true, max: 1_000_000_000 });
  if (!fixed.ok) return { ok: false, error: "Sabit tutar geçerli bir tutar olmalı." };
  const ids: Record<"ownerCustomerId" | "tenantCustomerId" | "rentalId" | "propertyId", string | null> = {
    ownerCustomerId: null, tenantCustomerId: null, rentalId: null, propertyId: null,
  };
  for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
    const v = String(raw[key] ?? "").trim();
    if (v === "") continue;
    if (!isUuid(v)) return { ok: false, error: "Seçilen ilişkili kayıt geçersiz." };
    ids[key] = v;
  }
  const payer = raw.payer === "tenant" ? "tenant" : "owner";
  if (payer === "tenant" && !ids.tenantCustomerId) return { ok: false, error: "Aidatı kiracı ödüyorsa kiracı müşteriyi seçin." };
  return {
    ok: true,
    value: {
      block, floor, unitNo, areaM2: area.value, landShare: land.value, fixedAmount: fixed.value != null && fixed.value > 0 ? fixed.value : null,
      ...ids, payer, notes: clean(raw.notes, 500),
    },
  };
}

/** Toplu daire oluşturma: `from`-`to` numaraları (en çok 300). */
export function parseUnitRange(raw: { from: unknown; to: unknown; block?: unknown }): { ok: true; numbers: string[]; block: string | null } | { ok: false; error: string } {
  const from = Number(raw.from);
  const to = Number(raw.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) return { ok: false, error: "Daire aralığı geçersiz (ör. 1 - 12)." };
  if (to - from + 1 > 300) return { ok: false, error: "Tek seferde en çok 300 daire eklenebilir." };
  const numbers: string[] = [];
  for (let n = from; n <= to; n += 1) numbers.push(String(n));
  return { ok: true, numbers, block: clean(raw.block, 20) };
}
