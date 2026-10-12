import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Otomasyon motorunun Sahibinden ilanlar (FSBO) yardımcıları. Motor dosyası FSBO tablolarına doğrudan dokunmaz
 * (sözleşme: kampanya/otomasyon dosyaları fsbo tablolarını hedef kitle olarak görmez); bu dosya yalnız GÖREV / ATAMA /
 * BİLDİRİM için aday okur ve atar. Mesaj, kampanya ve müşteri etiketi yolu YOKTUR.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export type FsboAutomationCandidate = {
  id: string;
  title: string | null;
  status: string;
  assignedTo: string | null;
  price: number | null;
  contactAttempts: number;
};

/** Motorun FSBO kayıtlarında çalıştırabildiği eylemler (SMS/WhatsApp/etiket/durum KAPALI). */
export const FSBO_ALLOWED_ACTIONS: ReadonlySet<string> = new Set(["create_task", "assign_to_staff", "notify_manager", "send_notification"]);

/** `fsbo_do_not_call` (ofis geneli aranmasın özetleri) ile kesişen özetler; tablo yoksa boş küme. */
export async function fsboDoNotCallHashes(db: Db, tenantId: string, hashes: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < hashes.length; i += 200) {
    const { data, error } = await db.from("fsbo_do_not_call").select("phone_hash").eq("tenant_id", tenantId).in("phone_hash", hashes.slice(i, i + 200));
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "42P01" || code === "PGRST205") return out;
      throw new Error(`fsbo_do_not_call: ${error.message}`);
    }
    for (const r of (data ?? []) as { phone_hash: string }[]) out.add(r.phone_hash);
  }
  return out;
}

/** Aday aranmasın listesinde mi (telefon özeti eşleşmesi)? Okuma hatasında ya da tablo yokken false (görev akışı bozulmaz). */
export async function isFsboLeadDoNotCall(db: Db, tenantId: string, leadId: string): Promise<boolean> {
  const { data } = await db.from("fsbo_leads").select("phone_hash").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle();
  const hash = (data as { phone_hash: string | null } | null)?.phone_hash;
  if (!hash) return false;
  try {
    return (await fsboDoNotCallHashes(db, tenantId, [hash])).has(hash);
  } catch {
    return false;
  }
}

/** Açık (yeni/arandı/randevu) ilanlardan `cutoffIso`'dan beri aranmayanların BİR SAYFASI (id imleci). */
export async function collectFsboNoContactPage(
  db: Db,
  input: { tenantId: string; cutoffIso: string; afterId: string | null; pageSize: number },
): Promise<{ rows: FsboAutomationCandidate[]; rawCount: number; lastId: string | null }> {
  let q = db
    .from("fsbo_leads")
    .select("id, title, status, assigned_to, price, contact_attempts, phone_hash")
    .eq("tenant_id", input.tenantId)
    .eq("is_sample", false)
    .is("deleted_at", null)
    .in("status", ["yeni", "arandi", "randevu"])
    .lt("first_seen_at", input.cutoffIso)
    .or(`last_contact_at.is.null,last_contact_at.lt.${input.cutoffIso}`);
  if (input.afterId) q = q.gt("id", input.afterId);
  const { data, error } = await q.order("id", { ascending: true }).limit(input.pageSize);
  if (error) throw new Error(`fsbo_no_contact_days: ${error.message}`);
  const raw = (data ?? []) as {
    id: string;
    title: string | null;
    status: string;
    assigned_to: string | null;
    price: number | string | null;
    contact_attempts: number | null;
    phone_hash: string | null;
  }[];
  // Aranmasın listesindeki ilan sahibine görev açılmaz. rawCount/lastId HAM satırlardan (sayfalama bozulmasın).
  const hashes = [...new Set(raw.map((l) => l.phone_hash).filter((h): h is string => !!h))];
  const dnc = await fsboDoNotCallHashes(db, input.tenantId, hashes);
  return {
    rawCount: raw.length,
    lastId: raw.length > 0 ? String(raw[raw.length - 1].id) : null,
    rows: raw.filter((l) => !l.phone_hash || !dnc.has(l.phone_hash)).map((l) => ({
      id: String(l.id),
      title: l.title,
      status: l.status,
      assignedTo: l.assigned_to,
      price: l.price == null ? null : Number(l.price),
      contactAttempts: Number(l.contact_attempts ?? 0),
    })),
  };
}

/** Danışman atama (kiracı süzgeçli, silinmemiş kayıt). */
export async function assignFsboByAutomation(db: Db, input: { tenantId: string; leadId: string; assigneeId: string; nowIso: string }): Promise<string | null> {
  const { error } = await db
    .from("fsbo_leads")
    .update({ assigned_to: input.assigneeId, updated_at: input.nowIso })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.leadId)
    .is("deleted_at", null);
  return error ? error.message : null;
}

/** Görev satırına FSBO bağı (tasks tablosundaki nullable kolon). */
export function fsboTaskLink(entityType: string, entityId: string): Record<string, string> {
  return entityType === "fsbo_lead" ? { fsbo_lead_id: entityId } : {};
}
