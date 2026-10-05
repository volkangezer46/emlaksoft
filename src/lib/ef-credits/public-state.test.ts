import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EF_PLANNED_SUFFIX,
  EF_PROBE_FRESH_MS,
  decideEfPublicState,
  efPlannedLine,
  efPublicStatusOf,
  type EfPublicStateInput,
} from "./public-state-core";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const base: EfPublicStateInput = { key: true, flag: "on", probeAt: iso(HOUR), now: NOW, walletReady: true };
const d = (over: Partial<EfPublicStateInput>) => decideEfPublicState({ ...base, ...over });

describe("decideEfPublicState karar tablosu", () => {
  it("her koşul sağlanınca live", () => {
    expect(d({})).toBe("live");
    expect(d({ flag: "1" })).toBe("live");
    expect(d({ flag: "true" })).toBe("live");
  });
  it("anahtar yok veya bayrak kapalı/boş = soon (probe ve cüzdan ne olursa olsun)", () => {
    expect(d({ key: false })).toBe("soon");
    expect(d({ flag: "off" })).toBe("soon");
    expect(d({ flag: "0" })).toBe("soon");
    expect(d({ flag: null })).toBe("soon");
    expect(d({ flag: undefined })).toBe("soon");
    expect(d({ key: false, flag: null, probeAt: null, walletReady: false })).toBe("soon");
  });
  it("damga yok/geçersiz/gelecekte = maintenance", () => {
    expect(d({ probeAt: null })).toBe("maintenance");
    expect(d({ probeAt: undefined })).toBe("maintenance");
    expect(d({ probeAt: "  " })).toBe("maintenance");
    expect(d({ probeAt: "dün" })).toBe("maintenance");
    expect(d({ probeAt: iso(-HOUR) })).toBe("maintenance");
  });
  it("damga eşikten eskiyse stale; eşik sınırı dahil taze", () => {
    expect(EF_PROBE_FRESH_MS).toBe(7 * 24 * HOUR);
    expect(d({ probeAt: iso(EF_PROBE_FRESH_MS) })).toBe("live");
    expect(d({ probeAt: iso(EF_PROBE_FRESH_MS + 1) })).toBe("stale");
    expect(d({ probeAt: iso(30 * 24 * HOUR) })).toBe("stale");
  });
  it("cüzdan hazır değilse live olmaz (maintenance)", () => {
    expect(d({ walletReady: false })).toBe("maintenance");
  });
  it("durum -> purchasable/live yalnız live için true", () => {
    expect(efPublicStatusOf("live")).toEqual({ state: "live", live: true, purchasable: true });
    for (const s of ["soon", "stale", "maintenance"] as const) {
      expect(efPublicStatusOf(s)).toEqual({ state: s, live: false, purchasable: false });
    }
  });
  it("efPlannedLine: live değilse (planlanan) etiketi, satır yoksa null", () => {
    expect(efPlannedLine("Aylık 40 kontör", true)).toBe("Aylık 40 kontör");
    expect(efPlannedLine("Aylık 40 kontör", false)).toBe(`Aylık 40 kontör ${EF_PLANNED_SUFFIX}`);
    expect(efPlannedLine(null, false)).toBeNull();
  });
});

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\./.test(e)) out.push(f);
  }
  return out;
}

describe("EF kapalıyken para alan yol yok (kaynak sözleşmesi)", () => {
  const billing = read("src/app/actions/billing.ts");
  const body = billing.slice(billing.indexOf("export async function startCreditPackPurchase"));

  it("kontör faturası/ödeme yalnız startCreditPackPurchase içinden, durum kapısından SONRA açılır", () => {
    const gate = body.indexOf("getEfPublicState()");
    expect(gate).toBeGreaterThan(0);
    expect(body).toContain("EF_PURCHASE_CLOSED_MESSAGE");
    expect(gate).toBeLessThan(body.indexOf("isIyzicoConfigured()"));
    expect(gate).toBeLessThan(body.indexOf("createCreditPackInvoice("));
    expect(gate).toBeLessThan(body.indexOf("initializeCheckoutForm("));
    const users = walk(join(root, "src")).filter((f) => /\bcreateCreditPackInvoice\(/.test(readFileSync(f, "utf8")) && !/credit-pack-purchase\.ts$/.test(f));
    expect(users.map((f) => f.replace(root, "").replaceAll("\\", "/"))).toEqual(["/src/app/actions/billing.ts"]);
  });
  it("ofis kontör ekranı aynı kapıyı blockReason olarak kullanır", () => {
    const s = read("src/app/app/abonelik/kontor-section.tsx");
    expect(s).toContain("getEfPublicState()");
    expect(s).toContain("efState.purchasable");
  });
  it("ef-status.ts, public-pricing.ts tek kaynaktan beslenir", () => {
    expect(read("src/lib/site-content/ef-status.ts")).toContain("getEfPublicState");
    expect(read("src/lib/billing/public-pricing.ts")).toContain("getEfPublicState");
  });
  it("fiyat yüzeyleri live değilse kontör satırını '(planlanan)' yazar; satın alma cümlesi yalnız live'da", () => {
    for (const f of ["src/components/pricing.tsx", "src/app/kayit/register-form.tsx"]) {
      const s = read(f);
      expect(s, f).toContain("efPlannedLine(");
      expect(s, f).toContain("efLive");
    }
    expect(read("src/lib/pricing-page-model.ts")).toContain("EF_PLANNED_SUFFIX");
    expect(read("src/lib/site-content/tokens.ts")).toContain("EF_PLANNED_SUFFIX");
    const reg = read("src/app/kayit/register-form.tsx");
    expect(reg).toMatch(/efLive \? "; kontör ile ek sorgu satın alınabilir\."/);
  });
  it("sağlık cron'u: Bearer + heartbeat + ortak probe, service_role istemcisi yok", () => {
    const s = read("src/app/api/cron/ef-kontor-saglik/route.ts");
    expect(s).toMatch(/authorizeCron|CRON_SECRET/);
    expect(s).toMatch(/recordHeartbeat\(\s*"ef-kontor-saglik"/);
    expect(s).toContain("runOrtakProbe(");
    expect(s).not.toContain("createAdminClient");
    expect(s).toContain("maxDuration = 60");
  });
});
