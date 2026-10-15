import { describe, expect, it } from "vitest";
import {
  FAVORITES_LEAD_MAX_ITEMS,
  FAVORITES_LEAD_SOURCE,
  buildFavoritesLeadMessage,
  buildFavoritesLeadPayload,
  favoritesLeadFormError,
} from "./vitrin-favorites-lead";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number) => ({ id: id(n), title: `İlan ${n}`, href: `/vitrin/ofis/ilan-${n}` });
const form = { fullName: "  Ayşe Yılmaz ", phone: "05321234567", kvkk: true, marketingOptIn: false };

describe("buildFavoritesLeadPayload", () => {
  it("mevcut aday ucunun alan adlarını ve favori ilan kimliklerini taşır", () => {
    const p = buildFavoritesLeadPayload(form, [item(1), item(2)], "req-1");
    expect(p).toMatchObject({
      full_name: "Ayşe Yılmaz",
      phone: "05321234567",
      kvkk: true,
      marketing_opt_in: false,
      website: "",
      request_id: "req-1",
      channel: "web_form",
      source: FAVORITES_LEAD_SOURCE,
    });
    expect(p.message).toContain("(2 ilan)");
    expect(p.message).toContain(id(1));
    expect(p.message).toContain(id(2));
  });

  it("honeypot değeri olduğu gibi gider (sunucu sessizce yutar)", () => {
    expect(buildFavoritesLeadPayload({ ...form, website: "spam" }, [item(1)], "r").website).toBe("spam");
  });

  it("pazarlama izni varsayılan kapalı, yalnız açık işaretle true", () => {
    expect(buildFavoritesLeadPayload({ ...form, marketingOptIn: true }, [item(1)], "r").marketing_opt_in).toBe(true);
  });
});

describe("buildFavoritesLeadMessage", () => {
  it("geçersiz kimlikleri atar ve listeyi sınırlar", () => {
    const items = [{ id: "x'; drop", title: "Kötü", href: "/" }, ...Array.from({ length: 20 }, (_, i) => item(i + 1))];
    const m = buildFavoritesLeadMessage(items);
    expect(m).not.toContain("drop");
    expect(m).toContain("(20 ilan)");
    expect(m.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(FAVORITES_LEAD_MAX_ITEMS);
    expect(m).toContain(`ve ${20 - FAVORITES_LEAD_MAX_ITEMS} ilan daha`);
    expect(m.length).toBeLessThanOrEqual(2000);
  });
});

describe("favoritesLeadFormError", () => {
  it("zorunlu alanlar ve KVKK onayı", () => {
    expect(favoritesLeadFormError(form, 1)).toBeNull();
    expect(favoritesLeadFormError(form, 0)).toMatch(/favori/);
    expect(favoritesLeadFormError({ ...form, fullName: " " }, 1)).toMatch(/Ad soyad/);
    expect(favoritesLeadFormError({ ...form, phone: "" }, 1)).toMatch(/telefon/);
    expect(favoritesLeadFormError({ ...form, kvkk: false }, 1)).toMatch(/KVKK/);
  });
});
