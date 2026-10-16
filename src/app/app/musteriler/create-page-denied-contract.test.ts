import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sözleşme: müşteri/talep/kampanya/otomasyon "yeni" sayfaları ekleme yetkisi yokken kullanıcıyı sessizce listeye
 * GERİ ATMAZ; açıklamalı yetki kartına (`deniedPageHref`) gider. Sessiz dönüş "tıkladım, hiçbir şey olmadı" hissi verir.
 */
const root = path.resolve(import.meta.dirname, "../../../..");
const PAGES = [
  "src/app/app/musteriler/yeni/page.tsx",
  "src/app/app/talepler/yeni/page.tsx",
  "src/app/app/kampanyalar/yeni/page.tsx",
  "src/app/app/otomasyonlar/yeni/page.tsx",
];

describe("yeni kayıt sayfaları yetki reddi", () => {
  it.each(PAGES)("%s açıklamalı yetki kartına gider", (rel) => {
    const src = readFileSync(path.join(root, rel), "utf8");
    expect(src).toMatch(/redirect\(deniedPageHref\("[a-z_]+"\)\)/);
    expect(src).not.toMatch(/redirect\("\/app\/(talepler|kampanyalar|otomasyonlar|musteriler)"\)/);
  });

  it("kampanya listesinde ?yeni= takma ad yönlendirmesi yok", () => {
    const src = readFileSync(path.join(root, "src/app/app/kampanyalar/page.tsx"), "utf8");
    expect(src).not.toContain('redirect("/app/kampanyalar/yeni")');
  });
});
