import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NUDGE_MOMENTS } from "@/lib/growth/program";
import { TOUR_ROLES } from "@/lib/product-tour-roles";
import { isUiStateKey, nudgeStateKey, parseUiState, tourStateKey, UI_STATE_KEY_RE } from "@/lib/ui-state";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("arayüz durumu (YD5): tur ve davet kartı profilde", () => {
  it("anahtar deseni migration'daki RPC denetimiyle birebir", () => {
    const sql = read("supabase/migrations/20261015045000_profiles_ui_state.sql");
    expect(sql).toContain(`p_key !~ '${UI_STATE_KEY_RE.source}'`);
  });

  it("tüm tur kimlikleri ve davet anları geçerli anahtar üretir", () => {
    for (const id of Object.keys(TOUR_ROLES)) expect(isUiStateKey(tourStateKey(id)), id).toBe(true);
    for (const m of NUDGE_MOMENTS) expect(isUiStateKey(nudgeStateKey(m)), m).toBe(true);
    expect(isUiStateKey("theme:dark")).toBe(false);
    expect(isUiStateKey("tour:../x")).toBe(false);
  });

  it("parseUiState bozuk değeri ve yabancı anahtarı atar", () => {
    expect(parseUiState(null)).toEqual({});
    expect(parseUiState([])).toEqual({});
    expect(parseUiState({ "tour:danisman": "2026-10-14T10:00:00Z", "x": "1", "nudge:first_deal": 5 })).toEqual({
      "tour:danisman": "2026-10-14T10:00:00Z",
    });
  });

  it("tur açılınca profile yazılır, yeni cihazda otomatik başlatmadan önce profile sorulur", () => {
    expect(read("src/app/app/product-tour.tsx")).toMatch(/markUiState\(tourStateKey\(id\)\)/);
    const lazy = read("src/app/app/product-tour-lazy.tsx");
    expect(lazy).toMatch(/loadUiState\(\)/);
    expect(lazy).toMatch(/markTourDone\(id, seenAt\)/);
  });

  it("davet kartı kapatması profile yazılır ve sunucu kapatılmış kartı çizmez", () => {
    expect(read("src/components/app/referral-nudge-card.tsx")).toMatch(/markUiState\(nudgeStateKey\(moment\)\)/);
    expect(read("src/components/app/referral-nudge.tsx")).toMatch(/uiState\?\.\[nudgeStateKey\(moment\)\]\) return null/);
  });

  it("eylemler kapılı; destek oturumu kullanıcının durumunu değiştirmez", () => {
    const src = read("src/app/actions/ui-state.ts");
    expect(src.match(/await requireActiveTenant\(\)/g)).toHaveLength(2);
    expect(src.match(/gate\.impersonating/g)).toHaveLength(2);
  });
});
