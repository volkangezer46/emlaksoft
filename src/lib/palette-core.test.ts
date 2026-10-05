import { describe, expect, it } from "vitest";
import { ACCENTS } from "./theme";
import {
  APP_ACTIONS,
  APPEARANCE_COMMANDS,
  getAppActions,
  getAppearanceCommands,
  getAppGoItems,
  matchesQuery,
  mergeRecent,
  nextUiPrefs,
  parseRecents,
} from "./palette-core";

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

  describe("görünüm komutları", () => {
    it("her vurgu teması için komut üretilir (tek kaynak)", () => {
      const ids = APPEARANCE_COMMANDS.map((c) => c.id);
      for (const a of ACCENTS) expect(ids).toContain(`vurgu:${a.value}`);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("2 karakterden kısa sorguda liste açılmaz", () => {
      expect(getAppearanceCommands("k", { ui: null })).toEqual([]);
    });

    it("'koyu tema' ve vurgu aramaları, seçili olanı işaretler", () => {
      const dark = getAppearanceCommands("koyu tema", { theme: "dark", ui: null });
      expect(dark.map((c) => c.id)).toEqual(["tema:dark"]);
      expect(dark[0]!.current).toBe(true);
      const bordo = getAppearanceCommands("bordo", { accent: "ocean", ui: null });
      expect(bordo.map((c) => c.id)).toEqual(["vurgu:burgundy"]);
      expect(bordo[0]!.current).toBe(false);
    });

    it("sade görünüm çerez adı yoksa gizlenir (yazı boyutu paletten kalktı); sade yalnız uygulanabilir yönüyle", () => {
      expect(getAppearanceCommands("sade görünüm", { ui: null })).toEqual([]);
      const ui = { simple: true } as const;
      expect(getAppearanceCommands("yazı boyutu", { ui })).toEqual([]);
      expect(getAppearanceCommands("sade görünüm", { ui }).map((c) => c.id)).toEqual(["sade:off"]);
      expect(getAppearanceCommands("sade görünüm", { ui: { ...ui, simple: false } }).map((c) => c.id)).toEqual(["sade:on"]);
    });

    it("nextUiPrefs yalnız sade görünümü değiştirir", () => {
      const cur = { simple: true } as const;
      expect(nextUiPrefs(cur, { kind: "simple", value: false })).toEqual({ simple: false });
      expect(nextUiPrefs(cur, { kind: "theme", value: "dark" })).toEqual(cur);
    });
  });
});
