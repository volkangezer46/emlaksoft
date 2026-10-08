import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AVATAR_PRESETS,
  AVATAR_TONE_VARS,
  isAvatarPreset,
  resolveAvatar,
} from "./avatar-presets";

describe("hazır avatar kataloğu", () => {
  it("12-16 adet, anahtarlar benzersiz ve DB biçim kısıtına uyar", () => {
    expect(AVATAR_PRESETS.length).toBeGreaterThanOrEqual(12);
    expect(AVATAR_PRESETS.length).toBeLessThanOrEqual(16);
    const keys = AVATAR_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9-]{1,32}$/);
  });

  it("her ön ayarın tonu tanımlı ve etiketi Türkçe (boş değil)", () => {
    for (const p of AVATAR_PRESETS) {
      expect(AVATAR_TONE_VARS[p.tone]).toHaveLength(2);
      expect(p.label.length).toBeGreaterThan(1);
    }
  });

  it("her ön ayarın çizimi (motif) var: kataloğa anahtar eklenip çizim unutulamaz", () => {
    const art = readFileSync("src/components/ui/avatar-art.tsx", "utf8");
    for (const p of AVATAR_PRESETS) expect(art).toMatch(new RegExp(`\\b${p.key}:\\s*[(<]`));
  });

  it("isAvatarPreset yalnız katalogdaki anahtarı kabul eder", () => {
    expect(isAvatarPreset("ev")).toBe(true);
    expect(isAvatarPreset("EV")).toBe(false);
    expect(isAvatarPreset("../etc")).toBe(false);
    expect(isAvatarPreset(null)).toBe(false);
    expect(isAvatarPreset(5)).toBe(false);
  });
});

describe("avatar öncelik kuralı: fotoğraf > hazır avatar > baş harf", () => {
  it("ikisi doluysa fotoğraf", () => {
    expect(resolveAvatar({ url: "https://x/a.webp", preset: "ev" })).toEqual({ kind: "photo", url: "https://x/a.webp" });
  });
  it("yalnız hazır avatar", () => {
    expect(resolveAvatar({ url: null, preset: "dag" })).toEqual({ kind: "preset", preset: "dag" });
    expect(resolveAvatar({ url: "  ", preset: "dag" })).toEqual({ kind: "preset", preset: "dag" });
  });
  it("hiçbiri veya tanınmayan anahtar baş harfe düşer", () => {
    expect(resolveAvatar({})).toEqual({ kind: "initials" });
    expect(resolveAvatar({ preset: "silinmis-avatar" })).toEqual({ kind: "initials" });
  });
});

describe("migration sözleşmesi (20261008000500)", () => {
  const sql = readFileSync("supabase/migrations/20261008000500_profile_avatar.sql", "utf8");
  it("set_my_avatar kendi satırına yazar: DEFINER + boş search_path + auth.uid + bürünme reddi", () => {
    const fn = sql.slice(sql.indexOf("function public.set_my_avatar"));
    expect(fn).toMatch(/security definer/);
    expect(fn).toMatch(/set search_path = ''/);
    expect(fn).toMatch(/v_uid uuid := auth\.uid\(\)/);
    expect(fn).toMatch(/where id = v_uid/);
    expect(fn).toMatch(/impersonating/);
    expect(fn).toMatch(/revoke all privileges on function public\.set_my_avatar\(text, text\) from public, anon/);
  });
  it("kova yazması yalnız sahibine; kova herkese açık okunur ve 2 MB ile sınırlı", () => {
    expect(sql).toMatch(/'avatars', 'avatars', true, 2097152/);
    expect(sql).toMatch(/avatar_object_allowed\(name\)/);
    expect(sql).toMatch(/auth\.uid\(\)::text/);
  });
});
