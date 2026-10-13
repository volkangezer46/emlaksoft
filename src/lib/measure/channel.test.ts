import { describe, expect, it } from "vitest";
import { CHANNELS, CHANNEL_LABEL, classifyChannel, cleanHost, type Channel, type ChannelInput } from "./channel";

/** Tablo testi: classifyChannel'ın HER dalı (dokunuş → UTM → yönlendiren → bilinmiyor). */
const CASES: [string, ChannelInput, Channel][] = [
  // 1) EmlakSoft dokunuşu her şeyden önce gelir
  ["ofis daveti", { touch: { kind: "referral" }, utm_medium: "cpc", refHost: "google.com" }, "office_invite"],
  ["iş ortağı", { touch: { kind: "partner" } }, "partner"],
  ["vitrin imzası", { touch: { kind: "powered_by" }, refHost: "" }, "vitrin_signature"],
  // 2) UTM ortamı (medium)
  ["cpc → ücretli arama", { utm_source: "google", utm_medium: "cpc" }, "paid_search"],
  ["ppc büyük harf", { utm_source: "bing", utm_medium: "PPC" }, "paid_search"],
  ["paid", { utm_medium: "paid" }, "paid_search"],
  ["email ortamı", { utm_source: "bulten", utm_medium: "email" }, "email"],
  ["newsletter ortamı", { utm_medium: "newsletter" }, "email"],
  ["social ortamı", { utm_source: "instagram", utm_medium: "social" }, "social"],
  ["paid_social", { utm_medium: "paid_social" }, "social"],
  ["organic + arama", { utm_source: "google", utm_medium: "organic" }, "organic_search"],
  ["organic + sosyal kaynak", { utm_source: "facebook", utm_medium: "organic" }, "social"],
  ["referral ortamı", { utm_source: "forum", utm_medium: "referral" }, "referral_site"],
  ["tanınmayan ortam", { utm_source: "google", utm_medium: "afis" }, "unknown"],
  // 3) yalnız UTM kaynağı (ortam yok)
  ["kaynak sosyal", { utm_source: "linkedin" }, "social"],
  ["kaynak e-posta", { utm_source: "newsletter" }, "email"],
  ["kaynak arama motoru", { utm_source: "yandex" }, "organic_search"],
  ["kaynak tanınmıyor", { utm_source: "kampanya-x" }, "unknown"],
  // 4) yönlendiren ana makine
  ["Google araması", { refHost: "www.google.com.tr" }, "organic_search"],
  ["Bing", { refHost: "bing.com" }, "organic_search"],
  ["DuckDuckGo", { refHost: "duckduckgo.com" }, "organic_search"],
  ["Gmail", { refHost: "mail.google.com" }, "email"],
  ["Outlook", { refHost: "outlook.live.com" }, "email"],
  ["Facebook mobil", { refHost: "m.facebook.com" }, "social"],
  ["t.co", { refHost: "t.co" }, "social"],
  ["LinkedIn", { refHost: "www.linkedin.com" }, "social"],
  ["başka site", { refHost: "emlakhaber.com" }, "referral_site"],
  ["kendi alan adımız → doğrudan", { refHost: "emlaksoft.com.tr" }, "direct"],
  ["kendi www → doğrudan", { refHost: "www.emlaksoft.com.tr" }, "direct"],
  ["vitrin (aynı alan) → doğrudan", { refHost: "emlaksoft.com.tr:443" }, "direct"],
  ["özel kendi alan adı", { refHost: "ornek.test", ownHosts: ["ornek.test"] }, "direct"],
  ["yönlendiren yok (bilinen) → doğrudan", { refHost: "" }, "direct"],
  ["geçersiz host → doğrudan", { refHost: "<script>" }, "direct"],
  // 5) hiç bilgi taşınmadı
  ["bilgi yok → bilinmiyor", {}, "unknown"],
  ["refHost null → bilinmiyor", { refHost: null }, "unknown"],
];

describe("classifyChannel", () => {
  it.each(CASES)("%s", (_name, input, expected) => {
    expect(classifyChannel(input)).toBe(expected);
  });

  it("tablo her kanalı en az bir kez kapsar", () => {
    const seen = new Set(CASES.map(([, , c]) => c));
    for (const c of CHANNELS) expect(seen.has(c), c).toBe(true);
  });

  it("her kanalın Türkçe etiketi var", () => {
    for (const c of CHANNELS) expect(CHANNEL_LABEL[c].length).toBeGreaterThan(2);
    expect(CHANNEL_LABEL.bilinmiyor).toBe("Atıfsız kayıt");
  });

  it("cleanHost: küçük harf, port ve son nokta atılır; geçersiz boş döner", () => {
    expect(cleanHost("WWW.Google.COM:443")).toBe("www.google.com");
    expect(cleanHost("example.com.")).toBe("example.com");
    expect(cleanHost("a b")).toBe("");
    expect(cleanHost("x".repeat(101))).toBe("");
    expect(cleanHost(null)).toBe("");
  });
});
