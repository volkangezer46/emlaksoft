import { describe, expect, it } from "vitest";
import { activityHref, hasActivityFilter, parseActivityFilters } from "./activity-query";
import { hrefWith } from "@/app/admin/hatalar/errors-href";
import {
  DEFAULT_TRIAL_DAYS,
  parseSettingBool,
  parseTrialDays,
} from "@/lib/platform-setting-keys";

describe("aktivite süzgeci", () => {
  it("geçersiz değerleri atar, geçerlileri kırpar", () => {
    const f = parseActivityFilters({
      kaynak: "x",
      gun: "yarin",
      islem: "  platform_staff  ",
      baslangic: "2026-13",
      bitis: "2026-08-16",
      kisi: "a".repeat(200),
    });
    expect(f.kaynak).toBeUndefined();
    expect(f.gun).toBeUndefined();
    expect(f.islem).toBe("platform_staff");
    expect(f.baslangic).toBeUndefined();
    expect(f.bitis).toBe("2026-08-16");
    expect(f.kisi).toHaveLength(80);
  });

  it("adres süzgeci iki yönlü taşır", () => {
    const f = parseActivityFilters({ kaynak: "platform", q: "ticket", baslangic: "2026-08-01" });
    expect(hasActivityFilter(f)).toBe(true);
    const href = activityHref(f, { sayfa: 3 });
    expect(href).toBe("/admin/aktivite?kaynak=platform&q=ticket&baslangic=2026-08-01&sayfa=3");
    expect(parseActivityFilters(Object.fromEntries(new URL(href, "http://x").searchParams))).toEqual(f);
    expect(activityHref({})).toBe("/admin/aktivite");
    expect(hasActivityFilter({})).toBe(false);
  });
});

describe("hata listesi adresi", () => {
  it("süzgeçleri ve sayfayı korur", () => {
    expect(hrefWith({})).toBe("/admin/sistem?sekme=hatalar");
    expect(hrefWith({ durum: "cozulmus", q: "x y", kaynak: "server", ofis: "abc", sayfa: 2 })).toBe(
      "/admin/sistem?sekme=hatalar&durum=cozulmus&q=x+y&kaynak=server&ofis=abc&sayfa=2",
    );
    expect(hrefWith({ sayfa: 1 })).toBe("/admin/sistem?sekme=hatalar");
  });
});

describe("platform genel ayar çözümleyicileri", () => {
  it("bool ve deneme süresi", () => {
    expect(parseSettingBool("on", false)).toBe(true);
    expect(parseSettingBool("off", true)).toBe(false);
    expect(parseSettingBool(null, true)).toBe(true);
    expect(parseSettingBool("garip", false)).toBe(false);
    expect(parseTrialDays("30")).toBe(30);
    expect(parseTrialDays("0")).toBe(DEFAULT_TRIAL_DAYS);
    expect(parseTrialDays("91")).toBe(DEFAULT_TRIAL_DAYS);
    expect(parseTrialDays("abc")).toBe(DEFAULT_TRIAL_DAYS);
    expect(parseTrialDays(null)).toBe(DEFAULT_TRIAL_DAYS);
  });
});

describe("yeni platform formları sekme sözleşmesi dışındadır", () => {
  it("gerekçe: TabbedFormShell kullanmaz, PageTabs / satır içi formdur", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(import.meta.dirname, "../../..");
    // form-tabs-contract yalnız TabbedFormShell kullanan "yeni kayıt" formlarını kapsar. Aşağıdakiler
    // PageTabs sekmeli sayfalar ve tek amaçlı satır içi formlardır; sekme alan listesi (`*-tabs.ts`) yoktur.
    for (const rel of [
      "src/app/admin/members/[id]/member-forms.tsx",
      "src/app/admin/hesabim/account-forms.tsx",
      "src/app/admin/personel/[id]/staff-account-panel.tsx",
      "src/app/admin/sistem/messaging-keys-form.tsx",
    ]) {
      const src = readFileSync(path.join(root, rel), "utf8");
      expect(src, rel).not.toContain("TabbedFormShell");
      expect(src, rel).not.toMatch(/localStorage|sessionStorage/);
      expect(src, rel).not.toMatch(/<input[^>]*type="(tel|email)"/);
    }
  });
});
