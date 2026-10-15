import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accusativeSuffix,
  lastSpokenWord,
  locativeSuffix,
  pctPossessive,
  possessiveSuffix,
  withAccusative,
  withLocative,
} from "./tr-suffix";
import { FORBIDDEN_TERMS } from "./terms";
import { KNOWN_ENTITY_TYPES, entityLabel } from "./labels/entity";
import { splitNoteLinks, noteLink } from "./note-links";

const ROOT = process.cwd();

/** Ekleri bu pakette düzeltilen dosyalar (B194 sözleşme i): sabit "'i/'te" eki yazılamaz. */
const SUFFIX_FILES = [
  "src/app/app/_home/metrik-seridi.tsx",
  "src/app/app/aidat/page.tsx",
  "src/app/app/_home/huni-hedef.tsx",
  "src/app/app/lig/challenges-panel.tsx",
  "src/app/app/abonelik/page.tsx",
  "src/components/public/gallery-lightbox.tsx",
  "src/app/app/ilan-kontrol/eksik-portal/page.tsx",
];

/** Terim sözlüğüne bağlanan dosyalar (B193). */
const TERM_FILES = ["src/app/app/pano-tv/tv-board.tsx", "src/app/app/arama-sonuclari/page.tsx", "src/lib/oversight/feed.ts", "src/lib/product-tour-data.ts"];

const HARD_SUFFIX = /\$\{[^}]+\}(?:'|&apos;)(i|ı|u|ü|si|sı|su|sü|yi|yı|te|ta|de|da|ye|ya)\b/;
const HARD_PCT = /%\$\{[^}]+\}'/;

describe("Türkçe ek seçici (B194)", () => {
  it("sayının okunuşundaki son kelime", () => {
    expect(lastSpokenWord(0)).toBe("sıfır");
    expect(lastSpokenWord(16)).toBe("altı");
    expect(lastSpokenWord(40)).toBe("kırk");
    expect(lastSpokenWord(100)).toBe("yüz");
    expect(lastSpokenWord(2000)).toBe("bin");
    expect(lastSpokenWord(3_000_000)).toBe("milyon");
    expect(lastSpokenWord("12,5")).toBe("beş");
  });

  it("yüzdelerde iyelik eki okunuşa uyar", () => {
    expect(pctPossessive(0)).toBe("%0'ı");
    expect(pctPossessive(16)).toBe("%16'sı");
    expect(pctPossessive(100)).toBe("%100'ü");
    expect(pctPossessive(40)).toBe("%40'ı");
    expect(pctPossessive(50)).toBe("%50'si");
    expect(pctPossessive(30)).toBe("%30'u");
    expect(pctPossessive(3)).toBe("%3'ü");
    expect(possessiveSuffix(7)).toBe("si");
  });

  it("özel adlarda bulunma, sayılarda belirtme eki", () => {
    expect(withLocative("Sahibinden")).toBe("Sahibinden'de");
    expect(withLocative("Hepsiemlak")).toBe("Hepsiemlak'ta");
    expect(withLocative("Emlakjet")).toBe("Emlakjet'te");
    expect(locativeSuffix("Zingat")).toBe("ta");
    expect(withAccusative(2)).toBe("2'yi");
    expect(withAccusative(1)).toBe("1'i");
    expect(accusativeSuffix(6)).toBe("yı");
  });

  it("kendi dosyalarında sabit ek kalıbı ('%100'i', 'Sahibinden'te') yok", () => {
    for (const rel of SUFFIX_FILES) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src, rel).not.toMatch(HARD_SUFFIX);
      expect(src, rel).not.toMatch(HARD_PCT);
    }
  });
});

describe("terim sözlüğü (B193) ve etiket sözlüğü (B191)", () => {
  it("terim dosyalarında 'fırsat', 'Yeni ilan', 'İlanın' yok", () => {
    for (const rel of TERM_FILES) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      for (const re of FORBIDDEN_TERMS) expect(src, `${rel} ${re}`).not.toMatch(re);
    }
  });

  it("denetim izindeki türler Türkçe; bilinmeyen tür 'Kayıt', ham kod görünmez", () => {
    for (const t of ["task", "customer_demand", "support_ticket", "cash_entry", "tenant", "customers", "property"]) {
      expect(KNOWN_ENTITY_TYPES).toContain(t);
      expect(entityLabel(t)).not.toMatch(/[a-z]+_[a-z]+|^[a-z]+$/);
    }
    expect(entityLabel("property")).toBe("Portföy");
    expect(entityLabel("bilinmeyen_tur")).toBe("Kayıt");
    expect(entityLabel(null)).toBe("Kayıt");
  });

  it("ofis kontrolü ve kayıt ekranı sözlüğü kullanır, ham tür/UUID basmaz", () => {
    const feed = readFileSync(join(ROOT, "src/app/app/ofis-kontrol/_components/feed-list.tsx"), "utf8");
    const kayit = readFileSync(join(ROOT, "src/app/app/ofis-kontrol/kayit/page.tsx"), "utf8");
    expect(feed).toContain("entityLabel(r.entity_type)");
    expect(feed).not.toMatch(/\?\? r\.entity_type/);
    expect(kayit).toContain("entityLabel(r.entity_type)");
    expect(kayit).not.toMatch(/String\(r\.entity_id\)\.slice/);
  });

  it("not bağlantıları: etiketli ve çıplak /app yolu bağlantıya çevrilir", () => {
    const parts = splitNoteLinks(`Düzeltin: ${noteLink("İlan kontrolünde aç", "/app/ilan-kontrol/anomaliler?portfoy=abc")}. Eski: /app/gorevler?gorev=1.`);
    expect(parts.filter((p) => p.kind === "link")).toEqual([
      { kind: "link", label: "İlan kontrolünde aç", href: "/app/ilan-kontrol/anomaliler?portfoy=abc" },
      { kind: "link", label: "Aç", href: "/app/gorevler?gorev=1" },
    ]);
    expect(parts.map((p) => (p.kind === "text" ? p.text : "")).join("")).not.toContain("/app/");
  });
});
