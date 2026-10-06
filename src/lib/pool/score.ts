/**
 * TEK DANIŞMAN PUANLAMA MOTORU (SAF: veri çekmez, saat okumaz, kişisel veri taşımaz). İki profil aynı alt hesapları kullanır:
 *  - Havuz profili (bu dosyanın `scoreCandidate`/`rankCandidates`): sabit havuz ağırlıkları
 *    bölge 35 · tür 20 · işlem 10 · fiyat bandı 15 · iş yükü 10 · performans 5 · müsaitlik 5 (otomatik atama eşikleri buna göre).
 *  - Ofis Merkezi profili (`office-center/smart-assign.ts`): AYNI alt hesaplar, ağırlıklar ofis ayarından (`office.assign.weight_*`).
 * Ortak olan: eleme (`exclusionReason`), bölge (`regionPoints`), uzmanlık (`specialtyReasons`: tür + işlem + fiyat bandı),
 * iş yükü / performans / müsaitlik çarpanları (`workloadFactor`, `performanceFactor`, `availabilityFactor`; aday ek alan
 * taşıyorsa — açık talep, SLA uyumu, son aktivite — onları da hesaba katar), adil dağıtımlı sıralama (`rankScored`) ve
 * açıklama (`explainReasons`). Her bileşen {key,label,points,max,detail} döner: "neden bu danışman" dökümü buradan.
 * Spesifikasyon: docs/design/DANISMAN_UZMANLIK_HAVUZ_DEMO_SPEC.md bölüm 3.2.
 */

export const POOL_MAX = {
  region: 35,
  type: 20,
  transaction: 10,
  price: 15,
  workload: 10,
  performance: 5,
  availability: 5,
} as const;

/** Eşit sayılacak puan farkı: bu aralıktakilerden son atamadan en eski olan öne geçer (adil dağıtım). */
export const TIE_WINDOW = 3;
/** Performans için asgari örnek (kayıtlı ilan) sayısı; altında nötr puan + "veri yetersiz". */
export const PERFORMANCE_MIN_SAMPLE = 5;

export type PoolProperty = {
  propertyType: string | null;
  transactionType: string | null;
  provinceId: string | null;
  districtId: string | null;
  neighborhoodId: string | null;
  listPrice: number | null;
};

export type SpecialtyRow = {
  kind: "property_type" | "segment";
  value: string;
  transactionType: string | null;
  priceMin: number | null;
  priceMax: number | null;
  level: number;
};

export type RegionRow = {
  provinceId: string;
  districtId: string | null;
  neighborhoodId: string | null;
  weight: number;
};

export type Availability = "in_hours" | "out_of_hours" | "off";

export type PoolCandidate = {
  profileId: string;
  name: string;
  isActive: boolean;
  /** profiles.accepts_pool (sütun yoksa true). */
  acceptsPool: boolean;
  /** profiles.pool_paused_until (epoch ms) veya null. */
  pausedUntilMs: number | null;
  onLeave: boolean;
  /** Elle kapatılmış kural üyesi (assignment_rule_members.is_available=false). */
  ruleUnavailable: boolean;
  /** Ofisin isteğe bağlı kuralı: yetki belgesi süresi dolmuş danışman elensin. */
  licenseExpired: boolean;
  openListings: number;
  /** max_active_listings / assignment_rule_members.max_open; null = tanımsız. */
  capacity: number | null;
  specialties: SpecialtyRow[];
  regions: RegionRow[];
  /** Son 90 gün: kayıtlı ilan ve bunlardan anlaşmaya dönenler; null = veri yok. */
  performance: { listings: number; deals: number } | null;
  availability: Availability;
  /** Havuzdan en son atama (epoch ms); null = hiç. */
  lastAssignedAtMs: number | null;
  ruleWeight: number;
};

export type ScoreReason = { key: string; label: string; points: number; max: number; detail?: string };

/**
 * Motor adayı: havuz adayı + (varsa) Ofis Merkezi ek sinyalleri. Alan `undefined` ise o sinyal hesaba GİRMEZ (havuz
 * davranışı); `null` ise "ölçüm yok" olarak girer (ör. son aktivite kaydı yok).
 */
export type EngineCandidate = PoolCandidate & {
  openDemands?: number;
  slaWithinPct?: number | null;
  lastActivityAtMs?: number | null;
};

export type PoolSuggestion = {
  profileId: string;
  name: string;
  score: number;
  reasons: ScoreReason[];
  excluded?: { reason: string };
};

export type ScoreContext = {
  nowMs: number;
  /** Ofis ortalama açık ilan sayısı (kapasite tanımsızken iş yükü kıyası). */
  officeAvgOpen: number;
  /** İsim -> etiket çözümü (örn. mahalle adı) için isteğe bağlı sözlükler; yoksa genel etiket. */
  labels?: { neighborhood?: string; district?: string; province?: string };
  /** Ofis ortalama açık yük (portföy + talep). Verilirse iş yükü portföy + talebe göre ölçülür (Ofis Merkezi profili). */
  officeAvgLoad?: number;
};

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLocaleLowerCase("tr-TR");
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Elenme nedeni (ilk uyan) veya null. */
export function exclusionReason(c: PoolCandidate, ctx: ScoreContext): string | null {
  if (!c.isActive) return "Hesap pasif";
  if (!c.acceptsPool) return "Havuz atamasına kapalı";
  if (c.pausedUntilMs != null && c.pausedUntilMs > ctx.nowMs) return "Havuz atamaları geçici olarak duraklatıldı";
  if (c.onLeave) return "Bugün izinli";
  if (c.ruleUnavailable) return "Kuralda müsait değil olarak işaretli";
  if (c.licenseExpired) return "Yetki belgesi süresi dolmuş";
  if (c.capacity != null && c.openListings >= c.capacity) return `Kapasite dolu (${c.openListings}/${c.capacity})`;
  return null;
}

/** Bölge bileşeni (0..POOL_MAX.region). Ofis Merkezi akıllı atama motoru da bu hesabı ölçekleyerek kullanır. */
export function regionPoints(c: PoolCandidate, p: PoolProperty, ctx: ScoreContext): ScoreReason {
  let best = 0;
  let detail = "Bölge uzmanlığı eşleşmedi";
  for (const r of c.regions) {
    if (!p.provinceId || r.provinceId !== p.provinceId) continue;
    const w = clamp(r.weight, 1, 5) / 5;
    let base = 0;
    let where = "";
    if (r.neighborhoodId) {
      if (p.neighborhoodId && r.neighborhoodId === p.neighborhoodId) {
        base = 35;
        where = ctx.labels?.neighborhood ?? "Mahalle";
      }
    } else if (r.districtId) {
      if (p.districtId && r.districtId === p.districtId) {
        base = 24;
        where = ctx.labels?.district ?? "İlçe";
      }
    } else {
      base = 10;
      where = ctx.labels?.province ?? "İl";
    }
    const pts = Math.round(base * w);
    if (pts > best) {
      best = pts;
      detail = `${where} bölgesi (ağırlık ${r.weight}/5)`;
    }
  }
  return { key: "region", label: "Bölge", points: best, max: POOL_MAX.region, detail };
}

const LEVEL_POINTS: Record<number, number> = { 1: 12, 2: 16, 3: 20 };

function priceDeviationPoints(row: SpecialtyRow, price: number): number {
  const { priceMin, priceMax } = row;
  if (priceMin == null && priceMax == null) return 8;
  if (priceMin != null && price < priceMin) {
    const dev = priceMin > 0 ? (priceMin - price) / priceMin : 1;
    return Math.max(0, POOL_MAX.price - 3 * Math.ceil(dev / 0.1));
  }
  if (priceMax != null && price > priceMax) {
    const dev = priceMax > 0 ? (price - priceMax) / priceMax : 1;
    return Math.max(0, POOL_MAX.price - 3 * Math.ceil(dev / 0.1));
  }
  return POOL_MAX.price;
}

/** Tür / işlem / fiyat bandı bileşenleri (sırasıyla type, transaction, price). Ofis Merkezi motoru da kullanır. */
export function specialtyReasons(c: PoolCandidate, p: PoolProperty): ScoreReason[] {
  const typeRows = c.specialties.filter(
    (s) => s.kind === "property_type" && p.propertyType && norm(s.value) === norm(p.propertyType),
  );
  // Tür: en yüksek seviye
  const bestLevel = typeRows.reduce((m, s) => Math.max(m, s.level), 0);
  const typePts = bestLevel ? (LEVEL_POINTS[clamp(bestLevel, 1, 3)] ?? 0) : 0;
  const type: ScoreReason = {
    key: "type",
    label: "Tür uzmanlığı",
    points: typePts,
    max: POOL_MAX.type,
    detail: typePts ? `${p.propertyType} uzmanı (seviye ${bestLevel}/3)` : "Tür uzmanlığı yok",
  };

  const txnOk = typeRows.some((s) => s.transactionType == null || norm(s.transactionType) === norm(p.transactionType));
  const txn: ScoreReason = {
    key: "transaction",
    label: "İşlem türü",
    points: txnOk ? POOL_MAX.transaction : 0,
    max: POOL_MAX.transaction,
    detail: txnOk ? `${p.transactionType ?? "İşlem"} deneyimi` : "İşlem türü eşleşmedi",
  };

  let pricePts: number;
  let priceDetail: string;
  if (p.listPrice == null || p.listPrice <= 0) {
    pricePts = 8;
    priceDetail = "İlan fiyatı yok: nötr";
  } else {
    const banded = typeRows.filter((s) => s.priceMin != null || s.priceMax != null);
    if (!banded.length) {
      pricePts = 8;
      priceDetail = "Fiyat bandı tanımsız: nötr";
    } else {
      pricePts = Math.max(...banded.map((s) => priceDeviationPoints(s, p.listPrice as number)));
      priceDetail = pricePts === POOL_MAX.price ? "Fiyat bandının içinde" : "Fiyat bandının dışında";
    }
  }
  const price: ScoreReason = { key: "price", label: "Fiyat bandı", points: pricePts, max: POOL_MAX.price, detail: priceDetail };
  return [type, txn, price];
}

export type Factor = { ratio: number; detail: string };
const DAY_MS = 86_400_000;

/** İş yükü çarpanı (0..1; yüksek = boş). Kapasite tanımlıysa doluluk; değilse ofis ortalamasına göre. */
export function workloadFactor(c: EngineCandidate, ctx: ScoreContext): Factor {
  const demands = c.openDemands;
  if (c.capacity != null && c.capacity > 0) {
    const detail = demands !== undefined ? `${c.openListings}/${c.capacity} portföy · ${demands} açık talep` : `${c.openListings}/${c.capacity} ilan`;
    return { ratio: clamp(1 - c.openListings / c.capacity, 0, 1), detail };
  }
  if (ctx.officeAvgLoad !== undefined) {
    const d = demands ?? 0;
    if (ctx.officeAvgLoad <= 0) return { ratio: 0.6, detail: `${c.openListings} portföy · ${d} talep (ofis ortalaması yok: nötr)` };
    const load = c.openListings + d;
    return { ratio: clamp(1 - load / (2 * ctx.officeAvgLoad), 0, 1), detail: `${c.openListings} portföy · ${d} talep (ofis ort. ${Math.round(ctx.officeAvgLoad)})` };
  }
  const ref = Math.max(ctx.officeAvgOpen, 1);
  return { ratio: clamp(1 - c.openListings / (2 * ref), 0, 1), detail: `${c.openListings} ilan (ofis ort. ${Math.round(ctx.officeAvgOpen)})` };
}

/** Performans çarpanı: son 90 gün kapanış oranı (en az 5 ilan) + varsa ilk yanıt SLA uyumu; veri yoksa nötr 0.4. */
export function performanceFactor(c: EngineCandidate): Factor {
  const perf = c.performance;
  const close = perf && perf.listings >= PERFORMANCE_MIN_SAMPLE ? clamp(perf.deals / perf.listings / 0.25, 0, 1) : null;
  if (c.slaWithinPct === undefined) {
    if (close == null || !perf) return { ratio: 0.4, detail: "Veri yetersiz: nötr" };
    return { ratio: close, detail: `Son 90 gün ${perf.listings} ilandan ${perf.deals} anlaşma` };
  }
  const sla = c.slaWithinPct != null ? clamp(c.slaWithinPct / 100, 0, 1) : null;
  if (close == null && sla == null) return { ratio: 0.4, detail: "Veri yetersiz: nötr" };
  const parts: number[] = [];
  const details: string[] = [];
  if (close != null && perf) {
    parts.push(close);
    details.push(`${perf.listings} ilandan ${perf.deals} anlaşma`);
  }
  if (sla != null) {
    parts.push(sla);
    details.push(`SLA uyumu %${Math.round(c.slaWithinPct ?? 0)}`);
  }
  return { ratio: parts.reduce((x, v) => x + v, 0) / parts.length, detail: details.join(" · ") };
}

/** Müsaitlik çarpanı: mesai durumu; aday son aktivite taşıyorsa yarı yarıya yakınlık da girer. */
export function availabilityFactor(c: EngineCandidate, nowMs: number): Factor {
  const shift = c.availability === "in_hours" ? 1 : c.availability === "out_of_hours" ? 0.6 : 0;
  if (c.lastActivityAtMs === undefined) {
    const detail = c.availability === "in_hours" ? "Şimdi mesai içinde" : c.availability === "out_of_hours" ? "Bugün çalışıyor, mesai dışı" : "Bugün çalışma günü değil";
    return { ratio: shift, detail };
  }
  const shiftText = c.availability === "in_hours" ? "mesai içinde" : c.availability === "out_of_hours" ? "mesai dışı" : "çalışma günü değil";
  let recency: number;
  let recencyText: string;
  if (c.lastActivityAtMs == null) {
    recency = 0.2;
    recencyText = "son 90 günde aktivite kaydı yok";
  } else {
    const days = (nowMs - c.lastActivityAtMs) / DAY_MS;
    if (days <= 2) [recency, recencyText] = [1, "son 2 günde aktif"];
    else if (days <= 7) [recency, recencyText] = [0.7, "son 7 günde aktif"];
    else if (days <= 30) [recency, recencyText] = [0.4, "son 30 günde aktif"];
    else [recency, recencyText] = [0.2, `${Math.floor(days)} gündür aktivite yok`];
  }
  return { ratio: 0.5 * shift + 0.5 * recency, detail: `Şimdi ${shiftText} · ${recencyText}` };
}

/** Çarpan → puanlı bileşen (profil ağırlığıyla). */
export function factorReason(key: string, label: string, f: Factor, max: number): ScoreReason {
  return { key, label, points: Math.round(max * clamp(f.ratio, 0, 1)), max, detail: f.detail };
}

/** Tek danışmanı puanlar; elenmişse puan 0 ve `excluded` dolu döner. */
export function scoreCandidate(c: PoolCandidate, p: PoolProperty, ctx: ScoreContext): PoolSuggestion {
  const why = exclusionReason(c, ctx);
  if (why) return { profileId: c.profileId, name: c.name, score: 0, reasons: [], excluded: { reason: why } };
  const reasons = [
    regionPoints(c, p, ctx),
    ...specialtyReasons(c, p),
    factorReason("workload", "İş yükü", workloadFactor(c, ctx), POOL_MAX.workload),
    factorReason("performance", "Performans", performanceFactor(c), POOL_MAX.performance),
    factorReason("availability", "Müsaitlik", availabilityFactor(c, ctx.nowMs), POOL_MAX.availability),
  ];
  const score = clamp(
    reasons.reduce((s, r) => s + r.points, 0),
    0,
    100,
  );
  return { profileId: c.profileId, name: c.name, score, reasons };
}

type Scored = { profileId: string; name: string; score: number; excluded?: { reason: string } };
type Tiebreak = { lastAssignedAtMs: number | null; ruleWeight: number };

/**
 * Adil dağıtımlı sıralama (iki profil ORTAK): elenmeyenler puana göre; ±TIE_WINDOW içindekiler küme olur ve kümede son
 * atamadan EN ESKİ (hiç almamış en önde), sonra yüksek kural ağırlığı, sonra puan, sonra ad. Elenenler sona, nedenleriyle.
 */
export function rankScored<T extends Scored>(scored: readonly T[], byId: ReadonlyMap<string, Tiebreak>): T[] {
  const eligible = scored.filter((x) => !x.excluded).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "tr"));
  const excluded = scored.filter((x) => x.excluded).sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const ordered: T[] = [];
  let i = 0;
  while (i < eligible.length) {
    const top = eligible[i].score;
    let j = i;
    while (j < eligible.length && top - eligible[j].score <= TIE_WINDOW) j++;
    const cluster = eligible.slice(i, j).sort((a, b) => {
      const ca = byId.get(a.profileId);
      const cb = byId.get(b.profileId);
      const la = ca?.lastAssignedAtMs ?? Number.NEGATIVE_INFINITY;
      const lb = cb?.lastAssignedAtMs ?? Number.NEGATIVE_INFINITY;
      if (la !== lb) return la - lb;
      const wa = ca?.ruleWeight ?? 1;
      const wb = cb?.ruleWeight ?? 1;
      if (wa !== wb) return wb - wa;
      if (a.score !== b.score) return b.score - a.score;
      return a.name.localeCompare(b.name, "tr");
    });
    ordered.push(...cluster);
    i = j;
  }
  return [...ordered, ...excluded];
}

/** Havuz profili: adaylar -> sıralı öneri listesi (`rankScored`). */
export function rankCandidates(candidates: PoolCandidate[], property: PoolProperty, ctx: ScoreContext): PoolSuggestion[] {
  return rankScored(
    candidates.map((c) => scoreCandidate(c, property, ctx)),
    new Map(candidates.map((c) => [c.profileId, c])),
  );
}

/** Puan veren bileşenlerin tek satır dökümü, örn. "Bölge +35 · Tür uzmanlığı +20" (iki profil ORTAK). */
export function explainReasons(reasons: readonly ScoreReason[], empty = "Puan veren bileşen yok"): string {
  const parts = reasons.filter((r) => r.points > 0).map((r) => `${r.label} +${r.points}`);
  return parts.length ? parts.join(" · ") : empty;
}

/** "Neden bu danışman" tek satır dökümü. */
export function explainSuggestion(s: PoolSuggestion): string {
  if (s.excluded) return `Elendi: ${s.excluded.reason}`;
  return explainReasons(s.reasons);
}

/** Saklanacak (kişisel veri içermeyen) sade biçim: id, puan, bileşen etiketleri. */
export function toStoredSuggestions(list: PoolSuggestion[], limit = 5) {
  return list
    .filter((s) => !s.excluded)
    .slice(0, limit)
    .map((s) => ({
      profile_id: s.profileId,
      score: s.score,
      reasons: s.reasons.map((r) => ({ key: r.key, label: r.label, points: r.points, max: r.max })),
    }));
}
