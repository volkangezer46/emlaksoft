import { z } from "zod";
import { parseSettingBool } from "@/lib/platform-setting-keys";
import type { AnySettingDef, SettingCodec, SettingDef } from "../types";

/** Ortak varsayilanlar: yalniz verilmeyen alanlar doldurulur. */
type Common = Omit<
  SettingDef<never>,
  "schema" | "default" | "codec" | "type" | "scope" | "storage" | "workflow" | "risk" | "sensitivity" | "editMode" | "permission"
> &
  Partial<Pick<AnySettingDef, "scope" | "storage" | "workflow" | "risk" | "sensitivity" | "editMode" | "permission">>;

const BASE = {
  scope: "platform",
  storage: "platform_settings",
  workflow: "direct",
  risk: "low",
  sensitivity: "internal",
  editMode: "center",
  permission: { platformModule: "sistem", superAdminOnly: true },
} as const;

function fill<T>(c: Common, rest: Pick<SettingDef<T>, "type" | "schema" | "default" | "codec">): SettingDef<T> {
  return { ...BASE, ...c, ...rest } as unknown as SettingDef<T>;
}

/** Acik/kapali: depo bicimi "on"/"off" (mevcut platform_settings ile ayni). */
export function defineBool(c: Common & { default: boolean; truthy?: "on-off" | "true-false" }): SettingDef<boolean> {
  const { default: def, truthy = "on-off", ...common } = c;
  const codec: SettingCodec<boolean> =
    truthy === "true-false"
      ? {
          // billing.auto_renew_enabled: yalniz "true" acik (parseAutoRenewFlag ile ayni).
          parse: (raw) => (raw == null ? def : String(raw).trim().toLowerCase() === "true"),
          format: (v) => (v ? "true" : "false"),
        }
      : { parse: (raw) => parseSettingBool(raw, def), format: (v) => (v ? "on" : "off") };
  return fill<boolean>(common, { type: "bool", schema: z.boolean(), default: def, codec });
}

/** Tam sayi: aralik disi/bozuk = varsayilan (mevcut parseTrialDays kurali). */
export function defineInt(c: Common & { default: number; min: number; max: number }): SettingDef<number> {
  const { default: def, min, max, ...common } = c;
  const codec: SettingCodec<number> = {
    parse: (raw) => {
      const v = (raw ?? "").trim();
      if (!/^[0-9]{1,6}$/.test(v)) return def;
      const n = Number(v);
      return n >= min && n <= max ? n : def;
    },
    format: (v) => String(v),
  };
  return fill<number>({ ...common, min, max }, { type: "int", schema: z.number().int().min(min).max(max), default: def, codec });
}

/** Ondalik sayi; `parse` mevcut ayristiriciyi (ornek parseMaxShare) tasir. */
export function defineNumber(
  c: Common & { default: number; min: number; max: number; parse: (raw: string | null | undefined) => number },
): SettingDef<number> {
  const { default: def, min, max, parse, ...common } = c;
  return fill<number>(
    { ...common, min, max },
    { type: "number", schema: z.number().min(min).max(max), default: def, codec: { parse, format: (v) => String(v) } },
  );
}

/** Serbest metin (ham deger oldugu gibi; bos = varsayilan degil, bos metin). */
export function defineString(c: Common & { default: string; maxLength: number; minLength?: number }): SettingDef<string> {
  const { default: def, maxLength, minLength = 0, ...common } = c;
  return fill<string>(
    { ...common, max: maxLength },
    {
      type: "string",
      schema: z.string().trim().min(minLength).max(maxLength),
      default: def,
      codec: { parse: (raw) => (raw == null ? def : raw), format: (v) => v },
    },
  );
}

/** Secenekli metin. */
export function defineEnum(
  c: Common & { default: string; options: readonly { value: string; label: string }[] },
): SettingDef<string> {
  const { default: def, options, ...common } = c;
  const values = options.map((o) => o.value);
  return fill<string>(
    { ...common, options },
    {
      type: "enum",
      schema: z.string().refine((v) => values.includes(v), "Geçersiz seçenek."),
      default: def,
      codec: { parse: (raw) => (raw != null && values.includes(raw.trim()) ? raw.trim() : def), format: (v) => v },
    },
  );
}

/** JSON govdeli ayar (kopru/okuma amacli; ham metin korunur). */
export function defineJson(c: Common & { default: string }): SettingDef<string> {
  const { default: def, ...common } = c;
  return fill<string>(
    { editMode: "bridge", ...common },
    {
      type: "json",
      schema: z.string().max(200_000),
      default: def,
      codec: { parse: (raw) => (raw == null ? def : raw), format: (v) => v },
    },
  );
}

/** Gizli deger: icerik asla okunmaz/gosterilmez; yalniz tanimli mi bilgisi. */
export function defineSecret(c: Common & { maxLength: number; minLength?: number; pattern?: RegExp; patternMessage?: string }): SettingDef<string> {
  const { maxLength, minLength = 1, pattern, patternMessage, ...common } = c;
  let schema = z.string().trim().min(minLength, "Değer boş olamaz.").max(maxLength, `En çok ${maxLength} karakter.`);
  if (pattern) schema = schema.regex(pattern, patternMessage ?? "Geçersiz biçim.");
  return fill<string>(
    { ...common, sensitivity: "secret", risk: "high", max: maxLength },
    { type: "string", schema, default: "", codec: { parse: (raw) => raw ?? "", format: (v) => v } },
  );
}