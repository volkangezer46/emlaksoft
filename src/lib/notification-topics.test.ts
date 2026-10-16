import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  notificationTopic,
  pushActionsFor,
  pushEntityRef,
  pushTag,
  safeTelHref,
  TOPIC_HREF_PREFIXES,
  topicFromHref,
} from "./notification-topics";

const UUID = "0b8f3c2e-1d4a-4f6b-9a7c-2e5d8f1a3b4c";

describe("notification topics (GA-08)", () => {
  it("prefKey wins over href; href prefix match is segment-exact", () => {
    expect(notificationTopic({ prefKey: "assignment", href: "/app/musteriler/1" })).toBe("atama");
    expect(notificationTopic({ href: "/app/gorevler?gorev=x" })).toBe("gorev");
    expect(notificationTopic({ href: "/app/randevular/yeni" })).toBe("randevu");
    expect(topicFromHref("/app/gorevlerx")).toBeNull();
    expect(notificationTopic({ href: "https://evil.example/app/gorevler" })).toBe("sistem");
    expect(notificationTopic({})).toBe("sistem");
  });

  it("SQL trigger helper uses the same prefix list in the same order", () => {
    const sql = readFileSync("supabase/migrations/20261020000000_finance_hrefs.sql", "utf8") /* son tanım (WP6) */;
    const rows = [...sql.matchAll(/\((\d+), '([^']+)', '([a-z]+)'\)/g)].map((m) => [m[2], m[3]]);
    expect(rows).toEqual(TOPIC_HREF_PREFIXES.map(([p, t]) => [p, t]));
    expect(sql).not.toMatch(/^notify pgrst/m);
  });
});

describe("push payload helpers (MP3 / GA-15)", () => {
  it("tasks get Tamamla + Yarına ertele; phone records get Ara + Aç; others Aç", () => {
    const entity = pushEntityRef("task", UUID);
    expect(pushActionsFor({ entity }).map((a) => a.action)).toEqual(["done", "snooze"]);
    expect(pushActionsFor({ tel: "0532 123 45 67" }).map((a) => a.action)).toEqual(["call", "open"]);
    expect(pushActionsFor({ tel: "javascript:alert(1)" }).map((a) => a.action)).toEqual(["open"]);
    expect(pushActionsFor({}).map((a) => a.action)).toEqual(["open"]);
  });

  it("entity ids must be UUIDs; tel hrefs are digits only", () => {
    expect(pushEntityRef("task", "1; drop")).toBeUndefined();
    expect(safeTelHref("+90 (532) 123-45-67")).toBe("tel:+905321234567");
    expect(safeTelHref("tel:123")).toBeNull();
  });

  it("tag collapses per record / dedupe key", () => {
    const entity = pushEntityRef("task", UUID);
    expect(pushTag({ topic: "gorev", entity })).toBe(`gorev:${UUID}`);
    expect(pushTag({ topic: "gorev", dedupeKey: "k1", entity })).toBe("d:k1");
    expect(pushTag({ topic: "randevu", href: "/app/randevular?randevu=1#x" })).toBe("randevu:/app/randevular?randevu=1");
  });
});
