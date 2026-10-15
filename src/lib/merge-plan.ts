/**
 * Birleştirme sihirbazı "Alan seçimi" adımının SAF mantığı (müşteri + portföy; istemci + sunucu ortak, testli).
 * DB tarafı: merge_customers / merge_properties `p_overrides` (alan -> kaynak kayıt id). Ana kaydın değeri seçiliyse
 * alan gönderilmez; yalnız kopyadan alınacak alanlar gider.
 */

export type MergeFieldOption = { sourceId: string; value: string; display: string };
export type MergeFieldChoice = { field: string; label: string; options: MergeFieldOption[]; defaultSourceId: string };
export type MergeFieldSpec = { field: string; label: string };

/** Alan değerleri: `values[field]` ham değer (eşitlik için), `display[field]` gösterim (ör. danışman adı). */
export type MergeParty = {
  id: string;
  values: Record<string, string | null>;
  display?: Record<string, string | null>;
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLocaleLowerCase("tr");

/**
 * Kayıtlar arasında FARKLI (en az iki ayrı boş olmayan değer) olan alanlar için seçenekler. Aynı değer bir kez
 * listelenir (ilk kaynak: ana kayıt önce). Varsayılan: ana kaydın değeri, ana boşsa ilk dolu değer.
 */
export function buildFieldChoices(primaryId: string, parties: MergeParty[], specs: readonly MergeFieldSpec[]): MergeFieldChoice[] {
  const ordered = [...parties].sort((a, b) => (a.id === primaryId ? -1 : b.id === primaryId ? 1 : 0));
  const out: MergeFieldChoice[] = [];
  for (const { field, label } of specs) {
    const seen = new Set<string>();
    const options: MergeFieldOption[] = [];
    for (const p of ordered) {
      const raw = p.values[field];
      const key = norm(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      options.push({ sourceId: p.id, value: String(raw).trim(), display: (p.display?.[field] ?? String(raw)).trim() || String(raw) });
    }
    if (options.length < 2) continue;
    out.push({ field, label, options, defaultSourceId: options[0]!.sourceId });
  }
  return out;
}

export type OverridesResult = { ok: true; overrides: Record<string, string> } | { ok: false; error: string };

/**
 * İstemciden gelen seçimi doğrular: yalnız izinli alanlar, kaynak yalnız birleştirilen kopyalardan biri.
 * Ana kaydı gösteren seçim düşürülür (gereksiz). Bilinmeyen alan ya da yabancı kimlik = hata.
 */
export function sanitizeOverrides(
  input: unknown,
  allowed: readonly string[],
  primaryId: string,
  duplicateIds: readonly string[],
): OverridesResult {
  if (input == null) return { ok: true, overrides: {} };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Geçersiz alan seçimi." };
  const overrides: Record<string, string> = {};
  for (const [field, source] of Object.entries(input as Record<string, unknown>)) {
    if (!allowed.includes(field)) return { ok: false, error: "Bu alan seçilemez." };
    if (typeof source !== "string" || !source) return { ok: false, error: "Geçersiz alan seçimi." };
    if (source === primaryId) continue;
    if (!duplicateIds.includes(source)) return { ok: false, error: "Alan seçimi yalnız birleştirilen kayıtlardan yapılabilir." };
    overrides[field] = source;
  }
  return { ok: true, overrides };
}

/** Seçimden (alan -> kaynak) yalnız ana kayıttan farklı olanları içeren override nesnesi. */
export function overridesFromSelection(primaryId: string, selection: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, source] of Object.entries(selection)) if (source && source !== primaryId) out[field] = source;
  return out;
}

/**
 * Müşteri birleştirmesinde ana kaydın notuna eklenecek satırlar (SQL ile aynı kural): son telefon/e-postadan farklı
 * olan tüm telefonlar ve e-postalar (ana kaydın eski değeri dahil) + kopyaların notları (ana notta zaten yoksa).
 */
export function customerNoteLines(input: {
  primary: { phone: string | null; email: string | null; notes: string | null };
  dups: Array<{ full_name: string | null; phone: string | null; email: string | null; notes: string | null }>;
  finalPhone: string | null;
  finalEmail: string | null;
  stamp: string;
}): string[] {
  const lines: string[] = [];
  const finalPhone = (input.finalPhone ?? "").trim();
  const phones = new Set<string>();
  for (const v of [input.primary.phone, ...input.dups.map((d) => d.phone)]) {
    const t = (v ?? "").trim();
    if (t && t !== finalPhone) phones.add(t);
  }
  for (const p of [...phones].sort()) lines.push(`[birleştirme] ek telefon: ${p}`);
  const finalEmail = (input.finalEmail ?? "").trim().toLowerCase();
  const emails = new Set<string>();
  for (const v of [input.primary.email, ...input.dups.map((d) => d.email)]) {
    const t = (v ?? "").trim().toLowerCase();
    if (t && t !== finalEmail) emails.add(t);
  }
  for (const e of [...emails].sort()) lines.push(`[birleştirme] ek e-posta: ${e}`);
  const primaryNotes = input.primary.notes ?? "";
  for (const d of input.dups) {
    const n = (d.notes ?? "").trim();
    if (!n || primaryNotes.includes(n)) continue;
    lines.push(`[birleştirme ${input.stamp} — ${(d.full_name ?? "").trim() || "kopya kayıt"}] ${n}`);
  }
  return lines;
}
