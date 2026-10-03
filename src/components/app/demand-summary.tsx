"use client";

import { DemandMatchPreview } from "@/components/app/demand-match-preview";
import { SummaryGroup, SummaryRow } from "@/components/ui/tabbed-form-shell";
import { CRITERIA_LABELS, CRITERIA_REQUIRED_KEYS, parseDemandValues, type DemandFormValues } from "@/lib/demand-criteria";
import { parseLooseNumber } from "@/lib/form-tabs";
import { formatTry } from "@/lib/utils";

type Option = { value: string; label: string };
type Province = { id: string; name: string };

const nf = new Intl.NumberFormat("tr-TR");

function range(min: number | null, max: number | null, fmt: (n: number) => string): string | null {
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}`;
  if (min != null) return `${fmt(min)} ve üzeri`;
  if (max != null) return `${fmt(max)} altı`;
  return null;
}

/**
 * Talep alanlarının sağ özet paneli (müşteri formu + talep formu ortak): TÜM alanlar görünür,
 * her satır ilgili sekmeye götürür; sonda canlı eşleşme önizlemesi. `tabs` formun sekme
 * kimlikleridir (müşteri formunda üçü aynı sekmedir).
 */
export function DemandSummaryGroups({
  values,
  provinces,
  urgencyOptions,
  tabs,
  display,
  showPreview = true,
}: {
  values: DemandFormValues;
  provinces: Province[];
  urgencyOptions: Option[];
  tabs: { ne: string; kriter: string; bolge: string };
  /** Kabuktan gelen ekran metinleri (il/ilçe/mahalle etiketi için). */
  display?: Record<string, string | null>;
  /** false: eşleşme önizlemesi çizilmez (çağıran panelin en üstüne koyar). */
  showPreview?: boolean;
}) {
  const urgency = urgencyOptions.find((o) => o.value === values.urgency)?.label;
  const min = parseLooseNumber(values.budget_min);
  const max = parseLooseNumber(values.budget_max);
  const budget = range(min, max, formatTry);
  const inverted = min != null && max != null && min > max;
  const sqmMin = parseLooseNumber(values.min_sqm);
  const sqmMax = parseLooseNumber(values.max_sqm);
  const sqm = range(sqmMin && sqmMin > 0 ? sqmMin : null, sqmMax && sqmMax > 0 ? sqmMax : null, (n) => `${nf.format(n)} m²`);
  const floor = range(parseLooseNumber(values.floor_min), parseLooseNumber(values.floor_max), (n) => `${n}. kat`);
  const rooms = (values.rooms ?? "").trim();
  const heating = (values.heating ?? "").trim();
  const facade = (values.facade ?? "").trim();
  const tags = (values.feature_tags ?? "")
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const province = provinces.find((p) => p.id === values.demand_province_id)?.name;
  const district = display?.demand_district_id ?? null;
  const neighborhood = display?.demand_neighborhood_id ?? null;
  const districtText = [district, neighborhood].filter(Boolean).join(" / ");
  const parsed = parseDemandValues(values);
  const extraCount = parsed.ok ? parsed.criteria.extra_locations.length : 0;
  const requiredKeys = (values.required_keys ?? "").split(",").filter(Boolean);
  const requiredLabels = CRITERIA_REQUIRED_KEYS.filter(
    (k) => requiredKeys.includes(k) || (k === "budget" && budget != null),
  ).map((k) => CRITERIA_LABELS[k]);
  const loanSwap = [values.uses_loan ? "Kredi" : null, values.swap_ok ? "Takas" : null].filter(Boolean).join(" · ");

  return (
    <>
      <SummaryGroup title="Talep">
        <SummaryRow label="İşlem" value={values.transaction_type || "Zorunlu"} muted={!values.transaction_type} tab={tabs.ne} field="transaction_type" />
        <SummaryRow label="Tür" value={values.property_type || "Fark etmez"} muted={!values.property_type} tab={tabs.ne} field="property_type" />
        <SummaryRow label="Aciliyet" value={urgency ?? "Normal"} muted={!urgency} tab={tabs.ne} field="urgency" />
      </SummaryGroup>
      <SummaryGroup title="Kriterler">
        <SummaryRow label="Bütçe" value={budget ?? "Girilmedi"} muted={!budget} tab={tabs.kriter} field="budget_min" />
        {inverted ? (
          <p role="status" className="px-2 pb-1 text-xs font-medium text-amber-800">
            Bütçe min, max değerinden büyük; kontrol edin.
          </p>
        ) : null}
        <SummaryRow label="Oda" value={rooms || "Girilmedi"} muted={!rooms} tab={tabs.kriter} field="rooms" />
        <SummaryRow label="m²" value={sqm ?? "Girilmedi"} muted={!sqm} tab={tabs.kriter} field="min_sqm" />
        <SummaryRow label="Kat" value={floor ?? "Girilmedi"} muted={!floor} tab={tabs.kriter} field="floor_min" />
        <SummaryRow label="Isınma" value={heating || "Fark etmez"} muted={!heating} tab={tabs.kriter} field="heating" />
        <SummaryRow label="Cephe" value={facade || "Fark etmez"} muted={!facade} tab={tabs.kriter} field="facade" />
        <SummaryRow label="Özellikler" value={tags.length ? tags.join(", ") : "Girilmedi"} muted={tags.length === 0} tab={tabs.kriter} field="feature_tags" />
        <SummaryRow label="Kredi / takas" value={loanSwap || "Belirtilmedi"} muted={!loanSwap} tab={tabs.kriter} field="uses_loan" />
        <SummaryRow
          label="Olmazsa olmaz"
          value={requiredLabels.length ? requiredLabels.join(", ") : "Yok"}
          muted={requiredLabels.length === 0}
          tab={tabs.ne}
          field="required_keys"
        />
      </SummaryGroup>
      <SummaryGroup title="Bölge">
        <SummaryRow label="İl" value={province ?? "Seçilmedi"} muted={!province} tab={tabs.bolge} />
        <SummaryRow
          label="İlçe / mahalle"
          value={districtText || "Seçilmedi"}
          muted={!districtText}
          tab={tabs.bolge}
        />
        <SummaryRow label="Ek bölge" value={extraCount > 0 ? `${extraCount} bölge` : "Yok"} muted={extraCount === 0} tab={tabs.bolge} />
      </SummaryGroup>
      {showPreview ? <DemandMatchPreview values={values} /> : null}
    </>
  );
}
