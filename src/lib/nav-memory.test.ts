import { describe, expect, it } from "vitest";
import { MAX_NAV_RECENTS, MAX_PINS, parseHrefs, pushRecent, togglePin } from "./nav-memory";

describe("nav-memory", () => {
  it("yalnız güvenli /app yollarını okur, tekrarları atar", () => {
    const raw = JSON.stringify(["/app/musteriler", "/app/musteriler", "//kotu.example", "https://x.y/app", "/admin", "/app/a?b=1", 5]);
    expect(parseHrefs(raw, 6)).toEqual(["/app/musteriler"]);
    expect(parseHrefs("{bozuk", 6)).toEqual([]);
    expect(parseHrefs(null, 6)).toEqual([]);
  });

  it("sabitleme aç/kapa ve üst sınır", () => {
    expect(togglePin(["/app/a"], "/app/b")).toEqual(["/app/a", "/app/b"]);
    expect(togglePin(["/app/a", "/app/b"], "/app/a")).toEqual(["/app/b"]);
    let list: string[] = [];
    for (let i = 0; i < MAX_PINS + 3; i++) list = togglePin(list, `/app/s${i}`);
    expect(list).toHaveLength(MAX_PINS);
  });

  it("son kullanılanlar: başa alır, tekrarlamaz, sınırlar", () => {
    expect(pushRecent(["/app/a", "/app/b"], "/app/b")).toEqual(["/app/b", "/app/a"]);
    let list: string[] = [];
    for (let i = 0; i < MAX_NAV_RECENTS + 4; i++) list = pushRecent(list, `/app/s${i}`);
    expect(list).toHaveLength(MAX_NAV_RECENTS);
    expect(list[0]).toBe(`/app/s${MAX_NAV_RECENTS + 3}`);
  });
});
