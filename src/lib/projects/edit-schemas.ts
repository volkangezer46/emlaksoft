/**
 * Proje ve daire düzenleme doğrulaması (SAF; server action'lar ve testler ortak kullanır).
 * DB kolonlarıyla birebir: projects (name, developer_name, location, delivery_date, description, status),
 * project_units (block, floor, unit_no, rooms, gross_m2 numeric(8,1), list_price numeric(14,2), notes).
 * Daire DURUMU burada düzenlenmez: rezerve/kapora/satış/serbest bırakma kendi denetimli akışındadır
 * (satış atomik RPC + DB tetikleyicisi).
 */
import { z } from "zod";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `En fazla ${max} karakter olabilir.`)
    .transform((v) => (v === "" ? null : v));

/** Boş -> null; "95.5" ya da "95,5" -> sayı; geçersiz -> NaN (alanlar type=number, binlik ayırıcı gelmez). */
function parseLooseNumber(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
}

const optNumber = (label: string, opts: { min: number; max: number }) =>
  z
    .string()
    .transform((v) => parseLooseNumber(v))
    .refine((n) => n === null || !Number.isNaN(n), `${label} geçerli bir sayı olmalı.`)
    .refine((n) => n === null || (n >= opts.min && n <= opts.max), `${label} ${opts.min}–${opts.max} aralığında olmalı.`);

export const PROJECT_STATUSES = ["planning", "selling", "delivered"] as const;

export const projectEditSchema = z.object({
  id: z.string().uuid("Proje bulunamadı."),
  name: z.string().trim().min(1, "Proje adı zorunludur.").max(160, "Proje adı en fazla 160 karakter olabilir."),
  developer_name: optText(160),
  location: optText(240),
  delivery_date: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Geçerli bir teslim tarihi seçin.")
    .transform((v) => (v === "" ? null : v)),
  description: optText(2000),
  status: z.enum(PROJECT_STATUSES, { message: "Geçerli bir proje durumu seçin." }),
});

export type ProjectEditInput = z.infer<typeof projectEditSchema>;

export const unitEditSchema = z.object({
  id: z.string().uuid("Daire bulunamadı."),
  block: optText(40),
  floor: z
    .string()
    .trim()
    .refine((v) => v === "" || /^-?\d{1,3}$/.test(v), "Geçerli bir kat girin.")
    .transform((v) => (v === "" ? null : Number.parseInt(v, 10))),
  unit_no: z.string().trim().min(1, "Daire no zorunludur.").max(20, "Daire no en fazla 20 karakter olabilir."),
  rooms: optText(20),
  gross_m2: optNumber("Brüt m²", { min: 1, max: 9_999_999 }),
  list_price: optNumber("Liste fiyatı", { min: 0, max: 999_999_999_999 }),
  notes: optText(1000),
});

export type UnitEditInput = z.infer<typeof unitEditSchema>;

/** FormData -> düz nesne (yalnız istenen alanlar, eksik alan boş string). */
export function formFields<K extends string>(fd: FormData, keys: readonly K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of keys) out[k] = String(fd.get(k) ?? "");
  return out;
}

export const PROJECT_EDIT_FIELDS = ["id", "name", "developer_name", "location", "delivery_date", "description", "status"] as const;
export const UNIT_EDIT_FIELDS = ["id", "block", "floor", "unit_no", "rooms", "gross_m2", "list_price", "notes"] as const;

/** İlk Zod hata mesajı (kullanıcıya tek, anlaşılır cümle). */
export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Girilen bilgiler geçersiz.";
}

/** Eski ve yeni değerden yalnız değişen alanlar (denetim kaydı için). */
export function changedFields<T extends Record<string, unknown>>(before: Partial<T>, after: T): Partial<T> {
  const diff: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    const a = before[k] ?? null;
    const b = after[k] ?? null;
    // numeric kolonlar PostgREST'ten sayı ya da metin gelebilir: sayısal karşılaştır.
    const same = typeof b === "number" && a !== null ? Number(a) === b : a === b;
    if (!same) diff[k] = after[k];
  }
  return diff;
}
