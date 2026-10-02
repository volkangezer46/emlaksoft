import { buildSplits, calculateCommission } from "./commission";
import { wonDealPropertyStatus } from "./deal-outcome";

export type DemoSeedDeal = {
  id: string;
  stage: string | null;
  deal_value: number | string | null;
  deal_type: string | null;
  property_id: string | null;
  project_unit_id?: string | null;
  customer_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DemoSeedProperty = {
  id: string;
  status: string | null;
  list_price: number | string | null;
  commission_rate: number | string | null;
};

export type DemoSeedCommission = {
  tenant_id: string;
  deal_id: string;
  gross_amount: number;
  vat_amount: number;
  status: "calculated" | "paid";
  splits: ReturnType<typeof buildSplits>;
  created_at?: string;
};

function finiteMoney(value: number | string | null | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Demo seed'i uygulama içindeki kazanma akışıyla aynı komisyon matematiğini
 * kullanır. Böylece seed verisi, gerçek kullanıcı akışından farklı KPI/ciro
 * üretmez.
 */
export function buildDemoCommissionRow(input: {
  tenantId: string;
  deal: DemoSeedDeal;
  property: DemoSeedProperty;
  status: "calculated" | "paid";
  createdAt?: string | null;
}): DemoSeedCommission {
  const amount = finiteMoney(input.deal.deal_value) ?? finiteMoney(input.property.list_price) ?? 0;
  const rate = finiteMoney(input.property.commission_rate) ?? undefined;
  const calculated = calculateCommission({ amount, rate });
  const createdAt = input.createdAt?.trim();

  return {
    tenant_id: input.tenantId,
    deal_id: input.deal.id,
    gross_amount: calculated.net,
    vat_amount: calculated.vat,
    status: input.status,
    splits: buildSplits(calculated.net),
    ...(createdAt ? { created_at: createdAt } : {}),
  };
}

/** Her kazanılmış demo anlaşmasına tam bir komisyon satırı üretir. */
export function buildMissingWonCommissionRows(input: {
  tenantId: string;
  deals: readonly DemoSeedDeal[];
  properties: readonly DemoSeedProperty[];
  existingCommissionDealIds?: ReadonlySet<string>;
}): DemoSeedCommission[] {
  const propertyById = new Map(input.properties.map((property) => [property.id, property]));
  const existing = input.existingCommissionDealIds ?? new Set<string>();

  const assetless = input.deals.find((deal) =>
    deal.stage === "won"
    && !existing.has(deal.id)
    && !deal.property_id
    && !deal.project_unit_id,
  );
  if (assetless) {
    throw new Error(`Kazanılmış demo anlaşmasının portföy veya proje dairesi yok: ${assetless.id}`);
  }

  return input.deals
    // Project-unit sales use the explicit unit ledger/postcondition below;
    // applying a property commission fallback to them would silently invent a
    // property reference and a potentially wrong rate.
    .filter((deal) => deal.stage === "won" && Boolean(deal.property_id) && !existing.has(deal.id))
    .map((deal) => {
      if (!deal.property_id) throw new Error("Unreachable property-backed deal invariant");
      const property = propertyById.get(deal.property_id);
      if (!property) {
        throw new Error(`Kazanılmış demo anlaşmasının portföyü okunamadı: ${deal.id}`);
      }
      return buildDemoCommissionRow({
        tenantId: input.tenantId,
        deal,
        property,
        status: "paid",
        // Geçmiş trend anlaşmalarının geliri bugüne yığılmasın.
        createdAt: deal.updated_at ?? deal.created_at,
      });
    });
}

export type DemoWonInvariantViolations = {
  missingCommissionDealIds: string[];
  missingAssetDealIds: string[];
  propertyStatusMismatches: Array<{
    dealId: string;
    propertyId: string | null;
    expected: "sold" | "rented";
    actual: string | null;
  }>;
};

/** Seed sonundaki read-only doğrulama için kazanılmış anlaşma invariantları. */
export function findDemoWonInvariantViolations(input: {
  deals: readonly DemoSeedDeal[];
  properties: readonly Pick<DemoSeedProperty, "id" | "status">[];
  commissionDealIds: ReadonlySet<string>;
}): DemoWonInvariantViolations {
  const propertyById = new Map(input.properties.map((property) => [property.id, property.status]));
  const missingCommissionDealIds: string[] = [];
  const missingAssetDealIds: string[] = [];
  const propertyStatusMismatches: DemoWonInvariantViolations["propertyStatusMismatches"] = [];

  for (const deal of input.deals) {
    if (deal.stage !== "won") continue;
    if (!input.commissionDealIds.has(deal.id)) missingCommissionDealIds.push(deal.id);

    if (!deal.property_id && !deal.project_unit_id) {
      missingAssetDealIds.push(deal.id);
      continue;
    }
    // A project-unit-backed won deal is validated by
    // findDemoProjectUnitInvariantViolations; it has no property status.
    if (!deal.property_id) continue;

    const expected = wonDealPropertyStatus(deal.deal_type);
    const actual = propertyById.get(deal.property_id) ?? null;
    if (actual !== expected) {
      propertyStatusMismatches.push({
        dealId: deal.id,
        propertyId: deal.property_id,
        expected,
        actual,
      });
    }
  }

  return { missingCommissionDealIds, missingAssetDealIds, propertyStatusMismatches };
}

export type DemoSeedProjectUnit = {
  id: string;
  status: string | null;
  customer_id: string | null;
  list_price: number | string | null;
};

export type DemoProjectUnitInvariantViolations = {
  unitDealCountMismatches: Array<{ unitId: string; count: number }>;
  customerMismatches: Array<{ unitId: string; dealId: string }>;
  financialMismatches: Array<{ unitId: string; dealId: string }>;
  dealUnitMismatches: Array<{ dealId: string; unitId: string }>;
  missingCommissionDealIds: string[];
};

function positiveTwoDecimalMoney(value: number | string | null | undefined): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0.01 ? parsed : null;
}

function sameMoney(
  left: number | string | null | undefined,
  right: number | string | null | undefined,
): boolean {
  const leftValue = positiveTwoDecimalMoney(left);
  const rightValue = positiveTwoDecimalMoney(right);
  return leftValue !== null
    && rightValue !== null
    && Math.round(leftValue * 100) === Math.round(rightValue * 100);
}

/** Sold demo units must each own one won sale deal and one commission ledger. */
export function findDemoProjectUnitInvariantViolations(input: {
  units: readonly DemoSeedProjectUnit[];
  deals: readonly DemoSeedDeal[];
  commissionDealIds: ReadonlySet<string>;
}): DemoProjectUnitInvariantViolations {
  const unitDealCountMismatches: DemoProjectUnitInvariantViolations["unitDealCountMismatches"] = [];
  const customerMismatches: DemoProjectUnitInvariantViolations["customerMismatches"] = [];
  const financialMismatches: DemoProjectUnitInvariantViolations["financialMismatches"] = [];
  const dealUnitMismatches: DemoProjectUnitInvariantViolations["dealUnitMismatches"] = [];
  const missingCommissionDealIds = new Set<string>();
  const unitById = new Map(input.units.map((unit) => [unit.id, unit]));

  for (const unit of input.units) {
    if (unit.status !== "sold") continue;
    const matches = input.deals.filter((deal) =>
      deal.stage === "won" && deal.project_unit_id === unit.id,
    );
    if (matches.length !== 1) {
      unitDealCountMismatches.push({ unitId: unit.id, count: matches.length });
      continue;
    }
    const deal = matches[0];
    if (deal.deal_type !== "sale" || !unit.customer_id || deal.customer_id !== unit.customer_id) {
      customerMismatches.push({ unitId: unit.id, dealId: deal.id });
    }
    if (!sameMoney(unit.list_price, deal.deal_value)) {
      financialMismatches.push({ unitId: unit.id, dealId: deal.id });
    }
    if (!input.commissionDealIds.has(deal.id)) missingCommissionDealIds.add(deal.id);
  }

  // Reverse direction is equally important: a won project-unit deal must not
  // point at missing/available stock or carry different customer/value terms.
  for (const deal of input.deals) {
    if (deal.stage !== "won" || !deal.project_unit_id) continue;
    const unit = unitById.get(deal.project_unit_id);
    if (!unit
        || unit.status !== "sold"
        || deal.deal_type !== "sale"
        || !unit.customer_id
        || deal.customer_id !== unit.customer_id
        || !sameMoney(unit.list_price, deal.deal_value)) {
      dealUnitMismatches.push({ dealId: deal.id, unitId: deal.project_unit_id });
    }
    if (!input.commissionDealIds.has(deal.id)) missingCommissionDealIds.add(deal.id);
  }

  return {
    unitDealCountMismatches,
    customerMismatches,
    financialMismatches,
    dealUnitMismatches,
    missingCommissionDealIds: [...missingCommissionDealIds],
  };
}
