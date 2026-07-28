import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  CalendarPlus,
  FileStack,
  FileWarning,
  FolderSearch,
  HardDrive,
  Search,
  UserX,
  ImageOff,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { inFilter, orIlike, safeLike } from "@/lib/pgrst";
import { now } from "@/lib/clock";
import {
  DOC_KINDS,
  DOC_SOURCES,
  KIND_LABEL,
  SOURCE_GATE,
  SOURCE_LABEL,
  categoryOf,
  formatBytes,
  isDocKind,
  isDocSource,
  kindOf,
  type DocKind,
  type DocSource,
  type DocumentRow,
} from "@/lib/documents";
import { DocumentList } from "./document-list";

/**
 * Belge Merkezi — ofisin dört ayrı yerde duran dosyaları tek listede.
 *
 * BİRLEŞTİRME STRATEJİSİ (uygulama katmanında UNION):
 *  Dört kaynak dört ayrı tabloda ve şemaları örtüşmüyor; PostgREST üzerinden
 *  gerçek bir SQL UNION kurulamıyor. Yapılan: her kaynaktan AYNI filtrelerle
 *  (kaynak/tür/arama/tarih) `offset + PAGE_SIZE` kadar EN YENİ satır çekilir,
 *  bellekte tarihe göre birleştirilip `[offset, offset+PAGE_SIZE)` dilimi
 *  alınır. Bu, birleşik sıralamada MATEMATİKSEL OLARAK DOĞRU sayfalamadır:
 *  global ilk N satırın hepsi, kaynak başına ilk N satırın içindedir.
 *  Sayfa derinliği HARD_CAP ile sınırlı (bkz. aşağıdaki not).
 *
 *  N+1 YOK: ilişkili kayıt adları (müşteri/portföy/anlaşma) PostgREST gömülü
 *  join'leriyle aynı istekte gelir; yükleyen adları tek toplu `profiles`
 *  sorgusuyla çözülür (4 kaynağın tüm id'leri tek `in` listesinde).
 *
 *  Sayaçlar listeden TÜRETİLMEZ: her kaynak için ayrı `count: exact, head`
 *  sorgusu vardır (satır taşımaz). "Bu ay eklenen" ve sağlık sayaçları da
 *  aynı şekilde gerçek sayımdır.
 */

const PAGE_SIZE = 50;

/**
 * Kaynak başına çekilecek azami satır. 2000 = 40. sayfaya kadar birleşik
 * sayfalama tam doğru. Daha derini için kullanıcı filtre daraltmalı; sessizce
 * yanlış sıra göstermektense sınırı UI'da söylüyoruz.
 */
const HARD_CAP = 2000;

/** YYYY-MM-DD ise döndür, değilse boş — bozuk tarih sorguya sızmasın. */
function safeDate(value: string | undefined) {
  const v = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

/** İçinde bulunulan ayın ilk günü (YYYY-MM-01) — `?from=` linki için. */
function monthStart(): string {
  const d = new Date(now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Uzantı grubu filtresinin PostgREST `or()` dizgesi.
 * `*` PostgREST'te `%` yerine geçer ve `or()` gramerini bozmaz.
 * "diger" negatif tanımlıdır: bilinen hiçbir gruba girmeyen + tipi boş olanlar.
 */
function kindClause(kind: DocKind, mimeCol: string, nameCol: string): string {
  switch (kind) {
    case "gorsel":
      return [
        `${mimeCol}.ilike.image/*`,
        `${nameCol}.ilike.*.jpg`,
        `${nameCol}.ilike.*.jpeg`,
        `${nameCol}.ilike.*.png`,
        `${nameCol}.ilike.*.webp`,
        `${nameCol}.ilike.*.gif`,
      ].join(",");
    case "pdf":
      return [`${mimeCol}.ilike.*pdf*`, `${nameCol}.ilike.*.pdf`].join(",");
    case "ofis":
      return [
        `${mimeCol}.ilike.*word*`,
        `${mimeCol}.ilike.*excel*`,
        `${mimeCol}.ilike.*spreadsheet*`,
        `${mimeCol}.ilike.*presentation*`,
        `${nameCol}.ilike.*.doc`,
        `${nameCol}.ilike.*.docx`,
        `${nameCol}.ilike.*.xls`,
        `${nameCol}.ilike.*.xlsx`,
      ].join(",");
    case "diger":
      return [
        `${mimeCol}.is.null`,
        `and(${mimeCol}.not.ilike.image/*,${mimeCol}.not.ilike.*pdf*,${mimeCol}.not.ilike.*word*,` +
          `${mimeCol}.not.ilike.*excel*,${mimeCol}.not.ilike.*spreadsheet*,${mimeCol}.not.ilike.*presentation*,` +
          `${nameCol}.not.ilike.*.pdf,${nameCol}.not.ilike.*.doc,${nameCol}.not.ilike.*.docx,` +
          `${nameCol}.not.ilike.*.xls,${nameCol}.not.ilike.*.xlsx)`,
      ].join(",");
  }
}

/** deal_checklist_items'ta MIME kolonu yok — yalnız `file_url` uzantısına bakılır. */
function urlKindClause(kind: DocKind): string {
  switch (kind) {
    case "gorsel":
      return ["*.jpg", "*.jpeg", "*.png", "*.webp", "*.gif"].map((p) => `file_url.ilike.${p}`).join(",");
    case "pdf":
      return "file_url.ilike.*.pdf";
    case "ofis":
      return ["*.doc", "*.docx", "*.xls", "*.xlsx"].map((p) => `file_url.ilike.${p}`).join(",");
    case "diger":
      return (
        "and(" +
        ["*.jpg", "*.jpeg", "*.png", "*.webp", "*.gif", "*.pdf", "*.doc", "*.docx", "*.xls", "*.xlsx"]
          .map((p) => `file_url.not.ilike.${p}`)
          .join(",") +
        ")"
      );
  }
}

/** supabase-js gömülü ilişkiyi dizi olarak tipleyebiliyor — iki biçimi de karşıla. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

type ProfileRef = { id: string; full_name: string } | { id: string; full_name: string }[] | null;
type CustomerRef = { id: string; full_name: string } | { id: string; full_name: string }[] | null;
type PropertyRef =
  | { id: string; property_code: string; title: string | null }
  | { id: string; property_code: string; title: string | null }[]
  | null;

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    kaynak?: string;
    tur?: string;
    q?: string;
    from?: string;
    to?: string;
    sayfa?: string;
  }>;
}) {
  const { perms } = await requireModulePage("settings");
  const params = (await searchParams) ?? {};

  const kaynakF: DocSource | "" = isDocSource(params.kaynak) ? params.kaynak : "";
  const turF: DocKind | "" = isDocKind(params.tur) ? params.tur : "";
  const q = (params.q ?? "").trim();
  const fromF = safeDate(params.from);
  const toF = safeDate(params.to);
  const pageParam = Math.max(1, Number.parseInt(params.sayfa ?? "1", 10) || 1);
  const offset = (pageParam - 1) * PAGE_SIZE;
  const fetchLimit = Math.min(offset + PAGE_SIZE, HARD_CAP);
  const hasFilter = Boolean(kaynakF || turF || q || fromF || toF);

  // Silme/iptal izinleri — kaynağın KENDİ modülünden okunur (SOURCE_GATE).
  // Yetkisi olmayan kaynakta buton hiç çizilmez; action tarafında da aynı kapı var.
  const canDelete: Record<DocSource, boolean> = {
    musteri: (perms[SOURCE_GATE.musteri.mod] ?? []).includes(SOURCE_GATE.musteri.action),
    portfoy: (perms[SOURCE_GATE.portfoy.mod] ?? []).includes(SOURCE_GATE.portfoy.action),
    sozlesme: (perms[SOURCE_GATE.sozlesme.mod] ?? []).includes(SOURCE_GATE.sozlesme.action),
    evrak: (perms[SOURCE_GATE.evrak.mod] ?? []).includes(SOURCE_GATE.evrak.action),
  };

  const supabase = await createClient();

  // --- Arama: ilişkili kayıt adları önce id'ye çevrilir ---------------------
  // "ilişkili kayıt adıyla ara" bunsuz çalışmaz: gömülü join kolonunda ilike
  // yapılamıyor. İki ucuz ön sorgu (ad kolonlarında indeks var) id listesi verir.
  let customerIds: string[] = [];
  let propertyIds: string[] = [];
  let dealIds: string[] = [];
  if (q) {
    const [{ data: cHits }, { data: pHits }] = await Promise.all([
      supabase.from("customers").select("id").ilike("full_name", safeLike(q)).is("deleted_at", null).limit(50),
      supabase
        .from("properties")
        .select("id")
        .or(orIlike(["property_code", "title"], q))
        .is("deleted_at", null)
        .limit(50),
    ]);
    customerIds = (cHits ?? []).map((r) => r.id as string);
    propertyIds = (pHits ?? []).map((r) => r.id as string);
    if (customerIds.length || propertyIds.length) {
      const clauses = [inFilter("customer_id", customerIds), inFilter("property_id", propertyIds)].filter(
        Boolean,
      ) as string[];
      const { data: dHits } = await supabase.from("deals").select("id").or(clauses.join(",")).limit(100);
      dealIds = (dHits ?? []).map((r) => r.id as string);
    }
  }

  const wantSource = (s: DocSource) => !kaynakF || kaynakF === s;
  // Sözleşmenin ayrı bir dosyası yok (metin DB'de tutuluyor) — uzantı grubu
  // filtrelerinde yalnızca "diğer" seçildiğinde listeye girer.
  const contractsAllowed = wantSource("sozlesme") && (!turF || turF === "diger");

  const dateGte = fromF || null;
  const dateLte = toF ? `${toF}T23:59:59.999` : null;

  // --- Kaynak sorguları -----------------------------------------------------
  // Her kaynak için: (a) sayfa penceresi, (b) head-only exact count.
  const CUSTOMER_COLS =
    "id, file_name, file_size, file_type, label, created_at, customer_id, uploaded_by, customer:customers(id, full_name), uploader:profiles!customer_files_uploaded_by_fkey(id, full_name)";
  const MEDIA_COLS =
    "id, file_name, file_size, file_type, kind, storage_path, external_url, created_at, property_id, uploaded_by, property:properties(id, property_code, title), uploader:profiles!property_media_uploaded_by_fkey(id, full_name)";
  const CONTRACT_COLS =
    "id, title, status, contract_type, created_at, created_by, customer_id, property_id, customer:customers(id, full_name), property:properties(id, property_code, title), creator:profiles!contracts_created_by_fkey(id, full_name)";
  const CHECKLIST_COLS =
    "id, label, file_url, created_at, deal_id, done_by, deal:deals(id, deal_type, stage, customer:customers(id, full_name), property:properties(id, property_code, title)), marker:profiles!deal_checklist_items_done_by_fkey(id, full_name)";

  /**
   * Aynı filtre setinin hem satır hem `count` sorgusuna uygulanabilmesi için
   * gereken en dar arayüz. supabase-js'in jenerik `PostgrestFilterBuilder`
   * tipini taşımak, `select()` şeması sorgudan sorguya değiştiği için burada
   * gereksiz karmaşa üretiyordu; `any` yerine bu daraltılmış sözleşme.
   */
  type FilterChain = {
    gte(column: string, value: string): FilterChain;
    lte(column: string, value: string): FilterChain;
    or(filters: string): FilterChain;
    not(column: string, operator: string, value: null): FilterChain;
  };

  /** Kaynağa göre tarih + tür + arama filtrelerini uygular (satır ve sayım aynı süzgeci görür). */
  function applyFilters<T>(builder: T, source: DocSource): T {
    let qb = builder as unknown as FilterChain;

    // Belge merkezi yalnız DOSYASI OLAN evrak maddelerini listeler; dosyasız
    // zorunlu maddeler aşağıdaki "belge sağlığı" bölümünde eksik olarak çıkar.
    if (source === "evrak") qb = qb.not("file_url", "is", null);

    if (dateGte) qb = qb.gte("created_at", dateGte);
    if (dateLte) qb = qb.lte("created_at", dateLte);

    if (turF) {
      if (source === "musteri" || source === "portfoy") qb = qb.or(kindClause(turF, "file_type", "file_name"));
      else if (source === "evrak") qb = qb.or(urlKindClause(turF));
      // sözleşme: dosyası yok → tür filtresi contractsAllowed ile çözülür.
    }

    if (q) {
      const clauses: string[] = [];
      if (source === "musteri") {
        clauses.push(orIlike(["file_name", "label"], q));
        const c = inFilter("customer_id", customerIds);
        if (c) clauses.push(c);
      } else if (source === "portfoy") {
        clauses.push(orIlike(["file_name"], q));
        const p = inFilter("property_id", propertyIds);
        if (p) clauses.push(p);
      } else if (source === "sozlesme") {
        clauses.push(orIlike(["title"], q));
        const c = inFilter("customer_id", customerIds);
        const p = inFilter("property_id", propertyIds);
        if (c) clauses.push(c);
        if (p) clauses.push(p);
      } else {
        clauses.push(orIlike(["label", "file_url"], q));
        const d = inFilter("deal_id", dealIds);
        if (d) clauses.push(d);
      }
      qb = qb.or(clauses.join(","));
    }

    return qb as unknown as T;
  }

  const TABLE: Record<DocSource, string> = {
    musteri: "customer_files",
    portfoy: "property_media",
    sozlesme: "contracts",
    evrak: "deal_checklist_items",
  };
  const COLS: Record<DocSource, string> = {
    musteri: CUSTOMER_COLS,
    portfoy: MEDIA_COLS,
    sozlesme: CONTRACT_COLS,
    evrak: CHECKLIST_COLS,
  };

  /** Kaynağın sayfa penceresi. Kaynak filtre dışıysa SORGU HİÇ ATILMAZ. */
  async function fetchRows(source: DocSource, enabled: boolean): Promise<Record<string, unknown>[]> {
    if (!enabled) return [];
    const { data, error } = await applyFilters(
      supabase.from(TABLE[source]).select(COLS[source]).order("created_at", { ascending: false }),
      source,
    ).limit(fetchLimit);
    if (error) {
      console.error(`belgeler ${source} rows`, error);
      return [];
    }
    return (data ?? []) as unknown as Record<string, unknown>[];
  }

  /** Gerçek toplam — head:true, satır taşımaz. Sayaçlar listeden türetilmez. */
  async function fetchCount(source: DocSource, enabled: boolean): Promise<number> {
    if (!enabled) return 0;
    const { count, error } = await applyFilters(
      supabase.from(TABLE[source]).select("id", { count: "exact", head: true }),
      source,
    );
    if (error) {
      console.error(`belgeler ${source} count`, error);
      return 0;
    }
    return count ?? 0;
  }

  const [
    custRows,
    mediaRows,
    contractRows,
    checkRows,
    custCount,
    mediaCount,
    contractCount,
    checkCount,
    monthCustRes,
    monthMediaRes,
    monthContractRes,
    monthCheckRes,
    usageRes,
    healthRes,
  ] = await Promise.all([
    fetchRows("musteri", wantSource("musteri")),
    fetchRows("portfoy", wantSource("portfoy")),
    fetchRows("sozlesme", contractsAllowed),
    fetchRows("evrak", wantSource("evrak")),
    fetchCount("musteri", wantSource("musteri")),
    fetchCount("portfoy", wantSource("portfoy")),
    fetchCount("sozlesme", contractsAllowed),
    fetchCount("evrak", wantSource("evrak")),
    // "Bu ay eklenen" — filtreden bağımsız, dört kaynağın gerçek toplamı.
    supabase.from("customer_files").select("id", { count: "exact", head: true }).gte("created_at", monthStart()),
    supabase.from("property_media").select("id", { count: "exact", head: true }).gte("created_at", monthStart()),
    supabase.from("contracts").select("id", { count: "exact", head: true }).gte("created_at", monthStart()),
    supabase
      .from("deal_checklist_items")
      .select("id", { count: "exact", head: true })
      .not("file_url", "is", null)
      .gte("created_at", monthStart()),
    // Depolama: PostgREST'te aggregate kapalı, storage şeması açık değil →
    // migration 122'deki RPC file_size'ları DB içinde toplar (bkz. rapor).
    supabase.rpc("document_storage_usage"),
    supabase.rpc("document_health_counts"),
  ]);

  const sourceCounts: Record<DocSource, number> = {
    musteri: custCount,
    portfoy: mediaCount,
    sozlesme: contractCount,
    evrak: checkCount,
  };
  const total = DOC_SOURCES.reduce((sum, s) => sum + sourceCounts[s], 0);
  const monthCount =
    (monthCustRes.count ?? 0) +
    (monthMediaRes.count ?? 0) +
    (monthContractRes.count ?? 0) +
    (monthCheckRes.count ?? 0);

  const usage = (usageRes.data as
    | { customer_bytes: number; customer_count: number; media_bytes: number; media_count: number }[]
    | null)?.[0] ?? null;
  const usageError = Boolean(usageRes.error);
  const storageBytes = usage ? Number(usage.customer_bytes) + Number(usage.media_bytes) : 0;
  const storedFileCount = usage ? Number(usage.customer_count) + Number(usage.media_count) : 0;

  const health = (healthRes.data as
    | {
        customers_without_files: number;
        live_properties_without_photos: number;
        deals_missing_docs: number;
        missing_required_items: number;
      }[]
    | null)?.[0] ?? null;

  // --- Satırları ortak biçime indirge --------------------------------------
  const rows: DocumentRow[] = [];

  type CustomerFileRow = {
    id: string;
    file_name: string;
    file_size: number | null;
    file_type: string | null;
    label: string | null;
    created_at: string;
    customer_id: string;
    customer: CustomerRef;
    uploader: ProfileRef;
  };
  for (const r of custRows as unknown as CustomerFileRow[]) {
    const kind = kindOf(r.file_type, r.file_name);
    const customer = one(r.customer);
    rows.push({
      key: `musteri:${r.id}`,
      source: "musteri",
      id: r.id,
      name: r.file_name,
      label: r.label,
      size: r.file_size,
      kind,
      category: categoryOf("musteri", r.file_name, r.label, kind),
      createdAt: r.created_at,
      uploaderName: one(r.uploader)?.full_name ?? null,
      relatedLabel: customer?.full_name ?? null,
      relatedHref: r.customer_id ? `/app/musteriler/${r.customer_id}` : null,
      previewUrl: `/api/customer-files/${r.id}/download?onizle=1`,
      downloadUrl: `/api/customer-files/${r.id}/download`,
      canDelete: canDelete.musteri,
    });
  }

  type MediaRow = {
    id: string;
    file_name: string | null;
    file_size: number | null;
    file_type: string | null;
    kind: string;
    storage_path: string | null;
    external_url: string | null;
    created_at: string;
    property_id: string;
    property: PropertyRef;
    uploader: ProfileRef;
  };
  for (const r of mediaRows as unknown as MediaRow[]) {
    const property = one(r.property);
    const displayName =
      r.file_name ?? (r.external_url ? (r.kind === "tour" ? "360° sanal tur bağlantısı" : "Video bağlantısı") : "Adsız medya");
    const kind = r.storage_path ? kindOf(r.file_type, displayName) : "diger";
    rows.push({
      key: `portfoy:${r.id}`,
      source: "portfoy",
      id: r.id,
      name: displayName,
      label: r.kind === "image" ? null : r.kind === "video" ? "Video" : "360° tur",
      size: r.file_size,
      kind,
      category: categoryOf("portfoy", displayName, null, kind),
      createdAt: r.created_at,
      uploaderName: one(r.uploader)?.full_name ?? null,
      relatedLabel: property ? `${property.property_code}${property.title ? ` · ${property.title}` : ""}` : null,
      relatedHref: r.property_id ? `/app/portfoyler/${r.property_id}` : null,
      // Harici URL'li video/turun dosyası bizde değil — bağlantı doğrudan açılır.
      previewUrl: r.storage_path ? `/api/property-media/${r.id}/download` : r.external_url,
      downloadUrl: r.storage_path ? `/api/property-media/${r.id}/download?indir=1` : r.external_url,
      canDelete: canDelete.portfoy,
    });
  }

  type ContractRow = {
    id: string;
    title: string;
    status: string;
    contract_type: string;
    created_at: string;
    customer_id: string | null;
    property_id: string | null;
    customer: CustomerRef;
    property: PropertyRef;
    creator: ProfileRef;
  };
  const CONTRACT_STATUS_TR: Record<string, string> = {
    draft: "Taslak",
    sent: "İmzaya gönderildi",
    signed: "İmzalandı",
    rejected: "Reddedildi",
    cancelled: "İptal",
  };
  for (const r of contractRows as unknown as ContractRow[]) {
    const customer = one(r.customer);
    const property = one(r.property);
    const related = customer?.full_name ?? (property ? `${property.property_code}` : null);
    const relatedHref = customer
      ? `/app/musteriler/${customer.id}`
      : property
        ? `/app/portfoyler/${property.id}`
        : null;
    rows.push({
      key: `sozlesme:${r.id}`,
      source: "sozlesme",
      id: r.id,
      name: r.title,
      label: CONTRACT_STATUS_TR[r.status] ?? r.status,
      // Sözleşme metni DB'de tutulur, ayrı dosya yoktur → boyut uydurulmaz.
      size: null,
      kind: "diger",
      category: "sozlesme",
      createdAt: r.created_at,
      uploaderName: one(r.creator)?.full_name ?? null,
      relatedLabel: related,
      relatedHref,
      previewUrl: `/app/sozlesmeler/${r.id}`,
      downloadUrl: null,
      canDelete: canDelete.sozlesme && r.status !== "signed" && r.status !== "cancelled",
    });
  }

  type ChecklistRow = {
    id: string;
    label: string;
    file_url: string;
    created_at: string;
    deal_id: string;
    deal:
      | { id: string; deal_type: string; stage: string; customer: CustomerRef; property: PropertyRef }
      | { id: string; deal_type: string; stage: string; customer: CustomerRef; property: PropertyRef }[]
      | null;
    marker: ProfileRef;
  };
  for (const r of checkRows as unknown as ChecklistRow[]) {
    const deal = one(r.deal);
    const customer = deal ? one(deal.customer) : null;
    const property = deal ? one(deal.property) : null;
    const kind = kindOf(null, r.file_url);
    const dealLabel = [customer?.full_name, property?.property_code].filter(Boolean).join(" · ");
    rows.push({
      key: `evrak:${r.id}`,
      source: "evrak",
      id: r.id,
      name: r.label,
      label: "Evrak bağlantısı",
      size: null,
      kind,
      category: categoryOf("evrak", r.file_url, r.label, kind),
      createdAt: r.created_at,
      uploaderName: one(r.marker)?.full_name ?? null,
      relatedLabel: dealLabel || "Anlaşma",
      relatedHref: `/app/anlasmalar/${r.deal_id}`,
      previewUrl: r.file_url,
      downloadUrl: r.file_url,
      canDelete: canDelete.evrak,
    });
  }

  // Birleşik sıralama + gerçek sayfa dilimi
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageParam, totalPages);
  const pageRows = rows.slice(offset, offset + PAGE_SIZE);
  const capReached = offset + PAGE_SIZE > HARD_CAP;

  // --- Belge sağlığı: eksik zorunlu evrakı olan açık anlaşmalar -------------
  type MissingRow = {
    deal_id: string;
    label: string;
    deal:
      | { id: string; stage: string; customer: CustomerRef; property: PropertyRef }
      | { id: string; stage: string; customer: CustomerRef; property: PropertyRef }[]
      | null;
  };
  const { data: missingRaw } = await supabase
    .from("deal_checklist_items")
    .select("deal_id, label, deal:deals(id, stage, customer:customers(id, full_name), property:properties(id, property_code, title))")
    .eq("is_required", true)
    .eq("is_done", false)
    .limit(500);

  const missingByDeal = new Map<string, { dealId: string; label: string; count: number; missing: string[] }>();
  for (const r of (missingRaw ?? []) as unknown as MissingRow[]) {
    const deal = one(r.deal);
    if (!deal || deal.stage === "won" || deal.stage === "lost") continue;
    const customer = one(deal.customer);
    const property = one(deal.property);
    const label = [customer?.full_name, property?.property_code].filter(Boolean).join(" · ") || "Anlaşma";
    const existing = missingByDeal.get(r.deal_id);
    if (existing) {
      existing.count += 1;
      if (existing.missing.length < 3) existing.missing.push(r.label);
    } else {
      missingByDeal.set(r.deal_id, { dealId: r.deal_id, label, count: 1, missing: [r.label] });
    }
  }
  const missingDeals = [...missingByDeal.values()].sort((a, b) => b.count - a.count);

  // --- Link üreticileri -----------------------------------------------------
  const buildHref = (patch: Partial<Record<"kaynak" | "tur" | "q" | "from" | "to" | "sayfa", string>>) => {
    const sp = new URLSearchParams();
    const kaynak = patch.kaynak !== undefined ? patch.kaynak : kaynakF;
    const tur = patch.tur !== undefined ? patch.tur : turF;
    const query = patch.q !== undefined ? patch.q : q;
    const from = patch.from !== undefined ? patch.from : fromF;
    const to = patch.to !== undefined ? patch.to : toF;
    const sayfa = patch.sayfa;
    if (kaynak) sp.set("kaynak", kaynak);
    if (tur) sp.set("tur", tur);
    if (query) sp.set("q", query);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (sayfa && sayfa !== "1") sp.set("sayfa", sayfa);
    const qs = sp.toString();
    return qs ? `/app/belgeler?${qs}` : "/app/belgeler";
  };

  const chipBase =
    "focus-ring press rounded-[9px] px-3 py-1.5 text-xs font-semibold transition border";
  const chipOn = "border-transparent bg-ink-950 text-white";
  const chipOff = "border-line text-text-muted hover:border-brand-300 hover:text-brand-600";

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-brand-500/25 blur-[80px]" />
        <div className="relative">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-mint-400">
            <Archive className="h-3.5 w-3.5" /> Belge merkezi
          </p>
          <h1 className="mt-2 font-display text-3xl font-extrabold">Ofisin tüm dosyaları</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Müşteri dosyaları, portföy medyası, sözleşmeler ve anlaşma evrakları tek listede. “Şu müşterinin kimlik
            fotokopisi nerede?” sorusunun tek cevabı burada.
          </p>
        </div>
      </section>

      {/* --- 4 href'li StatCard ------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Toplam belge"
          value={total.toLocaleString("tr-TR")}
          icon={FileStack}
          href="/app/belgeler"
        />
        <StatCard
          label="Bu ay eklenen"
          value={monthCount.toLocaleString("tr-TR")}
          icon={CalendarPlus}
          tone="success"
          href={`/app/belgeler?from=${monthStart()}`}
        />
        <StatCard
          label={usage && !usageError ? "Depolama kullanımı" : "Depolanan dosya"}
          value={usage && !usageError ? formatBytes(storageBytes) : "—"}
          icon={HardDrive}
          tone="neutral"
          href="#depolama"
        />
        <StatCard
          label="Eksik evraklı anlaşma"
          value={(health?.deals_missing_docs ?? missingDeals.length).toLocaleString("tr-TR")}
          icon={FileWarning}
          tone={(health?.deals_missing_docs ?? missingDeals.length) > 0 ? "warning" : "neutral"}
          href="/app/anlasmalar"
        />
      </div>

      {/* --- Depolama dökümü ---------------------------------------------- */}
      <section
        id="depolama"
        className="scroll-mt-24 rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]"
      >
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <HardDrive className="h-4 w-4 text-brand-600" /> Depolama kullanımı
        </h2>
        {usage && !usageError ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Link
                href="/app/belgeler?kaynak=musteri"
                className="focus-ring press lift block rounded-[14px] border border-line bg-canvas p-4 transition hover:border-brand-300"
              >
                <p className="text-xs text-text-muted">Müşteri dosyaları</p>
                <p className="numeric mt-1 font-display text-xl font-extrabold text-ink-950">
                  {formatBytes(Number(usage.customer_bytes))}
                </p>
                <p className="mt-0.5 text-[11px] text-text-faint">{Number(usage.customer_count)} dosya</p>
              </Link>
              <Link
                href="/app/belgeler?kaynak=portfoy"
                className="focus-ring press lift block rounded-[14px] border border-line bg-canvas p-4 transition hover:border-brand-300"
              >
                <p className="text-xs text-text-muted">Portföy medyası</p>
                <p className="numeric mt-1 font-display text-xl font-extrabold text-ink-950">
                  {formatBytes(Number(usage.media_bytes))}
                </p>
                <p className="mt-0.5 text-[11px] text-text-faint">{Number(usage.media_count)} dosya</p>
              </Link>
              <div className="rounded-[14px] border border-dashed border-line-strong bg-canvas p-4">
                <p className="text-xs text-text-muted">Ölçülemeyen</p>
                <p className="mt-1 font-display text-sm font-bold text-ink-950">Sözleşme &amp; evrak bağlantısı</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-faint">
                  Sözleşme metni veritabanında tutulur; anlaşma evrağı harici bağlantıdır. İkisi de bizim
                  depolamamızda dosya olarak durmadığı için boyutları toplama girmez.
                </p>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-text-faint">
              Toplam {storedFileCount.toLocaleString("tr-TR")} dosya · boyutlar yükleme anında kaydedilen
              <code className="mx-1 rounded bg-canvas px-1">file_size</code> alanından toplanır (Supabase
              <code className="mx-1 rounded bg-canvas px-1">storage.objects</code> tablosu PostgREST&apos;e kapalı
              olduğu için depo tarafından okunamıyor).
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-text-muted">
            Depolama boyutu hesaplanamadı. Supabase&apos;te <code className="rounded bg-canvas px-1">storage.objects</code>{" "}
            tablosu PostgREST&apos;e açık değil ve toplama (aggregate) fonksiyonları kapalı; boyut yalnızca
            veritabanı fonksiyonuyla okunabiliyor ve bu çağrı başarısız oldu. Onun yerine dosya adedi:{" "}
            <span className="font-semibold text-ink-950">{storedFileCount.toLocaleString("tr-TR")}</span>.
          </p>
        )}
      </section>

      {/* --- Filtreler ----------------------------------------------------- */}
      <section className="space-y-3 rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        <form method="get" action="/app/belgeler" className="flex flex-wrap items-center gap-2">
          {kaynakF ? <input type="hidden" name="kaynak" value={kaynakF} /> : null}
          {turF ? <input type="hidden" name="tur" value={turF} /> : null}
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input
              name="q"
              defaultValue={q}
              aria-label="Belge ara"
              placeholder="Dosya adı, etiket veya ilişkili kayıt (müşteri/portföy) ara…"
              className="w-full rounded-[11px] border border-line bg-canvas py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
            />
          </div>
          <input
            name="from"
            type="date"
            defaultValue={fromF}
            aria-label="Başlangıç tarihi"
            className="rounded-[9px] border border-line bg-canvas px-2.5 py-2 text-sm outline-none focus:border-brand-400"
          />
          <span className="text-text-faint">—</span>
          <input
            name="to"
            type="date"
            defaultValue={toF}
            aria-label="Bitiş tarihi"
            className="rounded-[9px] border border-line bg-canvas px-2.5 py-2 text-sm outline-none focus:border-brand-400"
          />
          <button
            type="submit"
            className="focus-ring press rounded-[9px] bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
          >
            Filtrele
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">Kaynak</span>
          <Link href={buildHref({ kaynak: "", sayfa: "1" })} className={`${chipBase} ${kaynakF ? chipOff : chipOn}`}>
            Tümü ({total.toLocaleString("tr-TR")})
          </Link>
          {DOC_SOURCES.map((s) => (
            <Link
              key={s}
              href={buildHref({ kaynak: s, sayfa: "1" })}
              className={`${chipBase} ${kaynakF === s ? chipOn : chipOff}`}
            >
              {SOURCE_LABEL[s]}
              {kaynakF === s || !kaynakF ? ` (${sourceCounts[s].toLocaleString("tr-TR")})` : ""}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">Tür</span>
          <Link href={buildHref({ tur: "", sayfa: "1" })} className={`${chipBase} ${turF ? chipOff : chipOn}`}>
            Tümü
          </Link>
          {DOC_KINDS.map((k) => (
            <Link
              key={k}
              href={buildHref({ tur: k, sayfa: "1" })}
              className={`${chipBase} ${turF === k ? chipOn : chipOff}`}
            >
              {KIND_LABEL[k]}
            </Link>
          ))}
        </div>

        {hasFilter ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span className="rounded-full bg-brand-600/10 px-2.5 py-1 font-semibold text-brand-600">
              {total.toLocaleString("tr-TR")} belge
            </span>
            {q ? <span>“{q}” için filtrelendi</span> : null}
            {fromF || toF ? (
              <span>
                Tarih: {fromF || "başlangıç"} → {toF || "bugün"}
              </span>
            ) : null}
            <Link href="/app/belgeler" className="font-semibold text-brand-600 hover:underline">
              Filtreyi temizle
            </Link>
          </p>
        ) : null}
      </section>

      {/* --- Liste --------------------------------------------------------- */}
      {total === 0 && !hasFilter ? (
        <EmptyState
          icon={Archive}
          illustration="start"
          title="Henüz belge yok"
          description="Müşteri kartına dosya, portföye fotoğraf ya da anlaşmaya evrak eklendiğinde hepsi burada tek listede toplanır."
          action={{ href: "/app/musteriler", label: "Müşterilere git" }}
          secondary={{ href: "/app/portfoyler", label: "Portföylere git" }}
        />
      ) : pageRows.length === 0 ? (
        <EmptyState
          icon={FolderSearch}
          illustration="search"
          tone="amber"
          title={total > 0 ? "Bu sayfada belge yok" : "Filtreye uyan belge yok"}
          description={
            total > 0
              ? "Sayfa numarası sonuç aralığının dışında kaldı."
              : "Seçtiğiniz kaynak, tür, arama ve tarih aralığı birlikte hiçbir belgeyle eşleşmiyor."
          }
          action={total > 0 ? { href: buildHref({ sayfa: "1" }), label: "İlk sayfaya dön" } : undefined}
          secondary={{ href: "/app/belgeler", label: "Filtreyi temizle" }}
        />
      ) : (
        <>
          {capReached ? (
            <p className="flex items-center gap-2 rounded-[12px] border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-xs text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Birleşik sıralama {HARD_CAP.toLocaleString("tr-TR")} kayıt derinliğine kadar hesaplanır. Daha eskisine
              ulaşmak için tarih aralığı veya kaynak filtresi kullanın.
            </p>
          ) : null}
          <DocumentList rows={pageRows} />
        </>
      )}

      {/* --- Sayfalama ------------------------------------------------------ */}
      {totalPages > 1 ? (
        <nav
          aria-label="Sayfalama"
          className="flex items-center justify-between gap-3 rounded-[16px] border border-line bg-surface px-5 py-3"
        >
          {page > 1 ? (
            <Link
              href={buildHref({ sayfa: String(page - 1) })}
              className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
            >
              ← Önceki
            </Link>
          ) : (
            <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">
              ← Önceki
            </span>
          )}
          <span className="text-xs tabular-nums text-text-muted">
            Sayfa {page} / {totalPages} · toplam {total.toLocaleString("tr-TR")} belge
          </span>
          {page < totalPages ? (
            <Link
              href={buildHref({ sayfa: String(page + 1) })}
              className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
            >
              Sonraki →
            </Link>
          ) : (
            <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">
              Sonraki →
            </span>
          )}
        </nav>
      ) : null}

      {/* --- Belge sağlığı --------------------------------------------------- */}
      <section id="saglik" className="scroll-mt-24 space-y-4">
        <h2 className="font-display text-lg font-bold text-ink-950">Belge sağlığı</h2>

        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          {/* (a) eksik zorunlu evrak */}
          <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <div>
                <h3 className="flex items-center gap-2 font-display font-bold text-ink-950">
                  <FileWarning className="h-4 w-4 text-amber-600" /> Eksik zorunlu evrak
                </h3>
                <p className="text-xs text-text-muted">Açık anlaşmalarda tamamlanmamış zorunlu maddeler</p>
              </div>
              <Link
                href="/app/anlasmalar"
                className="focus-ring rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
              >
                Anlaşmalar
              </Link>
            </div>
            {missingDeals.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-text-muted">
                Açık anlaşmaların zorunlu evrak listesi tamam. Eksik madde yok.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {missingDeals.slice(0, 8).map((d) => (
                  <li key={d.dealId}>
                    <Link
                      href={`/app/anlasmalar/${d.dealId}`}
                      className="focus-ring group flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-brand-600/[0.03]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink-950 group-hover:text-brand-600">
                          {d.label}
                        </span>
                        <span className="block truncate text-[11px] text-text-muted">
                          {d.missing.join(" · ")}
                          {d.count > d.missing.length ? ` +${d.count - d.missing.length}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-bold text-amber-600">
                        {d.count} eksik
                      </span>
                    </Link>
                  </li>
                ))}
                {missingDeals.length > 8 ? (
                  <li className="px-5 py-2.5 text-[11px] text-text-faint">
                    +{missingDeals.length - 8} anlaşma daha ·{" "}
                    <Link href="/app/anlasmalar" className="font-semibold text-brand-600 hover:underline">
                      hepsini gör
                    </Link>
                  </li>
                ) : null}
              </ul>
            )}
          </div>

          {/* (b) + (c) */}
          <div className="space-y-4">
            <Link
              href="/app/musteriler"
              className="focus-ring press lift group block rounded-[18px] border border-line bg-surface p-5 transition hover:border-brand-300"
            >
              <span className="flex items-start justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-amber-400/12 text-amber-600">
                  <UserX className="h-5 w-5" />
                </span>
              </span>
              <p className="mt-4 text-sm text-text-muted">Belgesiz müşteri</p>
              <p className="numeric mt-1 font-display text-2xl font-extrabold text-ink-950">
                {(health?.customers_without_files ?? 0).toLocaleString("tr-TR")}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-text-faint">
                Hiç dosyası olmayan aktif müşteri. Müşteri listesinde “dosyasız” filtresi henüz yok — liste açılır,
                müşteri kartından dosya eklenir.
              </p>
            </Link>

            <Link
              href="/app/portfoyler?status=live"
              className="focus-ring press lift group block rounded-[18px] border border-line bg-surface p-5 transition hover:border-brand-300"
            >
              <span className="flex items-start justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-danger-500/10 text-danger-500">
                  <ImageOff className="h-5 w-5" />
                </span>
              </span>
              <p className="mt-4 text-sm text-text-muted">Fotoğrafsız yayındaki portföy</p>
              <p className="numeric mt-1 font-display text-2xl font-extrabold text-ink-950">
                {(health?.live_properties_without_photos ?? 0).toLocaleString("tr-TR")}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-text-faint">
                Yayında olup hiç görseli olmayan portföy — portal performansını en çok düşüren eksik.
              </p>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
