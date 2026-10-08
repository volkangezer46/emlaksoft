/**
 * Hazır avatar kataloğu ve gösterim önceliği — SAF modül (istemci/sunucu ortak, bağımlılık yok).
 * Çizimler `src/components/ui/avatar-art.tsx`; renk anahtarları tasarım token'larındadır (globals.css).
 *
 * Öncelik kuralı (tek kaynak): fotoğraf > hazır avatar > baş harf. Anahtarı tanınmayan (silinmiş/bozuk)
 * hazır avatar sessizce baş harfe düşer; sayfa asla bozulmaz.
 */

export const AVATAR_PRESETS = [
  { key: "ev", label: "Ev", tone: "brand" },
  { key: "anahtar", label: "Anahtar", tone: "amber" },
  { key: "bina", label: "Bina", tone: "navy" },
  { key: "kapi", label: "Kapı", tone: "mint" },
  { key: "yaprak", label: "Yaprak", tone: "mint" },
  { key: "dag", label: "Dağ", tone: "navy" },
  { key: "dalga", label: "Dalga", tone: "brand" },
  { key: "gunes", label: "Güneş", tone: "amber" },
  { key: "ay", label: "Ay", tone: "navy" },
  { key: "yildiz", label: "Yıldız", tone: "coral" },
  { key: "pusula", label: "Pusula", tone: "brand" },
  { key: "kule", label: "Kule", tone: "coral" },
  { key: "kopru", label: "Köprü", tone: "mint" },
  { key: "elmas", label: "Elmas", tone: "brand" },
  { key: "bulut", label: "Bulut", tone: "navy" },
  { key: "halka", label: "Halka", tone: "amber" },
] as const;

export type AvatarPresetKey = (typeof AVATAR_PRESETS)[number]["key"];
export type AvatarTone = (typeof AVATAR_PRESETS)[number]["tone"];

/** Ton → [zemin başı, zemin sonu] CSS değişkenleri (koyu temada da okunur). */
export const AVATAR_TONE_VARS: Record<AvatarTone, readonly [string, string]> = {
  brand: ["var(--brand-500, #3b6fe0)", "var(--brand-700, #1f3f9e)"],
  mint: ["var(--mint-500, #12b886)", "var(--mint-700, #0b7a58)"],
  amber: ["var(--amber-400, #f5b027)", "var(--amber-700, #b26a00)"],
  navy: ["var(--navy-800, #1b2a4a)", "var(--navy-900, #0f1a33)"],
  coral: ["var(--danger-500, #e5544b)", "var(--danger-700, #a62a24)"],
};

const KEYS: ReadonlySet<string> = new Set(AVATAR_PRESETS.map((p) => p.key));

export function isAvatarPreset(value: unknown): value is AvatarPresetKey {
  return typeof value === "string" && KEYS.has(value);
}

export function presetMeta(key: string) {
  return AVATAR_PRESETS.find((p) => p.key === key) ?? null;
}

export type AvatarSource =
  | { kind: "photo"; url: string }
  | { kind: "preset"; preset: AvatarPresetKey }
  | { kind: "initials" };

/** Fotoğraf varsa o; yoksa geçerli hazır avatar; yoksa baş harf. */
export function resolveAvatar(input: { url?: string | null; preset?: string | null }): AvatarSource {
  const url = (input.url ?? "").trim();
  if (url) return { kind: "photo", url };
  if (isAvatarPreset(input.preset)) return { kind: "preset", preset: input.preset };
  return { kind: "initials" };
}

/** Yüklenen fotoğrafın saklama sınırları (istemci küçültür, sunucu doğrular). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIZE_PX = 512;
