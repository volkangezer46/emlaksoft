import { describe, expect, it } from "vitest";
import { DEFAULT_SLA_MIN } from "@/lib/response-time/core";
import { STALE_DAYS } from "@/app/app/anlasmalar/deal-list-logic";
import { AGING_DAYS } from "@/app/app/talepler/demand-list-logic";
import { DEFAULT_COMMISSION_RATE } from "@/lib/commission";
import { DORMANT_DAYS } from "@/lib/customer-heat";
import { CALL_MIN_QUIET_DAYS } from "@/lib/insights/rules/call-priority";
import { PRICE_MIN_DAYS } from "@/lib/insights/rules/price-action";
import { DEAL_MIN_IDLE_DAYS } from "@/lib/insights/rules/deal-risk";
import { prepareWrite } from "../prepare";
import { getSettingDef } from "./index";
import { NOTIFY_DEFAULTS, notifyKey, TENANT_SETTING_DEFS } from "./tenant";
import { coerceInput } from "../view";

describe("ofis ayarları: varsayılan = bugünkü sabit (davranış değişmez)", () => {
  it("SLA / eşik varsayılanları koddaki sabitlerle aynı", () => {
    expect(getSettingDef("office.sla.lead_first_response_min")!.default).toBe(String(DEFAULT_SLA_MIN));
    expect(getSettingDef("office.alert.deal_stale_days")!.default).toBe(STALE_DAYS);
    expect(getSettingDef("office.alert.demand_aging_days")!.default).toBe(AGING_DAYS);
  });

  it("komisyon varsayılanları bugünkü ekran değerleri (simülatör 3 / 60, bölüşüm 50)", () => {
    expect(getSettingDef("office.commission.simulator_rate")!.default).toBe(3);
    expect(getSettingDef("office.commission.simulator_advisor_share")!.default).toBe(60);
    expect(getSettingDef("office.commission.split_advisor_share")!.default).toBe(50);
  });

  it("yedek komisyon oranı ve içgörü eşikleri bugünkü sabitlerle aynı", () => {
    expect(getSettingDef("office.commission.default_rate")!.default).toBe(DEFAULT_COMMISSION_RATE);
    expect(getSettingDef("office.insight.customer_quiet_days")!.default).toBe(CALL_MIN_QUIET_DAYS);
    expect(getSettingDef("office.insight.listing_stale_days")!.default).toBe(PRICE_MIN_DAYS);
    expect(getSettingDef("office.insight.dormant_days")!.default).toBe(DORMANT_DAYS);
    expect(getSettingDef("office.alert.deal_stale_days")!.default).toBe(DEAL_MIN_IDLE_DAYS);
  });

  it("bildirim varsayılanları notification-prefs DEFAULTS ile aynı 12 tür", () => {
    expect(NOTIFY_DEFAULTS).toHaveLength(16);
    expect(NOTIFY_DEFAULTS.find((n) => n.id === "marketing")!.default).toBe(false);
    expect(NOTIFY_DEFAULTS.filter((n) => n.default)).toHaveLength(15);
    expect(getSettingDef(notifyKey("priceDrop"))!.default).toBe(true);
  });
});

describe("ofis ayarları: kapsam, yetki, doğrulama", () => {
  it("hepsi ofis kapsamı, tenant_settings, ayarlar modülü, grup dolu, gizli değil", () => {
    for (const d of TENANT_SETTING_DEFS) {
      expect(d.scope, d.key).toBe("tenant");
      expect(d.storage, d.key).toBe("tenant_settings");
      expect(d.permission.appModule, d.key).toBe("settings");
      expect(d.group, d.key).toBeTruthy();
      expect(d.sensitivity, d.key).not.toBe("secret");
      expect(d.editMode, d.key).toBe("center");
    }
  });

  it("aralık dışı değer reddedilir, sınır içi kabul edilir", () => {
    expect(prepareWrite({ key: "office.alert.deal_stale_days", value: "2" }).ok).toBe(false);
    expect(prepareWrite({ key: "office.alert.deal_stale_days", value: "181" }).ok).toBe(false);
    expect(prepareWrite({ key: "office.alert.deal_stale_days", value: "21" }).ok).toBe(true);
    expect(prepareWrite({ key: "office.commission.simulator_rate", value: "21" }).ok).toBe(false);
    expect(prepareWrite({ key: "office.commission.simulator_rate", value: "2,5" }).ok).toBe(true);
    expect(prepareWrite({ key: "office.sla.lead_first_response_min", value: "45" }).ok).toBe(false);
    expect(prepareWrite({ key: "office.sla.lead_first_response_min", value: "30" }).ok).toBe(true);
  });

  it("ofis değeri metin (jsonb string) olarak saklansa da tipli okunur", () => {
    const d = getSettingDef("office.alert.deal_stale_days")!;
    expect(coerceInput(d, "21")).toEqual({ ok: true, value: 21 });
    expect(coerceInput(getSettingDef(notifyKey("digest"))!, "off")).toEqual({ ok: true, value: false });
  });
});
