/**
 * Teslim / tahliye tutanağı (SP6) — SAF model: oda şablonları, durum ölçeği, JSON normalizasyonu (DB'ye giden her
 * değer buradan geçer), giriş↔çıkış farkı, kesinti önerisi, depozito özeti ve imzaya gidecek tutanak metni.
 * Sunucu ve istemci güvenle import eder.
 */

export const INSPECTION_KINDS = ["move_in", "move_out"] as const;
export type InspectionKind = (typeof INSPECTION_KINDS)[number];

/** URL parçası ↔ tür (`/app/kiralama/[id]/tutanak/giris|cikis`). */
export const KIND_SLUGS: Record<InspectionKind, "giris" | "cikis"> = { move_in: "giris", move_out: "cikis" };
export function kindFromSlug(slug: string): InspectionKind | null {
  return slug === "giris" ? "move_in" : slug === "cikis" ? "move_out" : null;
}
export const KIND_LABELS: Record<InspectionKind, string> = { move_in: "Teslim tutanağı (giriş)", move_out: "Tahliye tutanağı (çıkış)" };
export const KIND_SHORT: Record<InspectionKind, string> = { move_in: "Teslim", move_out: "Tahliye" };

export const CONDITIONS = ["good", "worn", "damaged", "missing"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABELS: Record<Condition, string> = { good: "İyi", worn: "Yıpranmış", damaged: "Hasarlı", missing: "Eksik" };
const CONDITION_RANK: Record<Condition, number> = { good: 0, worn: 1, damaged: 2, missing: 3 };
export function isCondition(v: unknown): v is Condition {
  return typeof v === "string" && (CONDITIONS as readonly string[]).includes(v);
}

export type InspectionItem = { key: string; label: string; condition: Condition; note: string };
export type InspectionRoom = { key: string; name: string; items: InspectionItem[] };
export type MeterKey = "electricity" | "water" | "gas";
export type MeterReading = { reading: string; subscriber: string };
export type Meters = Record<MeterKey, MeterReading>;
export type KeyEntry = { label: string; count: number };

export const METER_LABELS: Record<MeterKey, string> = { electricity: "Elektrik", water: "Su", gas: "Doğalgaz" };
export const METER_UNITS: Record<MeterKey, string> = { electricity: "kWh", water: "m³", gas: "m³" };
export const METER_KEYS: readonly MeterKey[] = ["electricity", "water", "gas"];

export const LIMITS = { rooms: 30, items: 40, label: 80, note: 500, keys: 12, keyLabel: 60, reading: 20, subscriber: 40, notes: 4000 } as const;

const KEY_RE = /^[a-z0-9_-]{1,64}$/;

/** Oda şablonları — en sık konut düzeni. Ofis/çalışan istediği odayı ekler, adını değiştirir ya da siler. */
export const ROOM_TEMPLATES: readonly { key: string; name: string; items: readonly string[] }[] = [
  { key: "antre", name: "Antre ve koridor", items: ["Daire kapısı ve kilit", "Zemin", "Duvar ve boya", "Diafon / zil"] },
  { key: "salon", name: "Salon", items: ["Duvar ve boya", "Zemin", "Pencere ve doğrama", "Kapı", "Priz ve aydınlatma", "Radyatör / klima"] },
  { key: "mutfak", name: "Mutfak", items: ["Dolaplar", "Tezgah", "Ocak / fırın / davlumbaz", "Evye ve batarya", "Duvar ve fayans", "Zemin"] },
  { key: "banyo", name: "Banyo", items: ["Klozet ve rezervuar", "Lavabo ve batarya", "Duş / küvet", "Fayans ve derz", "Ayna ve dolap", "Havalandırma"] },
  { key: "yatak1", name: "Yatak odası", items: ["Duvar ve boya", "Zemin", "Pencere ve doğrama", "Gömme dolap", "Priz ve aydınlatma"] },
  { key: "balkon", name: "Balkon", items: ["Zemin", "Korkuluk", "Gider"] },
  { key: "tesisat", name: "Tesisat ve cihazlar", items: ["Kombi", "Su tesisatı", "Elektrik panosu", "Ankastre cihazlar"] },
];

/** Şablondan boş (hepsi "İyi") oda listesi. Anahtarlar kalıcıdır: fotoğraf ve kesinti bu anahtara bağlanır. */
export function defaultRooms(): InspectionRoom[] {
  return ROOM_TEMPLATES.map((r) => ({
    key: r.key,
    name: r.name,
    items: r.items.map((label, i) => ({ key: `${r.key}-${i + 1}`, label, condition: "good" as Condition, note: "" })),
  }));
}

/** Giriş tutanağından çıkış tutanağı iskeleti: aynı oda/kalem anahtarları (fark karşılaştırması için), durum "İyi". */
export function roomsFromMoveIn(moveIn: readonly InspectionRoom[]): InspectionRoom[] {
  return moveIn.map((r) => ({ key: r.key, name: r.name, items: r.items.map((it) => ({ key: it.key, label: it.label, condition: "good" as Condition, note: "" })) }));
}

const str = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** İstemciden/DB'den gelen oda dizisini güvenli biçime getirir: geçersiz anahtar, boş ad, fazla öğe atılır; anahtarlar tekil. */
export function normalizeRooms(raw: unknown): InspectionRoom[] {
  if (!Array.isArray(raw)) return [];
  const seenRoom = new Set<string>();
  const seenItem = new Set<string>();
  const out: InspectionRoom[] = [];
  for (const r of raw.slice(0, LIMITS.rooms)) {
    if (!r || typeof r !== "object") continue;
    const room = r as Record<string, unknown>;
    const key = String(room.key ?? "");
    const name = str(room.name, LIMITS.label);
    if (!KEY_RE.test(key) || !name || seenRoom.has(key)) continue;
    seenRoom.add(key);
    const items: InspectionItem[] = [];
    for (const it of Array.isArray(room.items) ? room.items.slice(0, LIMITS.items) : []) {
      if (!it || typeof it !== "object") continue;
      const item = it as Record<string, unknown>;
      const ik = String(item.key ?? "");
      const label = str(item.label, LIMITS.label);
      if (!KEY_RE.test(ik) || !label || seenItem.has(ik)) continue;
      seenItem.add(ik);
      items.push({ key: ik, label, condition: isCondition(item.condition) ? item.condition : "good", note: str(item.note, LIMITS.note) });
    }
    out.push({ key, name, items });
  }
  return out;
}

export function emptyMeters(): Meters {
  return { electricity: { reading: "", subscriber: "" }, water: { reading: "", subscriber: "" }, gas: { reading: "", subscriber: "" } };
}

/** Sayaç: okuma yalnız rakam ve tek ondalık ayırıcı ("12345,6"); abone no harf/rakam/tire. */
export function normalizeMeters(raw: unknown): Meters {
  const m = emptyMeters();
  if (!raw || typeof raw !== "object") return m;
  const src = raw as Record<string, unknown>;
  for (const k of METER_KEYS) {
    const v = src[k];
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const reading = String(o.reading ?? "").replace(/\s/g, "").replace(/[^0-9.,]/g, "").slice(0, LIMITS.reading);
    const subscriber = String(o.subscriber ?? "").replace(/[^0-9A-Za-z-]/g, "").slice(0, LIMITS.subscriber);
    m[k] = { reading, subscriber };
  }
  return m;
}

export function normalizeKeys(raw: unknown): KeyEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: KeyEntry[] = [];
  for (const k of raw.slice(0, LIMITS.keys)) {
    if (!k || typeof k !== "object") continue;
    const o = k as Record<string, unknown>;
    const label = str(o.label, LIMITS.keyLabel);
    const count = Math.trunc(Number(o.count));
    if (!label || !Number.isFinite(count) || count < 0 || count > 50) continue;
    out.push({ label, count });
  }
  return out;
}

export const DEFAULT_KEYS: readonly KeyEntry[] = [
  { label: "Daire kapısı anahtarı", count: 2 },
  { label: "Bina giriş kartı / anahtarı", count: 1 },
  { label: "Posta kutusu anahtarı", count: 1 },
];

/** "12.345,6" | "12345.6" → 12345.6; boş/geçersiz → null. */
export function parseReading(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Çıkış − giriş sayaç farkı (son fatura/devir için). Biri yoksa null; geri giden sayaç null (hatalı okuma). */
export function meterUsage(moveIn: Meters, moveOut: Meters): Record<MeterKey, number | null> {
  const out = {} as Record<MeterKey, number | null>;
  for (const k of METER_KEYS) {
    const a = parseReading(moveIn[k].reading);
    const b = parseReading(moveOut[k].reading);
    out[k] = a == null || b == null || b < a ? null : Math.round((b - a) * 100) / 100;
  }
  return out;
}

export type ItemChange = {
  roomKey: string;
  roomName: string;
  itemKey: string;
  label: string;
  before: Condition | null;
  after: Condition;
  note: string;
};

/**
 * Giriş ↔ çıkış farkı: çıkışta durumu kötüleşen (ya da girişte olmayıp çıkışta kusurlu görülen) kalemler.
 * Giriş tutanağı yoksa çıkıştaki her kusurlu kalem "önceki durum bilinmiyor" (before: null) olarak döner.
 */
export function diffInspections(moveIn: readonly InspectionRoom[] | null, moveOut: readonly InspectionRoom[]): ItemChange[] {
  const before = new Map<string, Condition>();
  for (const r of moveIn ?? []) for (const it of r.items) before.set(it.key, it.condition);
  const changes: ItemChange[] = [];
  for (const r of moveOut) {
    for (const it of r.items) {
      const prev = before.get(it.key) ?? null;
      const worse = prev == null ? it.condition !== "good" : CONDITION_RANK[it.condition] > CONDITION_RANK[prev];
      if (worse) changes.push({ roomKey: r.key, roomName: r.name, itemKey: it.key, label: it.label, before: prev, after: it.condition, note: it.note });
    }
  }
  return changes;
}

/** Kesinti önerisi etiketi: "Salon · Duvar ve boya (hasarlı)". Tutarı kullanıcı girer (fiyat uydurulmaz). */
export function deductionLabel(change: Pick<ItemChange, "roomName" | "label" | "after">): string {
  return `${change.roomName} · ${change.label} (${CONDITION_LABELS[change.after].toLocaleLowerCase("tr-TR")})`.slice(0, 200);
}

export type DepositSummary = { deposit: number; deducted: number; net: number; overLimit: boolean };
export function depositSummary(deposit: number | null | undefined, deductions: readonly { amount: number }[]): DepositSummary {
  const d = Math.max(0, Number(deposit) || 0);
  const deducted = Math.round(deductions.reduce((s, x) => s + (Number(x.amount) || 0), 0) * 100) / 100;
  return { deposit: d, deducted, net: Math.max(0, Math.round((d - deducted) * 100) / 100), overLimit: deducted > d };
}

export type InspectionCounts = { total: number; good: number; worn: number; damaged: number; missing: number };
export function countConditions(rooms: readonly InspectionRoom[]): InspectionCounts {
  const c: InspectionCounts = { total: 0, good: 0, worn: 0, damaged: 0, missing: 0 };
  for (const r of rooms) for (const it of r.items) {
    c.total += 1;
    c[it.condition] += 1;
  }
  return c;
}

const dateTr = (iso: string | null) => {
  if (!iso) return "_____";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "_____";
};
const BLANK = "___________________________";
const txt = (v: string | null | undefined) => (v && v.trim() ? v.trim() : BLANK);

export type InspectionDocData = {
  kind: InspectionKind;
  inspectedOn: string;
  propertyTitle: string | null;
  propertyAddress: string | null;
  landlordName: string | null;
  renterName: string | null;
  officeName: string | null;
  rooms: readonly InspectionRoom[];
  meters: Meters;
  keys: readonly KeyEntry[];
  notes: string | null;
  photoCount: number;
  /** Yalnız tahliye: kalemli kesintiler ve depozito özeti. */
  deductions?: readonly { label: string; amount: number }[];
  deposit?: number | null;
};

const tl = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);

/** İmzaya gidecek düz metin tutanak (sözleşme gövdesi; SMS OTP imza akışı aynı metni kilitler). */
export function buildInspectionBody(d: InspectionDocData): string {
  const lines: string[] = [
    d.kind === "move_in" ? "KİRALANAN TESLİM TUTANAĞI" : "KİRALANAN TAHLİYE (GERİ TESLİM) TUTANAĞI",
    "",
    `Tarih:        ${dateTr(d.inspectedOn)}`,
    `Taşınmaz:     ${txt(d.propertyTitle)}`,
    `Adres:        ${txt(d.propertyAddress)}`,
    `Kiraya veren: ${txt(d.landlordName)}`,
    `Kiracı:       ${txt(d.renterName)}`,
    "",
    d.kind === "move_in"
      ? "Taraflar, aşağıda oda oda durumu yazılı taşınmazın kiracıya bu hâliyle teslim edildiğini kabul eder."
      : "Taraflar, aşağıda oda oda durumu yazılı taşınmazın kiraya verene bu hâliyle geri teslim edildiğini kabul eder.",
    "",
    "1 — ODA ODA DURUM",
  ];
  for (const r of d.rooms) {
    lines.push("", `${r.name}:`);
    if (r.items.length === 0) lines.push("  (kalem yok)");
    for (const it of r.items) {
      lines.push(`  - ${it.label}: ${CONDITION_LABELS[it.condition]}${it.note ? ` — ${it.note}` : ""}`);
    }
  }
  lines.push("", "2 — SAYAÇLAR");
  for (const k of METER_KEYS) {
    const m = d.meters[k];
    lines.push(`  - ${METER_LABELS[k]}: ${m.reading ? `${m.reading} ${METER_UNITS[k]}` : "okunmadı"}${m.subscriber ? ` (abone no ${m.subscriber})` : ""}`);
  }
  lines.push("", "3 — ANAHTARLAR");
  if (d.keys.length === 0) lines.push("  - Anahtar teslimi kaydedilmedi.");
  for (const k of d.keys) lines.push(`  - ${k.label}: ${k.count} adet`);
  if (d.photoCount > 0) lines.push("", `Fotoğraflar: ${d.photoCount} adet fotoğraf ofis kaydında saklanır ve bu tutanağın ekidir.`);
  if (d.kind === "move_out" && d.deductions) {
    lines.push("", "4 — DEPOZİTO KESİNTİLERİ");
    if (d.deductions.length === 0) lines.push("  - Kesinti yoktur.");
    for (const x of d.deductions) lines.push(`  - ${x.label}: ${tl(x.amount)}`);
    if (d.deposit != null) {
      const s = depositSummary(d.deposit, d.deductions);
      lines.push(`  Depozito: ${tl(s.deposit)} · Toplam kesinti: ${tl(s.deducted)} · İade edilecek: ${tl(s.net)}`);
    }
  }
  if (d.notes && d.notes.trim()) lines.push("", "NOTLAR", d.notes.trim());
  lines.push(
    "",
    d.officeName ? `Aracı emlak ofisi: ${d.officeName.trim()}` : "",
    "",
    "[Bu tutanak ofis kaydıdır, hukuki danışmanlık değildir; imzadan önce kontrol edin.]",
    "",
    "İmzalar:",
    "Kiraya veren: ___________________________",
    "Kiracı:       ___________________________",
  );
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

export function inspectionTitle(kind: InspectionKind, propertyTitle: string | null, renterName: string | null): string {
  return [kind === "move_in" ? "Teslim tutanağı" : "Tahliye tutanağı", propertyTitle?.trim(), renterName?.trim()].filter(Boolean).join(" — ").slice(0, 200);
}

/** Yeni oda/kalem anahtarı (istemci): mevcutlarla çakışmayan kısa anahtar. */
export function newKey(prefix: string, existing: ReadonlySet<string>): string {
  const p = prefix.replace(/[^a-z0-9]/g, "").slice(0, 12) || "k";
  for (let i = 1; i < 10_000; i++) {
    const k = `${p}-${i}`;
    if (!existing.has(k)) return k;
  }
  return `${p}-${existing.size + 1}`;
}

export function isItemKey(v: unknown): v is string {
  return typeof v === "string" && KEY_RE.test(v);
}
