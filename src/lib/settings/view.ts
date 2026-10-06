import type { ZodType } from "zod";
import { getSettingDef } from "./registry";
import type { AnySettingDef, SettingView } from "./types";

/**
 * SAF (istemci güvenli) yardımcılar: form metni -> tipli değer, görünüm, ayar arama.
 */

/** Form/ham girdiyi tipli değere çevirir. Hata: Türkçe mesaj. */
export function coerceInput(def: AnySettingDef, input: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  let v: unknown = input;
  if (typeof v === "string") {
    const t = v.trim();
    if (def.type === "bool") {
      const l = t.toLowerCase();
      if (["on", "true", "1", "evet"].includes(l)) v = true;
      else if (["off", "false", "0", "hayir", "hayır"].includes(l)) v = false;
      else return { ok: false, error: `${def.label}: açık ya da kapalı olmalıdır.` };
    } else if (def.type === "int") {
      if (!/^-?[0-9]{1,9}$/.test(t)) return { ok: false, error: `${def.label}: tam sayı olmalıdır.` };
      v = Number(t);
    } else if (def.type === "number") {
      const n = Number(t.replace(",", "."));
      if (!Number.isFinite(n)) return { ok: false, error: `${def.label}: sayı olmalıdır.` };
      v = n;
    } else {
      v = t;
    }
  }
  const parsed = (def.schema as ZodType).safeParse(v);
  if (!parsed.success) {
    const range =
      def.min != null && def.max != null && (def.type === "int" || def.type === "number")
        ? ` ${def.min} ile ${def.max}${def.unit ? ` ${def.unit}` : ""} arasında olmalıdır.`
        : "";
    const msg = range || parsed.error.issues[0]?.message || "Geçersiz değer.";
    return { ok: false, error: `${def.label}: ${msg.trim()}` };
  }
  const cross = def.crossRule?.(parsed.data);
  if (cross) return { ok: false, error: cross };
  return { ok: true, value: parsed.data };
}

export function displayValue(def: AnySettingDef, value: unknown): string {
  if (def.sensitivity === "secret") return "••••••••";
  if (def.type === "bool") return value ? "Açık" : "Kapalı";
  if (def.type === "enum") return def.options?.find((o) => o.value === value)?.label ?? String(value ?? "");
  if (value === "" || value == null) return "—";
  const s = String(value);
  return def.unit ? `${s} ${def.unit}` : s;
}

/** Ham depo metninden görünüm üretir (gizlide değer ASLA yok). */
export function buildView(
  def: AnySettingDef,
  raw: string | null,
  extra?: { configured?: boolean; plaintext?: boolean },
): SettingView {
  const secret = def.sensitivity === "secret";
  const value = secret ? def.default : def.codec.parse(raw);
  const isDefault = secret ? !extra?.configured : raw == null || def.codec.format(value) === def.codec.format(def.default);
  return {
    key: def.key,
    label: def.label,
    description: def.description,
    impact: def.impact,
    category: def.category,
    group: def.group,
    type: def.type,
    sensitivity: def.sensitivity,
    risk: def.risk,
    editMode: def.editMode,
    editHref: def.editHref,
    lockedReason: def.lockedReason,
    unit: def.unit,
    min: def.min,
    max: def.max,
    options: def.options,
    multiline: def.multiline,
    display: secret ? (extra?.configured ? "Tanımlı (maskeli)" : "Tanımlı değil") : def.type === "json" ? (raw ? "Özel değer tanımlı" : "Kod varsayılanı") : displayValue(def, value),
    formValue: secret || def.type === "json" ? "" : def.codec.format(value),
    defaultDisplay: secret ? "Tanımlı değil" : def.type === "json" ? "Kod varsayılanı" : displayValue(def, def.default),
    isDefault,
    configured: secret ? Boolean(extra?.configured) : undefined,
    plaintext: secret ? Boolean(extra?.plaintext) : undefined,
    envFallback: def.envFallback,
  };
}

function norm(s: string): string {
  return s.toLocaleLowerCase("tr-TR");
}

export type SettingSearchHit = { key: string; label: string; category: AnySettingDef["category"]; href: string };

/** Ayar arama (registry'den indeks): etiket, açıklama, anahtar ve eski anahtarlarda arar. Gizli ayarlar da bulunur (değer yok). */
export function searchSettings(defs: readonly AnySettingDef[], q: string, limit = 12): SettingSearchHit[] {
  const needle = norm(q.trim());
  if (!needle) return [];
  const scored: { d: AnySettingDef; s: number }[] = [];
  for (const d of defs) {
    const label = norm(d.label);
    let s = 0;
    if (label.includes(needle)) s += 10;
    if (norm(d.key).includes(needle)) s += 6;
    if ((d.legacyKeys ?? []).some((k) => norm(k).includes(needle))) s += 4;
    if (norm(d.description).includes(needle)) s += 2;
    if (s > 0) scored.push({ d, s });
  }
  scored.sort((a, b) => b.s - a.s || a.d.label.localeCompare(b.d.label, "tr"));
  return scored.slice(0, limit).map(({ d }) => ({
    key: d.key,
    label: d.label,
    category: d.category,
    href: `/admin/ayarlar/merkez?ara=${encodeURIComponent(d.label)}#${encodeURIComponent(d.key)}`,
  }));
}

export function viewKeyKnown(key: string): boolean {
  return getSettingDef(key) !== undefined;
}