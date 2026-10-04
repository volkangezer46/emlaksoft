/**
 * Mahalle notu (F5) — saf yardımcılar. Ofis içi saha notu: yalnız kendi kiracısı görür, public yüzeye çıkmaz.
 * Etiket seti migration'daki check kısıtıyla aynıdır (20260821000100_neighborhood_notes.sql).
 */

export const NOTE_TAGS = [
  { value: "ulasim", label: "Ulaşım" },
  { value: "okul", label: "Okul" },
  { value: "gurultu", label: "Gürültü" },
  { value: "yatirim", label: "Yatırım potansiyeli" },
  { value: "dikkat", label: "Dikkat edilecekler" },
  { value: "genel", label: "Genel" },
] as const;

export type NoteTag = (typeof NOTE_TAGS)[number]["value"];

const TAG_SET = new Set<string>(NOTE_TAGS.map((t) => t.value));

export const NOTE_BODY_MIN = 3;
export const NOTE_BODY_MAX = 2000;

export function noteTagLabel(tag: string): string {
  return NOTE_TAGS.find((t) => t.value === tag)?.label ?? tag;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export type NoteInput = { neighborhoodId: string; tags: NoteTag[]; body: string };

/** Form verisini doğrular; hata varsa Türkçe mesaj döner. Bilinmeyen etiketler atılır (beyaz liste). */
export function validateNoteInput(raw: {
  neighborhoodId?: unknown;
  tags?: unknown;
  body?: unknown;
}): { ok: true; value: NoteInput } | { ok: false; error: string } {
  if (!isUuid(raw.neighborhoodId)) return { ok: false, error: "Önce bir mahalle seçin." };
  const body = typeof raw.body === "string" ? raw.body.replace(/\r\n/g, "\n").trim() : "";
  if (body.length < NOTE_BODY_MIN) return { ok: false, error: "Not en az 3 karakter olmalı." };
  if (body.length > NOTE_BODY_MAX) return { ok: false, error: `Not en çok ${NOTE_BODY_MAX} karakter olabilir.` };
  const list = Array.isArray(raw.tags) ? raw.tags : [];
  const tags = [...new Set(list.filter((t): t is NoteTag => typeof t === "string" && TAG_SET.has(t)))];
  return { ok: true, value: { neighborhoodId: raw.neighborhoodId, tags, body } };
}

export type NoteRow = {
  id: string;
  neighborhood_id: string;
  tags: string[];
  body: string;
  created_by: string | null;
  created_at: string;
};

/** Etiket filtresi (?etiket=) — bilinmeyen değer yok sayılır. */
export function parseTagFilter(raw: string | undefined): NoteTag | null {
  return raw && TAG_SET.has(raw) ? (raw as NoteTag) : null;
}

/** Etiket başına not sayısı (etiket çipleri sayaçları). Etiketsiz not "genel" sayılmaz, ayrı tutulmaz. */
export function countByTag(notes: Pick<NoteRow, "tags">[]): Record<NoteTag, number> {
  const out = Object.fromEntries(NOTE_TAGS.map((t) => [t.value, 0])) as Record<NoteTag, number>;
  for (const n of notes) {
    for (const t of n.tags) if (TAG_SET.has(t)) out[t as NoteTag] += 1;
  }
  return out;
}

/** "Tabloya/kolona ulaşılamıyor" hatası mı (migration henüz uygulanmamış)? */
export function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703") return true;
  return /neighborhood_notes/.test(error.message ?? "") && /(does not exist|schema cache|not find)/i.test(error.message ?? "");
}
