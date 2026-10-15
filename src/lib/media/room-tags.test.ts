import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPTION_MAX,
  FLOOR_PLAN_TAG,
  ROOM_TAGS,
  ROOM_TAG_LABEL,
  isFloorPlan,
  mediaAltText,
  mediaShortLabel,
  normalizeCaption,
  normalizeRoomTag,
  splitFloorPlans,
} from "./room-tags";

const MIGRATION = "supabase/migrations/20261019030000_property_media_room_tag_caption.sql";

describe("oda etiketi listesi SQL CHECK ile birebir", () => {
  it("migration CHECK listesi = ROOM_TAGS ve açıklama sınırı aynı", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const block = /room_tag in \(([\s\S]*?)\)\)/.exec(sql)?.[1] ?? "";
    const sqlTags = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(sqlTags).toEqual([...ROOM_TAGS]);
    expect(sql).toContain(`char_length(caption) between 1 and ${CAPTION_MAX}`);
    // Yeni migration'larda üst düzey notify yok; rollback dosyası var.
    expect(sql).not.toMatch(/^notify pgrst/m);
    expect(readFileSync("supabase/rollbacks/20261019030000_property_media_room_tag_caption.rollback.sql", "utf8")).toContain(
      "drop column if exists room_tag",
    );
  });

  it("her etiketin Türkçe adı var; kat planı listede", () => {
    for (const t of ROOM_TAGS) expect(ROOM_TAG_LABEL[t].length).toBeGreaterThan(1);
    expect(ROOM_TAGS).toContain(FLOOR_PLAN_TAG);
  });
});

describe("normalize", () => {
  it("bilinmeyen/boş etiket null", () => {
    expect(normalizeRoomTag("salon")).toBe("salon");
    expect(normalizeRoomTag(" mutfak ")).toBe("mutfak");
    expect(normalizeRoomTag("")).toBeNull();
    expect(normalizeRoomTag("Salon")).toBeNull();
    expect(normalizeRoomTag(42)).toBeNull();
  });

  it("açıklama tek satır, 80 karakter, boş null", () => {
    expect(normalizeCaption("  Deniz \n manzaralı   salon ")).toBe("Deniz manzaralı salon");
    expect(normalizeCaption("   ")).toBeNull();
    expect(normalizeCaption(null)).toBeNull();
    expect(Array.from(normalizeCaption("ş".repeat(200)) ?? "").length).toBe(CAPTION_MAX);
  });
});

describe("kat planı ayrımı ve alt metin", () => {
  it("splitFloorPlans sırayı korur", () => {
    const rows = [
      { id: "a", room_tag: "salon" },
      { id: "b", room_tag: "kat_plani" },
      { id: "c", room_tag: null },
      { id: "d", room_tag: "kat_plani" },
    ];
    const { photos, floorPlans } = splitFloorPlans(rows);
    expect(photos.map((r) => r.id)).toEqual(["a", "c"]);
    expect(floorPlans.map((r) => r.id)).toEqual(["b", "d"]);
    expect(isFloorPlan({ room_tag: undefined })).toBe(false);
  });

  it("alt metin: açıklama > etiket > yedek", () => {
    expect(mediaAltText({ caption: "Ebeveyn banyosu", room_tag: "banyo" }, "x", "Kadıköy 3+1")).toBe(
      "Ebeveyn banyosu · Kadıköy 3+1",
    );
    expect(mediaAltText({ room_tag: "mutfak" }, "x")).toBe("Mutfak");
    expect(mediaAltText({}, "Portföy fotoğrafı 3")).toBe("Portföy fotoğrafı 3");
    expect(mediaShortLabel({ room_tag: "kat_plani" })).toBe("Kat planı");
    expect(mediaShortLabel({ room_tag: "bilinmeyen" })).toBeNull();
  });
});
