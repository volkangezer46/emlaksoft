import "server-only";
/**
 * Müşteri 360 CRM derinliği okuyucuları (CRM-G7/G8/G9): ek iletişim bilgileri, ilişkili kişiler, yapılandırılmış notlar,
 * not anma için ekip listesi. Hepsi kullanıcı oturumlu istemciyle (RLS) ve hataya dayanıklıdır: tablo/kolon yoksa
 * (migration bekliyor) `available: false` döner, sayfa düşmez. Sayfa bunları künye turuyla AYNI `Promise.all`'da çağırır.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { contactsFromRows, isMissingRelationError, type CustomerContact } from "@/lib/customer-contacts";
import { relationViews, type RelationRow, type RelationView } from "@/lib/customer-relations";
import { notesFromRows, sortNotes, type CustomerNote, type NoteMember } from "@/lib/customer-notes";

export type Loaded<T> = { available: boolean; data: T };

export async function loadCustomerContacts(supabase: SupabaseClient, customerId: string): Promise<Loaded<CustomerContact[]>> {
  const { data, error } = await supabase
    .from("customer_contacts")
    .select("id, kind, value, label, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    if (!isMissingRelationError(error)) console.error("loadCustomerContacts", { code: error.code });
    return { available: !isMissingRelationError(error), data: [] };
  }
  return { available: true, data: contactsFromRows(data) };
}

const PERSON = "id, full_name, phone, email";

export async function loadCustomerRelations(supabase: SupabaseClient, customerId: string): Promise<Loaded<RelationView[]>> {
  const { data, error } = await supabase
    .from("customer_relations")
    .select(
      `id, customer_id, related_customer_id, relation, note, created_at,
       customer:customers!customer_relations_customer_fkey(${PERSON}),
       related:customers!customer_relations_related_fkey(${PERSON})`,
    )
    .or(`customer_id.eq.${customerId},related_customer_id.eq.${customerId}`)
    .order("created_at", { ascending: true })
    .limit(30);
  if (error) {
    if (!isMissingRelationError(error)) console.error("loadCustomerRelations", { code: error.code });
    return { available: !isMissingRelationError(error), data: [] };
  }
  return { available: true, data: relationViews((data ?? []) as unknown as RelationRow[], customerId) };
}

const NOTE_COLS = "id, body, subject, created_at, author:profiles!communications_created_by_fkey(id, full_name)";

/**
 * Notlar: kanal "not" ya da yön "iç not". Sabitleme/anma kolonları yoksa (20261020010002 bekliyor) aynı liste bu
 * kolonlar olmadan okunur ve `available: false` döner (sabitleme düğmeleri gizlenir; not yazımı çalışır).
 */
export async function loadCustomerNotes(supabase: SupabaseClient, customerId: string): Promise<Loaded<CustomerNote[]>> {
  const query = (cols: string) =>
    supabase
      .from("communications")
      .select(cols)
      .eq("customer_id", customerId)
      .or("channel.eq.note,direction.eq.internal")
      .order("created_at", { ascending: false })
      .limit(100);
  const full = await query(`${NOTE_COLS}, pinned_at, mentioned_user_ids, origin`);
  if (!full.error) return { available: true, data: sortNotes(notesFromRows(full.data)) };
  if (!isMissingRelationError(full.error)) {
    console.error("loadCustomerNotes", { code: full.error.code });
    return { available: false, data: [] };
  }
  const legacy = await query(NOTE_COLS);
  return { available: false, data: legacy.error ? [] : sortNotes(notesFromRows(legacy.data)) };
}

/** @anma seçicisi: ofisin aktif kullanıcıları (ad sıralı). */
export async function loadNoteMembers(supabase: SupabaseClient, tenantId: string | null | undefined): Promise<NoteMember[]> {
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("full_name")
    .limit(200);
  if (error) return [];
  return ((data ?? []) as { id: string; full_name: string | null }[])
    .filter((p) => (p.full_name ?? "").trim())
    .map((p) => ({ id: p.id, name: (p.full_name ?? "").trim() }));
}
