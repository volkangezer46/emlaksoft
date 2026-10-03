import { describe, expect, it } from "vitest";
import { APP_ACTIONS, getAppActions, getAppGoItems, matchesQuery, mergeRecent, parseRecents } from "./palette-core";

describe("palette-core", () => {
  it("Türkçe duyarlı süzgeç", () => {
    expect(matchesQuery("Işık Raporu", "ışık")).toBe(true);
    expect(matchesQuery("İlan", "ilan")).toBe(true);
    expect(matchesQuery("Müşteriler", "")).toBe(true);
    expect(matchesQuery("Müşteriler", "xyz")).toBe(false);
  });

  it("Git yalnız yetkili modüllerin sayfalarını verir", () => {
    const items = getAppGoItems(["customers"]);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.href === "/app/musteriler")).toBe(true);
    expect(items.some((i) => i.href === "/app/portfoyler")).toBe(false);
    expect(getAppGoItems([])).toEqual([]);
  });

  it("Eylemler yetkiye göre süzülür", () => {
    expect(getAppActions(["tasks"]).map((a) => a.href)).toEqual(["/app/gorevler/yeni"]);
    expect(getAppActions(["customers", "tasks"], "müşteri").map((a) => a.label)).toEqual(["Yeni müşteri"]);
    expect(getAppActions([])).toEqual([]);
  });

  it("son görülenler: /app dışı veya protokol-göreli href'ler okunurken elenir", () => {
    const raw = JSON.stringify([
      { label: "ok", href: "/app/musteriler/1", kind: "customer" },
      { label: "dış", href: "https://kotu.example/app", kind: "customer" },
      { label: "göreli", href: "//kotu.example", kind: "customer" },
      { label: "başka", href: "/admin/x", kind: "customer" },
    ]);
    expect(parseRecents(raw).map((r) => r.label)).toEqual(["ok"]);
  });

  it("son görülenler: bozuk veri güvenli, tekrar yok, en fazla 8", () => {
    expect(parseRecents("{bozuk")).toEqual([]);
    expect(parseRecents('{"a":1}')).toEqual([]);
    expect(parseRecents(null)).toEqual([]);
    let list = parseRecents(null);
    for (let i = 0; i < 12; i++) list = mergeRecent(list, { label: `s${i}`, href: `/a/${i}`, kind: "page" });
    list = mergeRecent(list, { label: "tekrar", href: "/a/10", kind: "page" });
    expect(list).toHaveLength(8);
    expect(list[0]!.label).toBe("tekrar");
    expect(list.filter((r) => r.href === "/a/10")).toHaveLength(1);
  });
});

describe("palette-core: yeni eylemleri", () => {
  it("her statik /yeni sayfası bir eylemdir; kısayollar benzersizdir", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const found: string[] = [];
    const walk = (dir: string, url: string) => {
      for (const name of readdirSync(dir)) {
        const full = `${dir}/${name}`;
        if (!statSync(full).isDirectory() || name.startsWith("[")) continue;
        const next = `${url}/${name}`;
        if (name === "yeni") found.push(next);
        walk(full, next);
      }
    };
    walk("src/app/app", "/app");
    const hrefs = APP_ACTIONS.map((a) => a.href);
    expect(found.filter((h) => !hrefs.includes(h))).toEqual([]);
    const shortcuts = APP_ACTIONS.flatMap((a) => a.shortcut ?? []);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it("paket kilitli sayfalar Eylemler'den elenir", () => {
    const all = ["customers", "properties"] as const;
    expect(getAppActions(all, "", ["/app/portfoyler"]).map((a) => a.href)).toEqual(["/app/hizli", "/app/musteriler/yeni"]);
  });
});

