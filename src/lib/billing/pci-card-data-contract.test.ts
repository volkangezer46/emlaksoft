import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SÖZLEŞME (PCI kapsamı genişlemez): ham kart no / CVC / son kullanma tarihi sunucuya, DB'ye ve loga ASLA gelmez.
 * Kart iyzico'nun barındırılan sayfasında girilir ve iyzico'da saklanır; bizde yalnız sağlayıcı anahtarları
 * (cardUserKey, cardToken) + maskeli gösterim (marka, ilk 6, son 4) vardır. Saf dosya taraması (yorumlar atılır).
 * Bu testi "çözmek" için yasak alanı istisna listesine eklemek yerine kart girişini iyzico'ya bırakın.
 */

const ROOT = process.cwd();
const FORBIDDEN =
  /\b(cardNumber|card_number|cardNo|cvc|cvv|cvc2|securityCode|expireMonth|expireYear|expire_month|expire_year|expiryMonth|expiryYear|cardHolderName|card_holder|cc-number|cc-csc|cc-exp|cc-name|card_pan|cardPan)\b/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:'"`])\/\/.*$/gm, "$1");
}

describe("PCI: kart verisi alanları kod tabanında YOK", () => {
  const files = walk(join(ROOT, "src"));

  it("hiçbir üretim dosyası ham kart alan adlarını kullanmaz (sunucu action'ı, route, bileşen, doğrulama)", () => {
    const hits: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      const m = code.match(FORBIDDEN);
      if (m) hits.push(`${relative(ROOT, file)} :: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it("iyzico'ya giden paymentCard yalnız saklı kart anahtarlarını taşır", () => {
    const iyzico = stripComments(readFileSync(join(ROOT, "src/lib/billing/iyzico.ts"), "utf8"));
    const blocks = [...iyzico.matchAll(/paymentCard:\s*\{([^}]*)\}/g)].map((m) => m[1]!.trim());
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const keys = block.split(",").map((part) => part.split(":")[0]!.trim()).filter(Boolean).sort();
      expect(keys).toEqual(["cardToken", "cardUserKey"]);
    }
  });

  it("kart action'ları ve ödeme başlatma action'ı formdan kart verisi okumaz", () => {
    for (const rel of ["src/app/actions/payment-cards.ts", "src/app/actions/billing.ts"]) {
      const code = stripComments(readFileSync(join(ROOT, rel), "utf8"));
      const fields = [...code.matchAll(/formData\.get\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
      for (const f of fields) expect(f).not.toMatch(FORBIDDEN);
    }
    const cardActions = stripComments(readFileSync(join(ROOT, "src/app/actions/payment-cards.ts"), "utf8"));
    expect(cardActions).toContain('requirePermission("billing", "edit"');
    expect(cardActions).toContain("checkRateLimit(");
    expect(cardActions).toContain("logActivity(");
  });

  it("migration: payment_cards ham kart sütunu içermez ve maskeli alanları yapısal olarak sınırlar", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20260826000100_payment_cards.sql"), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(FORBIDDEN);
    expect(sql).toContain("bin_prefix ~ '^[0-9]{6}$'");
    expect(sql).toContain("last_four ~ '^[0-9]{4}$'");
    expect(sql).toContain("enable row level security");
    // Sağlayıcı anahtarları istemciye (authenticated) sütun yetkisiyle verilmez.
    const grants = [...sql.matchAll(/grant select \(([^)]*)\)/g)].map((m) => m[1]!);
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) {
      expect(g).not.toContain("provider_card_token");
      expect(g).not.toContain("provider_card_user_key");
    }
  });

  it("kart saklama onayı varsayılan KAPALI ve kayıt yalnız açık rızayla yapılır", () => {
    const button = readFileSync(join(ROOT, "src/app/app/abonelik/checkout-button.tsx"), "utf8");
    expect(button).toMatch(/useState\(false\);[\s\S]*saveCard/);
    expect(button).toContain('fd.set("save_card", "1")');
    const callback = readFileSync(join(ROOT, "src/app/api/iyzico/callback/route.ts"), "utf8");
    expect(callback).toContain("meta.saveCard === true");
    // Doğrulama zinciri kart kaydından ÖNCE çalışır.
    expect(callback.indexOf("verifyCheckoutPayment(result")).toBeLessThan(callback.indexOf("saveCardFromPayment("));
  });
});
