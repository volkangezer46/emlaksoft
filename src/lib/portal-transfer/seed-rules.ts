import { FIELD_RULES, LAND_RECOMMENDED, PORTAL_FORM_RULES, REQUIRED_FIELDS, RESIDENTIAL_RECOMMENDED, TRANSFER_PORTALS, type TransferPortal } from "./rules";
import { FORM_RULES_FORMAT, SEED_EXPIRES_AT, type RuleSet } from "./rule-format";

/**
 * TOHUM KURAL SETİ (SAF): bugünkü `rules.ts` verisinin biçim-1 karşılığı; sürüm 0, her alan `unverified`, seçenek takma adı,
 * çapa ve parmak izi yok. Eklenti paketine gömülür; uzak set yoksa, reddedilirse ya da süresi dolarsa bu kullanılır (K3).
 * Sunucuda "Tohumu yayınla" (yönetim) bu içeriği sürüm 1 olarak imzalar — TS ile SQL arasında içerik kayması olmaz.
 * `rules.ts` DEĞİŞMEZ; tohum her zaman ondan türetilir.
 */
export const SEED_ISSUED_AT = "2026-10-13T00:00:00Z";

export function seedRuleSet(portal: TransferPortal): RuleSet {
  const form = PORTAL_FORM_RULES[portal];
  return {
    format: FORM_RULES_FORMAT,
    portal,
    version: 0,
    issuedAt: SEED_ISSUED_AT,
    expiresAt: SEED_EXPIRES_AT,
    minExtension: "0.0.0",
    form: {
      maxPhotos: form.maxPhotos,
      titleMax: form.titleMax,
      required: [...REQUIRED_FIELDS],
      recommended: { residential: [...RESIDENTIAL_RECOMMENDED], land: [...LAND_RECOMMENDED] },
    },
    placeholders: [],
    fields: FIELD_RULES.map((r) => ({
      key: r.key,
      control: r.control,
      labels: [...r.labels],
      exact: [...(r.exact ?? [])],
      anchors: [],
      options: {},
      state: "unverified" as const,
      confidence: 0,
    })),
    fingerprints: [],
  };
}

export const SEED_RULE_SETS: Readonly<Record<TransferPortal, RuleSet>> = Object.freeze(
  Object.fromEntries(TRANSFER_PORTALS.map((p) => [p, seedRuleSet(p)])) as Record<TransferPortal, RuleSet>,
);
