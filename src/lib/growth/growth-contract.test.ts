import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("büyüme sözleşmesi", () => {
  const lib = ["attribution.ts", "settings.ts", "store.ts", "capture.ts"].map((f) => read(`src/lib/growth/${f}`)).join("\n");
  const actions = read("src/app/actions/growth.ts");
  const officePage = read("src/app/app/buyume/page.tsx");

  it("ödül tutarı/oranı kodda sabit değildir (yalnız kural satırından)", () => {
    expect(lib).not.toMatch(/reward_value\s*[:=]\s*\d/);
    expect(officePage).not.toMatch(/\d+\s*TL|%\s*\d+|ay ücretsiz|bedava/i);
  });

  it("program varsayılan kapalıdır", () => {
    expect(read("src/lib/growth/settings.ts")).toContain("referralEnabled: false, partnerEnabled: false");
  });

  it("kişisel veri toplanmaz: IP, cihaz izi, telefon, e-posta atıf kaydına yazılmaz", () => {
    const store = read("src/lib/growth/store.ts");
    const insert = store.slice(store.indexOf('from("signup_attributions").insert'));
    expect(insert).not.toMatch(/ip_hash|clientIp|user-agent|phone|email/i);
    expect(read("supabase/migrations/20260825000800_growth_referral_partner_attribution.sql")).not.toMatch(/^\s+signup_ip_hash\s+text/m);
    expect(read("supabase/migrations/20260825000900_growth_click_counters.sql")).not.toMatch(/ip_address|ip_hash|user_agent/i);
  });

  it("her action yetki/personel kapısından geçer; 'use server' dosyası yalnız async fonksiyon export eder", () => {
    expect(actions.startsWith('"use server"')).toBe(true);
    expect(actions).toMatch(/requirePermission\("settings", "edit"\)/);
    expect(actions).toMatch(/guardPlatformAction/);
    const exportsList = [...actions.matchAll(/^export (\w+)/gm)].map((m) => m[1]);
    expect(exportsList.filter((k) => k !== "async" && k !== "type")).toEqual([]);
  });

  it("kayıt akışı: gizli alanlar form ve sunucuda bağlı, atıf hatası kaydı bozmaz", () => {
    expect(read("src/app/kayit/register-form.tsx")).toContain("<AttributionFields");
    expect(read("src/app/kayit/page.tsx")).toContain("utm_source");
    expect(read("src/app/actions/auth.ts")).toContain("recordSignupAttributionFromRequest(tenantId, formData)");
    expect(read("src/lib/growth/capture.ts")).toMatch(/catch \(e\)/);
  });

  it("vitrin altbilgisi dürüst ifade ve ölçülen bağlantı kullanır", () => {
    const v = read("src/app/vitrin/[slug]/page.tsx");
    expect(v).toContain("vitrinSignatureHref(slug)");
    expect(v).toContain("EmlakSoft ile hazırlandı");
  });

  it("çerez birinci taraf, httpOnly ve ilk dokunuş kazanır", () => {
    const cap = read("src/lib/growth/capture.ts");
    expect(cap).toContain("httpOnly: true");
    expect(cap).toContain('sameSite: "lax"');
    expect(cap).toMatch(/if \(!req\.cookies\.get\(REF_COOKIE\)/);
  });

  it("tek menü girişi ve admin yan menü satırı vardır", () => {
    expect(read("src/lib/nav-config.ts")).toContain('href: "/app/buyume"');
    expect(read("src/components/admin/admin-sidebar.tsx")).toContain('href: "/admin/growth"');
  });
});
