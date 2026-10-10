import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeTotals,
  decideDocType,
  idempotencyKey,
  inferVatRate,
  isValidTaxId,
  lineAmounts,
  validateDraftInput,
} from "./invoice-math";
import { applyRemoteStatus } from "./status-sync";
import {
  credentialFingerprint,
  einvoiceSecretKey,
  openEInvoiceCredentials,
  parseNilveraInput,
  sealEInvoiceCredentials,
} from "./credentials";
import { EINVOICE_PROVIDER_LIST } from "./providers";

const OK_BUYER = { name: "Ali Veli", taxId: "12345678901" };
const LINE = { description: "Hizmet", quantity: 1, unitPrice: 1000, vatRate: 20 };

describe("fatura hesapları", () => {
  it("kalem ve toplamlar kuruşa yuvarlanır, KDV orana göre kırılır", () => {
    expect(lineAmounts({ ...LINE, quantity: 3, unitPrice: 33.33 })).toEqual({ net: 99.99, vat: 20, gross: 119.99 });
    const t = computeTotals([LINE, { ...LINE, unitPrice: 500, vatRate: 10 }]);
    expect(t).toMatchObject({ net: 1500, vat: 250, gross: 1750, vatByRate: { 20: 200, 10: 50 } });
  });

  it("tür seçimi: mükellef e-Fatura, değilse e-Arşiv; e-SMM yalnız istenirse", () => {
    expect(decideDocType(true)).toBe("e-fatura");
    expect(decideDocType(false)).toBe("e-arsiv");
    expect(decideDocType(null)).toBe("e-arsiv");
    expect(decideDocType(true, true)).toBe("e-smm");
  });

  it("taslak doğrulaması basit Türkçe mesaj verir", () => {
    const good = { buyer: OK_BUYER, lines: [LINE], issueDate: "2026-10-10" };
    expect(validateDraftInput(good)).toEqual({ ok: true });
    expect(validateDraftInput({ ...good, buyer: { ...OK_BUYER, taxId: "123" } })).toMatchObject({ ok: false });
    expect(validateDraftInput({ ...good, buyer: { ...OK_BUYER, name: " " } })).toMatchObject({ ok: false, error: "Alıcı adı gerekli." });
    expect(validateDraftInput({ ...good, lines: [] })).toMatchObject({ ok: false });
    expect(validateDraftInput({ ...good, lines: [{ ...LINE, quantity: 0 }] })).toMatchObject({ ok: false });
    expect(validateDraftInput({ ...good, lines: [{ ...LINE, unitPrice: 0 }] })).toMatchObject({ ok: false });
    expect(validateDraftInput({ ...good, issueDate: "10.10.2026" })).toMatchObject({ ok: false });
    expect(isValidTaxId("1234567890")).toBe(true);
    expect(isValidTaxId("12345abcde")).toBe(false);
  });

  it("idempotensi anahtarı kaynak+tür; KDV oranı çıkarımı seçeneklere oturur", () => {
    expect(idempotencyKey("commission", "abc")).toBe("commission:abc:invoice");
    expect(idempotencyKey("free", null, "u1")).toBe("free:u1:invoice");
    expect(inferVatRate(128000, 25600)).toBe(20);
    expect(inferVatRate(1000, 0)).toBe(0);
    expect(inferVatRate(1000, 333)).toBe(20);
  });
});

describe("durum eşleme", () => {
  const cur = { status: "issued" as const, provider_state: "waiting" as const, number: null, error: null };
  const ref = { externalId: "x", docType: "e-arsiv" as const };
  it("başarı, hata ve bekleme doğru yerel duruma çevrilir", () => {
    expect(applyRemoteStatus(cur, { state: "succeeded", number: "A1", ref })).toMatchObject({ status: "issued", provider_state: "succeeded", number: "A1" });
    expect(applyRemoteStatus(cur, { state: "failed", reason: "VKN hatalı", ref })).toMatchObject({ status: "error", provider_state: "failed", error: "VKN hatalı" });
    expect(applyRemoteStatus(cur, { state: "waiting", ref })).toMatchObject({ status: "issued", provider_state: "waiting" });
    expect(applyRemoteStatus(cur, { state: "cancelled", ref })).toMatchObject({ status: "cancelled" });
    expect(applyRemoteStatus(cur, { state: "draft", ref })).toMatchObject({ status: "issued", provider_state: "waiting" });
  });
});

describe("kimlik bilgisi saklama", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ["PLATFORM_SECRETS_KEY", "OTP_HMAC_SECRET", "TWO_FACTOR_COOKIE_SECRET", "PROPERTY_MEDIA_SIGNING_SECRET"]) saved[k] = process.env[k];
    process.env.PLATFORM_SECRETS_KEY = "a".repeat(64);
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("şifreli saklanır, düz metin içermez; AAD farklı ofis/sağlayıcıda çözülmez", () => {
    const creds = { provider: "nilvera" as const, apiKey: "SUPER-SECRET-API-KEY-123" };
    const sealed = sealEInvoiceCredentials("tenant-a", creds);
    expect(sealed).toBeTruthy();
    expect(sealed).not.toContain("SUPER-SECRET");
    expect(openEInvoiceCredentials("tenant-a", "nilvera", sealed)).toEqual(creds);
    expect(openEInvoiceCredentials("tenant-b", "nilvera", sealed)).toBeNull();
    expect(openEInvoiceCredentials("tenant-a", "parasut", sealed)).toBeNull();
    expect(einvoiceSecretKey("t", "parasut")).toBe("einvoice:t:parasut");
  });

  it("şifreleme anahtarı yoksa kaydetmez (null)", () => {
    delete process.env.PLATFORM_SECRETS_KEY;
    delete process.env.OTP_HMAC_SECRET;
    delete process.env.TWO_FACTOR_COOKIE_SECRET;
    delete process.env.PROPERTY_MEDIA_SIGNING_SECRET;
    expect(sealEInvoiceCredentials("t", { provider: "nilvera", apiKey: "k".repeat(20) })).toBeNull();
  });

  it("parmak izi geri döndürülemez ve anahtarı içermez; biçim denetimi", () => {
    const fp = credentialFingerprint({ provider: "nilvera", apiKey: "abcdefghijklmnop" });
    expect(fp).toHaveLength(8);
    expect(fp).not.toContain("abcd");
    expect(parseNilveraInput("kisa")).toMatchObject({ ok: false });
    expect(parseNilveraInput("iki kelime anahtar 1234567890")).toMatchObject({ ok: false });
    expect(parseNilveraInput("  abcdefghij1234567890  ")).toMatchObject({ ok: true });
  });
});

describe("sağlayıcı listesi ve ağ sınırı sözleşmesi", () => {
  it("yalnız gerçekten yazılmış sağlayıcılar listelenir", () => {
    const dir = resolve(process.cwd(), "src/lib/integrations/einvoice");
    const files = readdirSync(dir);
    for (const p of EINVOICE_PROVIDER_LIST) expect(files).toContain(`${p.id}.ts`);
    expect(EINVOICE_PROVIDER_LIST.map((p) => p.id).sort()).toEqual(["nilvera", "parasut"]);
  });

  it("ağ çağrısı yalnız http.ts üzerinden fetchExternal ile; doğrudan fetch ve sabit anahtar yok", () => {
    const dir = resolve(process.cwd(), "src/lib/integrations/einvoice");
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "test-support.ts")
      .map((f) => ({ f, text: readFileSync(join(dir, f), "utf8") }));
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/\bfetch\s*\(/);
      expect(text, f).not.toMatch(/console\.(log|info|debug)\(/);
    }
    const http = sources.find((s) => s.f === "http.ts")!.text;
    expect(http).toContain("fetchExternal(");
    const adapters = sources.filter((s) => s.f === "nilvera.ts" || s.f === "parasut.ts");
    for (const { f, text } of adapters) expect(text, f).not.toContain("fetchExternal(");
  });

  it("anahtar loga/DB'ye düz yazılmaz: action yalnız sealEInvoiceCredentials ile yazar", () => {
    const action = readFileSync(resolve(process.cwd(), "src/app/actions/einvoice.ts"), "utf8");
    expect(action).toContain("sealEInvoiceCredentials(");
    expect(action).toContain("credentials_sealed: sealed");
    expect(action).not.toMatch(/credentials_sealed:\s*(apiKey|creds)/);
    expect(action).not.toMatch(/console\.(log|error)\([^)]*(apiKey|creds|password)/);
  });
});
