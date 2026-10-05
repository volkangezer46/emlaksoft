import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OFFICE_TRIAL_DEFAULT_DAYS } from "@/lib/admin/office-create-rules";
import { prepareWrite } from "./prepare";
import { ALL_SETTING_DEFS, getSettingDef, getSettingDefByStorage, isSecretDef, storageKeyOf } from "./registry";
import { revealSecret, sealSecret, secretFingerprint } from "./secrets";
import { SETTING_CATEGORIES } from "./types";
import { buildView, coerceInput, searchSettings } from "./view";

const HEX_KEY = "a".repeat(64);

describe("ayar kayıt defteri: yapı sözleşmesi", () => {
  it("anahtarlar noktalı küçük harf, benzersiz; legacyKeys ve depo anahtarları çakışmaz", () => {
    const keys = new Set<string>();
    const storage = new Set<string>();
    for (const d of ALL_SETTING_DEFS) {
      expect(d.key, d.key).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);
      expect(keys.has(d.key), `yinelenen anahtar ${d.key}`).toBe(false);
      keys.add(d.key);
      const sk = `${d.scope}:${storageKeyOf(d)}`;
      expect(storage.has(sk), `yinelenen depo anahtarı ${sk}`).toBe(false);
      storage.add(sk);
    }
    for (const d of ALL_SETTING_DEFS) {
      for (const legacy of d.legacyKeys ?? []) {
        const owner = getSettingDef(legacy);
        expect(owner?.key, `legacy ${legacy} başka ayara ait`).toBe(d.key);
      }
    }
  });

  it("her ayarda kategori, etiket, açıklama ve ETKİSİ dolu; kategori geçerli", () => {
    const cats = new Set<string>(SETTING_CATEGORIES.map((c) => c.id));
    expect(SETTING_CATEGORIES).toHaveLength(12);
    for (const d of ALL_SETTING_DEFS) {
      expect(cats.has(d.category), d.key).toBe(true);
      expect(d.label.trim().length, d.key).toBeGreaterThan(2);
      expect(d.description.trim().length, d.key).toBeGreaterThan(10);
      expect(d.impact.trim().length, d.key).toBeGreaterThan(10);
      if (d.editMode !== "center") expect(d.editHref || d.lockedReason, d.key).toBeTruthy();
    }
  });

  it("gizli ayarlar: risk yüksek, gizlilik secret, varsayılan boş", () => {
    const secrets = ALL_SETTING_DEFS.filter(isSecretDef);
    expect(secrets.length).toBeGreaterThanOrEqual(10);
    for (const d of secrets) {
      expect(d.risk, d.key).toBe("high");
      expect(d.default, d.key).toBe("");
    }
    for (const k of ["openai_api_key", "netgsm_password", "whatsapp_api_token", "efatura_api_key", "sahibinden_api_key", "emlakjet_api_secret"]) {
      const d = getSettingDefByStorage("platform", k);
      expect(d && isSecretDef(d), k).toBe(true);
    }
  });

  it("platform.mfa_enforced kilitli (zorunlu MFA merkezden AÇILMAZ)", () => {
    const d = getSettingDef("platform.mfa_enforced")!;
    expect(d.editMode).toBe("locked");
    const r = prepareWrite({ key: d.key, value: true, reason: "deneme gerekçesi" });
    expect(r.ok).toBe(false);
  });
});

describe("ilk dalga: varsayılan = bugünkü sabit (davranış değişmez)", () => {
  const table: [string, unknown, string][] = [
    ["platform.maintenance_mode", false, "maintenance_mode"],
    ["platform.maintenance_message", "", "maintenance_message"],
    ["platform.registration_open", true, "registration_open"],
    ["billing.default_trial_days", 14, "default_trial_days"],
    ["billing.trial_grace_days", 7, "billing.trial_grace_days"],
    ["billing.auto_renew_enabled", false, "billing.auto_renew_enabled"],
    ["try_credit.max_invoice_share", 0.5, "try_credit.max_invoice_share"],
    ["platform.mfa_enforced", false, "platform.mfa_enforced"],
    ["growth.referral_enabled", false, "growth_referral_enabled"],
    ["growth.partner_enabled", false, "growth_partner_enabled"],
    ["growth.cash_payout_enabled", false, "growth_cash_payout_enabled"],
  ];
  it.each(table)("%s varsayılanı ve depo anahtarı", (key, def, storage) => {
    const d = getSettingDef(key)!;
    expect(d.default).toBe(def);
    expect(storageKeyOf(d)).toBe(storage);
    expect(d.codec.parse(null)).toBe(def);
  });

  it("deneme günü TS kopyaları tek kaynaktan gelir", () => {
    expect(OFFICE_TRIAL_DEFAULT_DAYS).toBe(14);
    expect(getSettingDef("billing.default_trial_days")!.default).toBe(OFFICE_TRIAL_DEFAULT_DAYS);
  });

  it("bozuk/aralık dışı depo değeri = varsayılan (mevcut ayrıştırıcılarla aynı)", () => {
    const trial = getSettingDef("billing.default_trial_days")!;
    expect(trial.codec.parse("abc")).toBe(14);
    expect(trial.codec.parse("0")).toBe(14);
    expect(trial.codec.parse("91")).toBe(14);
    expect(trial.codec.parse("30")).toBe(30);
    expect(getSettingDef("billing.trial_grace_days")!.codec.parse("61")).toBe(7);
    expect(getSettingDef("billing.trial_grace_days")!.codec.parse("0")).toBe(0);
    expect(getSettingDef("platform.registration_open")!.codec.parse("çöp")).toBe(true);
    expect(getSettingDef("billing.auto_renew_enabled")!.codec.parse("on")).toBe(false); // yalnız "true"
    expect(getSettingDef("billing.auto_renew_enabled")!.codec.parse("TRUE")).toBe(true);
    expect(getSettingDef("try_credit.max_invoice_share")!.codec.parse("50")).toBe(0.5);
  });

  it("varsayılan biçim-ayrıştır turu kayıpsız", () => {
    for (const d of ALL_SETTING_DEFS) {
      if (isSecretDef(d) || d.type === "json") continue;
      expect(d.codec.parse(d.codec.format(d.default)), d.key).toBe(d.default);
    }
  });

  it("bool depo biçimi mevcut ile aynı (on/off; auto_renew true/false)", () => {
    expect(getSettingDef("platform.maintenance_mode")!.codec.format(true)).toBe("on");
    expect(getSettingDef("platform.registration_open")!.codec.format(false)).toBe("off");
    expect(getSettingDef("billing.auto_renew_enabled")!.codec.format(true)).toBe("true");
  });
});

describe("yazma hazırlığı: doğrulama, gerekçe, sırlar", () => {
  const prev = process.env.PLATFORM_SECRETS_KEY;
  const derive = ["OTP_HMAC_SECRET", "TWO_FACTOR_COOKIE_SECRET", "PROPERTY_MEDIA_SIGNING_SECRET"] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of derive) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    delete process.env.PLATFORM_SECRETS_KEY;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.PLATFORM_SECRETS_KEY;
    else process.env.PLATFORM_SECRETS_KEY = prev;
    for (const k of derive) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("risk=high gerekçesiz reddedilir, gerekçeyle geçer", () => {
    expect(prepareWrite({ key: "platform.maintenance_mode", value: true }).ok).toBe(false);
    expect(prepareWrite({ key: "platform.maintenance_mode", value: true, reason: "abc" }).ok).toBe(false);
    const ok = prepareWrite({ key: "platform.maintenance_mode", value: true, reason: "planlı bakım" });
    expect(ok.ok && ok.item.formatted).toBe("on");
  });

  it("düşük riskli ayar gerekçesiz yazılır; sınır dışı reddedilir", () => {
    const ok = prepareWrite({ key: "billing.default_trial_days", value: "21" });
    expect(ok.ok && ok.item.formatted).toBe("21");
    expect(prepareWrite({ key: "billing.default_trial_days", value: "0" }).ok).toBe(false);
    expect(prepareWrite({ key: "billing.default_trial_days", value: "91" }).ok).toBe(false);
    expect(prepareWrite({ key: "billing.default_trial_days", value: "x" }).ok).toBe(false);
  });

  it("kopru ayar yalniz sahibi ekrandan (fromBridge) yazilir", () => {
    expect(prepareWrite({ key: "notify.netgsm_usercode", value: "abc" }).ok).toBe(false);
    expect(prepareWrite({ key: "notify.netgsm_usercode", value: "abc", fromBridge: true }).ok).toBe(true);
  });

  it("anahtar yoksa gizli ayar YAZILMAZ (düz metin asla)", () => {
    const r = prepareWrite({ key: "ai.openai_api_key", value: "sk-" + "x".repeat(30), reason: "yeni anahtar" });
    expect(r.ok).toBe(false);
  });

  it("anahtar varsa şifreli yazılır (v1.), düz değer biçimlenmiş çıktıda yok, geri açılır", () => {
    process.env.PLATFORM_SECRETS_KEY = HEX_KEY;
    const plain = "sk-" + "y".repeat(30);
    const r = prepareWrite({ key: "ai.openai_api_key", value: plain, reason: "yeni anahtar" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.item.formatted?.startsWith("v1.")).toBe(true);
    expect(r.item.formatted).not.toContain(plain);
    expect(revealSecret("openai_api_key", r.item.formatted)).toBe(plain);
    // AAD: başka ayar satırına taşınırsa açılmaz
    expect(revealSecret("netgsm_password", r.item.formatted)).toBeNull();
  });

  it("geçiş dönemi: v1. öneki yoksa düz metin kabul edilir; boş = null", () => {
    expect(revealSecret("openai_api_key", "sk-duz-metin-deger")).toBe("sk-duz-metin-deger");
    expect(revealSecret("openai_api_key", "")).toBeNull();
    expect(revealSecret("openai_api_key", null)).toBeNull();
  });

  it("OpenAI anahtar biçimi denetlenir", () => {
    process.env.PLATFORM_SECRETS_KEY = HEX_KEY;
    expect(prepareWrite({ key: "ai.openai_api_key", value: "abc", reason: "deneme gerekçesi" }).ok).toBe(false);
    expect(prepareWrite({ key: "ai.openai_api_key", value: "xx-" + "z".repeat(30), reason: "deneme gerekçesi" }).ok).toBe(false);
  });

  it("parmak izi değeri sızdırmaz ve kararlıdır", () => {
    const fp = secretFingerprint("openai_api_key", "sk-gizli-deger-123456");
    expect(fp).toMatch(/^sha256:[0-9a-f]{12}$/);
    expect(fp).not.toContain("gizli");
    expect(secretFingerprint("openai_api_key", "sk-gizli-deger-123456")).toBe(fp);
  });

  it("null = varsayılana dön / sil: gerekçe yine zorunlu (yüksek risk)", () => {
    expect(prepareWrite({ key: "ai.openai_api_key", value: null }).ok).toBe(false);
    const r = prepareWrite({ key: "ai.openai_api_key", value: null, reason: "anahtar iptal" });
    expect(r.ok && r.item.formatted).toBeNull();
    expect(sealSecret("x", "y")).toBeNull(); // anahtar yokken şifrelenemez
  });
});

describe("görünüm ve arama", () => {
  it("gizli ayar görünümünde değer YOK", () => {
    const d = getSettingDef("ai.openai_api_key")!;
    const v = buildView(d, "v1.abc.def.ghi", { configured: true, plaintext: false });
    expect(JSON.stringify(v)).not.toContain("abc.def");
    expect(v.formValue).toBe("");
    expect(v.configured).toBe(true);
  });

  it("bozuk depo değeri görünümde varsayılana düşer", () => {
    const d = getSettingDef("billing.default_trial_days")!;
    const v = buildView(d, "çöp");
    expect(v.formValue).toBe("14");
    expect(v.isDefault).toBe(true);
  });

  it("coerceInput Türkçe hata verir", () => {
    const d = getSettingDef("billing.trial_grace_days")!;
    const bad = coerceInput(d, "99");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("0 ile 60");
  });

  it("arama etiket/anahtar/eski anahtarla bulur ve merkeze bağlanır", () => {
    const hits = searchSettings(ALL_SETTING_DEFS, "deneme");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].href.startsWith("/admin/ayarlar/merkez?ara=")).toBe(true);
    expect(searchSettings(ALL_SETTING_DEFS, "maintenance_mode").some((h) => h.key === "platform.maintenance_mode")).toBe(true);
    expect(searchSettings(ALL_SETTING_DEFS, "").length).toBe(0);
  });
});