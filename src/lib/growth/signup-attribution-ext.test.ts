import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/supabase-mock";

/**
 * SP3 kayıt atfı: atıfsız kayıtta da satır yazılır (kanal direct/unknown), iniş yolu kapsam + ≤120 kuralıyla
 * doğrulanır, ilk/son dokunuş doldurulur; ödül mantığı yalnız ref_kind'e bağlı kalır.
 */
const h = vi.hoisted(() => ({ mock: null as ReturnType<typeof createSupabaseMock> | null, failExt: false }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.mock!.client }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.mock!.client }));
vi.mock("@/lib/platform-settings", () => ({
  getPlatformSettingsMany: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, null])),
  getPlatformSetting: async () => null,
  setPlatformSetting: async () => true,
}));
vi.mock("@/lib/growth/engine", async (orig) => ({
  ...(await orig<typeof import("@/lib/growth/engine")>()),
  grantWelcomeSafe: vi.fn(async () => undefined),
}));

import { cleanLandingPath, cleanUtmText, resolveAttributionInput, signupAttributionColumns } from "./attribution";
import { recordSignupAttributionSafe } from "./store";

const NONE = { cookie: null, ref: null, utm_source: null, utm_medium: null, utm_campaign: null };

describe("atıf sütunları (saf)", () => {
  it("hiç atıf yok, istemci bilgi taşımadı → unknown", () => {
    const c = signupAttributionColumns(resolveAttributionInput(NONE));
    expect(c.channel).toBe("unknown");
    expect(c.landing_path).toBeNull();
    expect(c.first_touch).toEqual({ channel: "unknown" });
  });

  it("istemci iniş yolunu taşıdı ama yönlendiren yok → direct", () => {
    const c = signupAttributionColumns(resolveAttributionInput({ ...NONE, lp: "/fiyatlar", src_host: "" }));
    expect(c.channel).toBe("direct");
    expect(c.landing_path).toBe("/fiyatlar");
    expect(c.last_touch).toEqual({ channel: "direct", lp: "/fiyatlar" });
  });

  it("UTM + yönlendiren + terim/içerik; ofis davet çerezi kanalı belirler, ilk dokunuş çerezdir", () => {
    const input = resolveAttributionInput({
      cookie: "r:abcd2345",
      ref: null,
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "ekim",
      utm_term: "Emlak  CRM <b>",
      utm_content: "v2",
      src_host: "WWW.Google.com",
      lp: "/vitrin/ornek-emlak/12345?x=1",
    });
    const c = signupAttributionColumns(input);
    expect(c.channel).toBe("office_invite");
    expect(c.src_host).toBe("www.google.com");
    expect(c.utm_term).toBe("emlak crm b");
    expect(c.landing_path).toBe("/vitrin/[ofis]/[ilan]");
    expect(c.first_touch).toEqual({ channel: "office_invite", ref: "referral" });
    expect(c.last_touch).toMatchObject({ channel: "paid_search", utm_source: "google", lp: "/vitrin/[ofis]/[ilan]" });
  });

  it.each([
    ["/app/musteriler", null],
    ["/admin", null],
    ["/kayit/tamamla", null],
    ["/giris", null],
    ["/malik-portali/abc", null],
    [`/${"a".repeat(121)}`, null],
    ["/fiyatlar#sss", "/fiyatlar"],
    ["/", "/"],
    ["https://evil.example/", null],
  ])("landing_path %s → %s", (raw, expected) => {
    expect(cleanLandingPath(raw)).toBe(expected);
  });

  it("utm_term/utm_content temizliği: kontrol karakteri ve <>\"\\ atılır, ≤64", () => {
    expect(cleanUtmText("  İstanbul\u0000 Emlak ")).toBe("istanbul emlak");
    expect(cleanUtmText("x".repeat(80))).toHaveLength(64);
    expect(cleanUtmText("   ")).toBeNull();
  });
});

describe("recordSignupAttributionSafe", () => {
  beforeEach(() => {
    h.failExt = false;
    h.mock = createSupabaseMock((q) => {
      if (q.table === "signup_attributions" && q.op === "insert" && h.failExt && q.payload && "channel" in (q.payload as object)) {
        return { error: { code: "42703", message: "column channel does not exist" } };
      }
      return undefined;
    });
  });

  it("atıfsız kayıtta satır YAZILIR ve kanal unknown olur (erken dönüş yok)", async () => {
    await recordSignupAttributionSafe("t-1", resolveAttributionInput(NONE));
    const ins = h.mock!.forTable("signup_attributions", "insert");
    expect(ins).toHaveLength(1);
    expect(ins[0]!.payload).toMatchObject({ tenant_id: "t-1", ref_kind: "none", channel: "unknown", landing_path: null });
  });

  it("taşınan iniş yolu varsa kanal direct ve landing_path yazılır", async () => {
    await recordSignupAttributionSafe("t-2", resolveAttributionInput({ ...NONE, lp: "/araclar/kira-artisi" }));
    const p = h.mock!.forTable("signup_attributions", "insert")[0]!.payload as Record<string, unknown>;
    expect(p).toMatchObject({ channel: "direct", landing_path: "/araclar/kira-artisi" });
    expect(p.first_touch).toEqual({ channel: "direct", lp: "/araclar/kira-artisi" });
  });

  it("ek sütunlar yoksa (migration bekliyor) eski sütunlarla yazılır", async () => {
    h.failExt = true;
    await recordSignupAttributionSafe("t-3", resolveAttributionInput({ ...NONE, utm_source: "google", utm_medium: "cpc" }));
    const ins = h.mock!.forTable("signup_attributions", "insert");
    expect(ins).toHaveLength(2);
    expect(ins[1]!.payload).not.toHaveProperty("channel");
    expect(ins[1]!.payload).toMatchObject({ tenant_id: "t-3", utm_source: "google" });
  });

  it("program kapalıyken davet kodu ödül ilişkisi kurulmaz (ref_kind none) ama kanal etiketi yazılır", async () => {
    await recordSignupAttributionSafe("t-4", resolveAttributionInput({ ...NONE, ref: "abcd2345" }));
    const p = h.mock!.forTable("signup_attributions", "insert")[0]!.payload as Record<string, unknown>;
    expect(p.ref_kind).toBe("none");
    expect(p.referrer_tenant_id).toBeNull();
    expect(p.channel).toBe("office_invite");
  });
});
