import { describe, expect, it } from "vitest";
import { SETTINGS_DIRECTORY } from "./settings-directory";
import { ITEM_ICONS } from "./settings-index";

describe("Ayarlar dizini kart ikonları", () => {
  it("her ayar kartının kendi ikonu var (yedek dişli ikonuna düşen kart yok)", () => {
    const missing = SETTINGS_DIRECTORY.flatMap((c) => c.items.map((i) => i.href)).filter((h) => !ITEM_ICONS[h]);
    expect(missing).toEqual([]);
  });
});
