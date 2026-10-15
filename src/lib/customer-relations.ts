/**
 * Müşteriler arası ilişki (CRM-G8) — SAF modül (istemci + sunucu).
 * Tek satır iki yönlü okunur: (customer_id = A, related_customer_id = B, relation = k) "B, A'nın k'sidir" demektir;
 * B'nin kartında A ters etiketle görünür (`inverseRelation`). Tablo: `customer_relations` (20261020010001).
 */

export const RELATION_KINDS = [
  "es",
  "aile",
  "ortak",
  "sirket_yetkilisi",
  "sirket",
  "avukat",
  "muvekkil",
  "tavsiye_eden",
  "tavsiye_ettigi",
  "diger",
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** "B, A'nın <etiket>" — kartta ilişkili kişinin yanında yazılır. */
export const RELATION_LABELS: Record<RelationKind, string> = {
  es: "Eşi",
  aile: "Aile üyesi",
  ortak: "İş ortağı",
  sirket_yetkilisi: "Şirket yetkilisi",
  sirket: "Yetkilisi olduğu şirket",
  avukat: "Avukatı",
  muvekkil: "Müvekkili",
  tavsiye_eden: "Tavsiye eden",
  tavsiye_ettigi: "Tavsiye ettiği kişi",
  diger: "Diğer ilişki",
};

const INVERSE: Record<RelationKind, RelationKind> = {
  es: "es",
  aile: "aile",
  ortak: "ortak",
  sirket_yetkilisi: "sirket",
  sirket: "sirket_yetkilisi",
  avukat: "muvekkil",
  muvekkil: "avukat",
  tavsiye_eden: "tavsiye_ettigi",
  tavsiye_ettigi: "tavsiye_eden",
  diger: "diger",
};

/** Formda gösterilen seçenekler (ters yönlü olanlar da seçilebilir: "Bu kişi ... şirketin yetkilisi"). */
export const RELATION_OPTIONS: Array<{ value: RelationKind; label: string }> = RELATION_KINDS.map((k) => ({
  value: k,
  label: RELATION_LABELS[k],
}));

export function isRelationKind(v: unknown): v is RelationKind {
  return typeof v === "string" && (RELATION_KINDS as readonly string[]).includes(v);
}

export function inverseRelation(k: RelationKind): RelationKind {
  return INVERSE[k];
}

export type RelationRow = {
  id: string;
  customer_id: string;
  related_customer_id: string;
  relation: string;
  note: string | null;
  created_at: string;
  customer?: RelatedPerson | RelatedPerson[] | null;
  related?: RelatedPerson | RelatedPerson[] | null;
};
export type RelatedPerson = { id: string; full_name: string | null; phone: string | null; email?: string | null };

export type RelationView = {
  id: string;
  person: RelatedPerson;
  kind: RelationKind;
  label: string;
  note: string | null;
};

const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * `viewerId` müşterisinin kartından bakınca ilişki satırları: karşı taraf + doğru yönlü etiket.
 * Karşı taraf okunamıyorsa (kapsam dışı / silinmiş) satır atlanır.
 */
export function relationViews(rows: readonly RelationRow[], viewerId: string): RelationView[] {
  const out: RelationView[] = [];
  for (const r of rows) {
    if (!isRelationKind(r.relation)) continue;
    const forward = r.customer_id === viewerId;
    if (!forward && r.related_customer_id !== viewerId) continue;
    const person = first(forward ? r.related : r.customer);
    if (!person?.id) continue;
    const kind = forward ? r.relation : inverseRelation(r.relation);
    out.push({ id: r.id, person, kind, label: RELATION_LABELS[kind], note: r.note });
  }
  return out.sort((a, b) => RELATION_KINDS.indexOf(a.kind) - RELATION_KINDS.indexOf(b.kind));
}
