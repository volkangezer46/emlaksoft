export type MatchDemand = {
  id: string;
  transaction_type: string;
  property_type: string | null;
  province_id: string | null;
  district_id: string | null;
  budget_min: number | null;
  budget_max: number | null;
  rooms: string | null;
  min_sqm: number | null;
  urgency: string | null;
  status: string;
};

export type MatchProperty = {
  id: string;
  property_code: string;
  title: string | null;
  transaction_type: string;
  property_type: string;
  status: string;
  list_price: number | null;
  province_id: string | null;
  district_id: string | null;
  features: { rooms?: string | null; sqm?: number | null } | null;
};

export type MatchReason = { label: string; ok: boolean; weight: number };

export type MatchResult = {
  score: number;
  reasons: MatchReason[];
  tier: "strong" | "good" | "weak" | "none";
};

function norm(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("tr-TR");
}

function roomsClose(a: string | null, b: string | null) {
  if (!a || !b) return null;
  const na = norm(a).replace(/\s+/g, "");
  const nb = norm(b).replace(/\s+/g, "");
  if (na === nb) return true;
  // 3+1 vs 3+1 daire
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

function txCompatible(demandTx: string, propertyTx: string) {
  const d = norm(demandTx);
  const p = norm(propertyTx);
  if (!d || !p) return true;
  if (d === p) return true;
  const sale = ["satılık", "satilik", "sale", "satış", "satis"];
  const rent = ["kiralık", "kiralik", "rent", "kira"];
  if (sale.some((x) => d.includes(x)) && sale.some((x) => p.includes(x))) return true;
  if (rent.some((x) => d.includes(x)) && rent.some((x) => p.includes(x))) return true;
  return false;
}

function typeCompatible(demandType: string | null, propertyType: string) {
  if (!demandType) return true;
  const d = norm(demandType);
  const p = norm(propertyType);
  if (d === p) return true;
  if (d.includes(p) || p.includes(d)) return true;
  return false;
}

/** 0–100 skor: işlem, tür, bütçe, konum, oda, m² */
export function scoreDemandProperty(demand: MatchDemand, property: MatchProperty): MatchResult {
  const reasons: MatchReason[] = [];
  let score = 0;

  const txOk = txCompatible(demand.transaction_type, property.transaction_type);
  reasons.push({ label: "İşlem türü", ok: txOk, weight: 25 });
  if (txOk) score += 25;

  const typeOk = typeCompatible(demand.property_type, property.property_type);
  reasons.push({ label: "Portföy türü", ok: typeOk, weight: 15 });
  if (typeOk) score += 15;
  else if (!demand.property_type) score += 8;

  // Budget
  const price = property.list_price != null ? Number(property.list_price) : null;
  let budgetOk = true;
  if (price != null && (demand.budget_min != null || demand.budget_max != null)) {
    const min = demand.budget_min != null ? Number(demand.budget_min) : 0;
    const max = demand.budget_max != null ? Number(demand.budget_max) : Number.POSITIVE_INFINITY;
    budgetOk = price >= min && price <= max;
    // soft miss: within 10%
    if (!budgetOk && max < Number.POSITIVE_INFINITY) {
      const soft = price <= max * 1.1 && price >= min * 0.9;
      if (soft) {
        budgetOk = true;
        score += 12;
        reasons.push({ label: "Bütçe (±%10)", ok: true, weight: 20 });
      } else {
        reasons.push({ label: "Bütçe", ok: false, weight: 20 });
      }
    } else if (budgetOk) {
      score += 20;
      reasons.push({ label: "Bütçe", ok: true, weight: 20 });
    } else {
      reasons.push({ label: "Bütçe", ok: false, weight: 20 });
    }
  } else {
    score += 10;
    reasons.push({ label: "Bütçe (belirsiz)", ok: true, weight: 10 });
  }

  // Location
  if (demand.province_id && property.province_id) {
    const provOk = demand.province_id === property.province_id;
    reasons.push({ label: "İl", ok: provOk, weight: 15 });
    if (provOk) score += 15;
  } else {
    score += 6;
    reasons.push({ label: "İl (belirsiz)", ok: true, weight: 6 });
  }

  if (demand.district_id && property.district_id) {
    const distOk = demand.district_id === property.district_id;
    reasons.push({ label: "İlçe", ok: distOk, weight: 10 });
    if (distOk) score += 10;
  }

  // Rooms
  const propRooms = property.features?.rooms ?? null;
  const roomMatch = roomsClose(demand.rooms, propRooms);
  if (roomMatch === true) {
    score += 10;
    reasons.push({ label: "Oda", ok: true, weight: 10 });
  } else if (roomMatch === false) {
    reasons.push({ label: "Oda", ok: false, weight: 10 });
  } else {
    score += 4;
    reasons.push({ label: "Oda (belirsiz)", ok: true, weight: 4 });
  }

  // Sqm
  const propSqm = property.features?.sqm != null ? Number(property.features.sqm) : null;
  if (demand.min_sqm != null && propSqm != null) {
    const sqmOk = propSqm >= Number(demand.min_sqm);
    reasons.push({ label: "m²", ok: sqmOk, weight: 5 });
    if (sqmOk) score += 5;
  } else {
    score += 2;
  }

  // Status penalty
  if (property.status === "draft" || property.status === "archived") {
    score = Math.max(0, score - 15);
    reasons.push({ label: "Portföy durumu", ok: false, weight: 15 });
  } else if (property.status === "live" || property.status === "Yayında") {
    score = Math.min(100, score + 5);
  }

  // Hard fail if transaction incompatible
  if (!txOk) score = Math.min(score, 20);

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const tier =
    clamped >= 75 ? "strong" : clamped >= 55 ? "good" : clamped >= 35 ? "weak" : "none";

  return { score: clamped, reasons, tier };
}

export function tierLabel(tier: MatchResult["tier"]) {
  switch (tier) {
    case "strong":
      return "Güçlü eşleşme";
    case "good":
      return "İyi eşleşme";
    case "weak":
      return "Zayıf";
    default:
      return "Uygun değil";
  }
}

export function tierCls(tier: MatchResult["tier"]) {
  switch (tier) {
    case "strong":
      return "bg-mint-500/12 text-mint-600";
    case "good":
      return "bg-brand-600/10 text-brand-600";
    case "weak":
      return "bg-amber-400/15 text-amber-600";
    default:
      return "bg-ink-950/8 text-text-muted";
  }
}
