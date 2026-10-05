import type { SupabaseClient } from "@supabase/supabase-js";
import type { NoteRow, NoteTag } from "./notes";
import { getDistrictsByIds, getNeighborhoodsByIds } from "@/lib/geo/reader";

/**
 * Mahalle notu okuyucuları — oturumlu istemci (RLS: yalnız kendi kiracısı). Tablo yoksa `enabled: false`
 * döner ("etkin değil"); uydurma veri üretilmez. Public yüzeyde KULLANILMAZ.
 */

export type NoteWithAuthor = NoteRow & { authorName: string | null };
export type NotesLoad = { enabled: false } | { enabled: true; notes: NoteWithAuthor[] };

const COLS = "id, neighborhood_id, tags, body, created_by, created_at";

async function withAuthors(supabase: SupabaseClient, rows: NoteRow[]): Promise<NoteWithAuthor[]> {
  const ids = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => Boolean(v)))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name) names.set(p.id, p.full_name);
    }
  }
  return rows.map((r) => ({ ...r, authorName: r.created_by ? (names.get(r.created_by) ?? null) : null }));
}

export async function listNeighborhoodNotes(
  supabase: SupabaseClient,
  opts: { neighborhoodId?: string; tag?: NoteTag | null; limit?: number } = {},
): Promise<NotesLoad> {
  let query = supabase
    .from("neighborhood_notes")
    .select(COLS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.neighborhoodId) query = query.eq("neighborhood_id", opts.neighborhoodId);
  if (opts.tag) query = query.contains("tags", [opts.tag]);
  const { data, error } = await query;
  // Tablo yok (migration uygulanmadı) ya da okunamadı → "etkin değil"; uydurma veri yok.
  if (error) return { enabled: false };
  return { enabled: true, notes: await withAuthors(supabase, (data ?? []) as NoteRow[]) };
}

/** Mahalle kimliği → "Mahalle (İlçe)" etiketi. geo_* herkese açık okunur. */
export async function neighborhoodLabels(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const rows = (await getNeighborhoodsByIds(unique)).map((h) => ({ id: h.id, name: h.name, district_id: h.districtId as string | null }));
  const districtIds = [...new Set(rows.map((h) => h.district_id).filter((v): v is string => Boolean(v)))];
  const districts = new Map<string, string>();
  if (districtIds.length > 0) {
    for (const d of await getDistrictsByIds(districtIds)) districts.set(d.id, d.name);
  }
  for (const h of rows) {
    const d = h.district_id ? districts.get(h.district_id) : null;
    out.set(h.id, d ? `${h.name} (${d})` : h.name);
  }
  return out;
}
