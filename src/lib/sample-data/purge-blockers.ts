/**
 * "Gerçek kullanıma geç" ENGELLERİ (saf, istemci güvenli): purge v3 (20261027010200) örnek müşteri/portföye ON DELETE
 * CASCADE ile bağlı GERÇEK kayıt bulursa `ES409` ile durur; ayrıntı (`detail` JSON: `{ total, tables, rows }`) ve ön kontrol
 * `purge_sample_real_children` aynı yükü döner. Bu modül yükü kullanıcı listesine ve tek cümleye çevirir.
 */
/** Örnek ebeveyne kaskatla bağlı gerçek kayıt (purge v3 ES409 ayrıntısı / `purge_sample_real_children`). */
export type PurgeBlocker = {
  table: string;
  label: string;
  count: number;
  parent: "customers" | "properties";
  /** Bağlı olduğu örnek kayıtların adları (en çok 3). */
  examples: string[];
  /** İlk örnek ebeveynin kimliği: kayda giden bağlantı (sıfır çıkmaz metrik). */
  firstParentId: string | null;
};

export const PURGE_REAL_CHILDREN_CODE = "ES409";

/** Tablo adı → kullanıcının tanıdığı kayıt adı (bilinmeyen tablo adıyla gösterilir; sessizce düşmez). */
const CHILD_LABELS: Record<string, string> = {
  offers: "Teklif",
  customer_demands: "Talep",
  communications: "Mesaj",
  customer_files: "Müşteri dosyası",
  iys_consents: "İYS onayı",
  open_houses: "Açık ev",
  property_media: "Yüklenen fotoğraf/belge",
  property_keys: "Anahtar kaydı",
  property_owner_info: "İlan sahibi bilgisi",
  portal_listings: "Portal ilanı",
  referral_links: "Tavsiye bağlantısı",
  rentals: "Kira kaydı",
  rental_applications: "Kiracı başvurusu",
  rental_application_links: "Başvuru bağlantısı",
  customer_contacts: "İlgili kişi",
  customer_relations: "Müşteri ilişkisi",
  direct_file_uploads: "Yüklenen dosya",
  surveys: "Anket",
  kvkk_subject_exports: "KVKK dışa aktarımı",
  network_listings: "Ağ ilanı",
  property_price_proposals: "Fiyat önerisi",
  rent_payment_notices: "Kira ödeme bildirimi",
  portal_customer_requests: "Portal talebi",
  portal_demand_updates: "Portal talep güncellemesi",
};

/** ES409 ayrıntısı (`{ total, tables, rows }`) → engel listesi. Bozuk/eksik yük boş liste verir. */
export function blockersFromDetail(detail: unknown): PurgeBlocker[] {
  let parsed: unknown = detail;
  if (typeof detail === "string") {
    try {
      parsed = JSON.parse(detail);
    } catch {
      return [];
    }
  }
  const d = parsed as { tables?: unknown; rows?: unknown } | null;
  const tables = Array.isArray(d?.tables) ? (d!.tables as Record<string, unknown>[]) : [];
  const rows = Array.isArray(d?.rows) ? (d!.rows as Record<string, unknown>[]) : [];
  const out: PurgeBlocker[] = [];
  for (const t of tables) {
    const table = typeof t.table === "string" ? t.table : "";
    const parent = t.parent === "customers" || t.parent === "properties" ? t.parent : null;
    const count = Number(t.count);
    if (!table || !parent || !Number.isFinite(count) || count <= 0) continue;
    const examples = [
      ...new Set(
        rows
          .filter((r) => r.table === table && typeof r.parent_label === "string" && r.parent_label)
          .map((r) => String(r.parent_label).slice(0, 80)),
      ),
    ].slice(0, 3);
    const first = rows.find((r) => r.table === table && typeof r.parent_id === "string" && /^[0-9a-f-]{36}$/i.test(r.parent_id));
    const existing = out.find((b) => b.table === table && b.parent === parent);
    if (existing) {
      existing.count += count;
      continue;
    }
    out.push({ table, label: CHILD_LABELS[table] ?? table, count, parent, examples, firstParentId: first ? String(first.parent_id) : null });
  }
  return out;
}

/** Engel satırının gideceği kayıt (örnek müşteri/portföy ayrıntısı); kimlik yoksa liste. */
export function blockerHref(b: Pick<PurgeBlocker, "parent" | "firstParentId">): string {
  const base = b.parent === "customers" ? "/app/musteriler" : "/app/portfoyler";
  return b.firstParentId ? `${base}/${b.firstParentId}` : base;
}

/** Engel listesi → tek cümle ("2 Teklif (Kadıköy 3+1), 1 İYS onayı (Selin Aksoy) örnek kayıtlara bağlı"). */
export function blockersMessage(blockers: readonly PurgeBlocker[]): string {
  const parts = blockers.map((b) => `${b.count} ${b.label}${b.examples.length ? ` (${b.examples.join(", ")})` : ""}`);
  return `Örnek kayıtlara bağlı gerçek kayıtlar var: ${parts.join(", ")}. Örnek veriyle birlikte silinmemeleri için önce bunları gerçek bir müşteri/portföye taşıyın ya da kaldırın; hiçbir şey silinmedi.`;
}

