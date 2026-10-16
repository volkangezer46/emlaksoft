/**
 * Yapılandırılmış müşteri notları (CRM-G9) — SAF modül (istemci + sunucu).
 * Not = `communications` satırı (channel 'note' ya da direction 'internal'); sabitleme `pinned_at`, @anma
 * `mentioned_user_ids` (20261020010002). Eski serbest metin `customers.notes` "Genel açıklama" olarak kalır ve bir kez
 * "Önceki notlar" kaydı olarak listeye kopyalanmıştır (`origin = 'customers.notes'`).
 */

export type NoteMember = { id: string; name: string };

export type CustomerNote = {
  id: string;
  body: string;
  subject: string | null;
  created_at: string;
  pinned_at: string | null;
  mentioned_user_ids: string[];
  author_id: string | null;
  author_name: string | null;
  origin: string | null;
};

export const NOTE_FILTERS = [
  { key: "tum", label: "Tümü" },
  { key: "sabit", label: "Sabitlenen" },
  { key: "bana", label: "Benden bahsedenler" },
  { key: "benim", label: "Yazdıklarım" },
] as const;
export type NoteFilter = (typeof NOTE_FILTERS)[number]["key"];

export const MAX_PINNED_NOTES = 3;
export const NOTE_MAX_LENGTH = 4000;
export const MAX_MENTIONS = 10;

export function isNoteFilter(v: unknown): v is NoteFilter {
  return typeof v === "string" && NOTE_FILTERS.some((f) => f.key === v);
}

export function filterNotes(notes: readonly CustomerNote[], filter: NoteFilter, userId: string): CustomerNote[] {
  if (filter === "sabit") return notes.filter((n) => n.pinned_at);
  if (filter === "bana") return notes.filter((n) => n.mentioned_user_ids.includes(userId));
  if (filter === "benim") return notes.filter((n) => n.author_id === userId);
  return [...notes];
}

export function countNotes(notes: readonly CustomerNote[], userId: string): Record<NoteFilter, number> {
  return {
    tum: notes.length,
    sabit: notes.filter((n) => n.pinned_at).length,
    bana: notes.filter((n) => n.mentioned_user_ids.includes(userId)).length,
    benim: notes.filter((n) => n.author_id === userId).length,
  };
}

/** Sabitlenenler önce (en son sabitlenen en üstte), sonra en yeni not. */
export function sortNotes(notes: readonly CustomerNote[]): CustomerNote[] {
  return [...notes].sort((a, b) => {
    if (a.pinned_at && b.pinned_at) return b.pinned_at.localeCompare(a.pinned_at);
    if (a.pinned_at) return -1;
    if (b.pinned_at) return 1;
    return b.created_at.localeCompare(a.created_at);
  });
}

/**
 * Metindeki @anmalar: seçiciden eklenen kimliklerden YALNIZ metinde "@Ad Soyad" olarak hâlâ geçenler (kullanıcı
 * anmayı silerse bildirim gitmez). Ekip üyesi olmayan kimlik atılır.
 */
export function resolveMentions(body: string, pickedIds: readonly string[], members: readonly NoteMember[]): string[] {
  const text = body.toLocaleLowerCase("tr-TR");
  const byId = new Map(members.map((m) => [m.id, m]));
  const out: string[] = [];
  for (const id of pickedIds) {
    const m = byId.get(id);
    if (!m || out.includes(id)) continue;
    if (text.includes(`@${m.name.toLocaleLowerCase("tr-TR")}`)) out.push(id);
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

/** "@" ile başlayan ve imlece kadar süren sorgu (seçici açılır). Yoksa null. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(upto[at - 1]!)) return null;
  const query = upto.slice(at + 1);
  if (query.length > 30 || /[\n@]/.test(query) || /\s{2}/.test(query)) return null;
  return { start: at, query };
}

export function matchMembers(members: readonly NoteMember[], query: string, limit = 6): NoteMember[] {
  const q = query.trim().toLocaleLowerCase("tr-TR");
  const list = q ? members.filter((m) => m.name.toLocaleLowerCase("tr-TR").split(/\s+/).some((p) => p.startsWith(q)) || m.name.toLocaleLowerCase("tr-TR").startsWith(q)) : [...members];
  return list.slice(0, limit);
}

/** Metni düz parça + anma parçalarına böler (gösterimde anma vurgulanır). */
export function splitMentions(body: string, names: readonly string[]): Array<{ text: string; mention: boolean }> {
  const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return [{ text: body, mention: false }];
  const esc = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`@(?:${esc.join("|")})`, "giu");
  const out: Array<{ text: string; mention: boolean }> = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: body.slice(last, i), mention: false });
    out.push({ text: m[0], mention: true });
    last = i + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last), mention: false });
  return out;
}

/** Satırları güvenle türetir (yazar gömmesi `author` dizisi ya da nesnesi olabilir). */
export function notesFromRows(rows: unknown): CustomerNote[] {
  if (!Array.isArray(rows)) return [];
  return (rows as Record<string, unknown>[])
    .filter((r) => r && typeof r.id === "string")
    .map((r) => {
      const a = Array.isArray(r.author) ? r.author[0] : r.author;
      const author = (a ?? null) as { id?: string; full_name?: string | null } | null;
      const body = typeof r.body === "string" && r.body ? r.body : typeof r.subject === "string" ? r.subject : "";
      return {
        id: r.id as string,
        body,
        subject: typeof r.subject === "string" ? r.subject : null,
        created_at: typeof r.created_at === "string" ? r.created_at : "",
        pinned_at: typeof r.pinned_at === "string" ? r.pinned_at : null,
        mentioned_user_ids: Array.isArray(r.mentioned_user_ids) ? (r.mentioned_user_ids as unknown[]).filter((x): x is string => typeof x === "string") : [],
        author_id: author?.id ?? null,
        author_name: author?.full_name ?? null,
        origin: typeof r.origin === "string" ? r.origin : null,
      };
    })
    .filter((n) => n.body.trim().length > 0);
}
