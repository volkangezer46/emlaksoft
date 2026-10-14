import { SETTING_CATEGORIES, type AnySettingDef, type SettingCategoryId } from "../types";
import { AD2_INVOICE_SETTING_DEFS } from "./ad2-invoices";
import { BILLING_SETTING_DEFS } from "./billing";
import { EMAIL_SETTING_DEFS } from "./email";
import { OPS_ALERT_SETTING_DEFS } from "./ops-alerts";
import { CRM_SETTING_DEFS } from "./crm";
import { BROADCAST_SETTING_DEFS } from "./broadcast";
import { DUNNING_SETTING_DEFS } from "./dunning";
import { LEGAL_SETTING_DEFS } from "./legal";
import { PLATFORM_SETTING_DEFS } from "./platform";
import { SUBSCRIPTION_OPS_SETTING_DEFS } from "./subscription-ops";
import { TENANT_SETTING_DEFS } from "./tenant";
import { SECURITY_SETTING_DEFS } from "./security";
import { SUPPORT_SETTING_DEFS } from "./support";
import { EIDS_INBOUND_SETTING_DEFS } from "./eids-inbound";
import { EIDS_ACTION_SETTING_DEFS } from "./eids-actions";
import { OFFICE_SECURITY_SETTING_DEFS } from "./office-security";
import { KVKK_SETTING_DEFS } from "./kvkk";
/** Tum ayar tanimlari (TEK kaynak). Ofis tanimlari tenant.ts; faturalama ek bayraklari billing.ts; sube/kullanici sonraki pakette. */
export const ALL_SETTING_DEFS: readonly AnySettingDef[] = [...PLATFORM_SETTING_DEFS, ...BILLING_SETTING_DEFS, ...EMAIL_SETTING_DEFS, ...TENANT_SETTING_DEFS, ...SUBSCRIPTION_OPS_SETTING_DEFS, ...OPS_ALERT_SETTING_DEFS, ...SECURITY_SETTING_DEFS, ...CRM_SETTING_DEFS, ...BROADCAST_SETTING_DEFS, ...SUPPORT_SETTING_DEFS, ...AD2_INVOICE_SETTING_DEFS, ...DUNNING_SETTING_DEFS, ...LEGAL_SETTING_DEFS, ...EIDS_INBOUND_SETTING_DEFS, ...EIDS_ACTION_SETTING_DEFS, ...OFFICE_SECURITY_SETTING_DEFS, ...KVKK_SETTING_DEFS];

const BY_KEY = new Map<string, AnySettingDef>();
const BY_STORAGE = new Map<string, AnySettingDef>();
for (const d of ALL_SETTING_DEFS) {
  BY_KEY.set(d.key, d);
  for (const legacy of d.legacyKeys ?? []) BY_KEY.set(legacy, d);
  BY_STORAGE.set(`${d.scope}:${d.storageKey ?? d.key}`, d);
}

/** Noktali anahtar VEYA eski anahtar ile tanim bulur. */
export function getSettingDef(key: string): AnySettingDef | undefined {
  return BY_KEY.get(key);
}

/** Depo anahtarindan (platform_settings.key) tanim bulur. */
export function getSettingDefByStorage(scope: string, storageKey: string): AnySettingDef | undefined {
  return BY_STORAGE.get(`${scope}:${storageKey}`);
}

export function storageKeyOf(def: AnySettingDef): string {
  return def.storageKey ?? def.key;
}

export function listSettingDefs(opts?: { scope?: AnySettingDef["scope"]; category?: SettingCategoryId }): AnySettingDef[] {
  return ALL_SETTING_DEFS.filter(
    (d) => (!opts?.scope || d.scope === opts.scope) && (!opts?.category || d.category === opts.category),
  );
}

export function categoriesWithCounts(scope: AnySettingDef["scope"] = "platform") {
  return SETTING_CATEGORIES.map((c) => ({ ...c, count: listSettingDefs({ scope, category: c.id }).length }));
}

export function isSecretDef(def: AnySettingDef): boolean {
  return def.sensitivity === "secret";
}