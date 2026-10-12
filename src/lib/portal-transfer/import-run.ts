import type { SupabaseClient } from "@supabase/supabase-js";
import { rankUnregistered, type InventoryRow } from "@/lib/listing-control/inventory-import";
import { daysAgoIso } from "@/lib/clock";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { planImport, summarizeImport, importSummaryText, type ImportDecision, type ImportItem, type ImportSummaryCounts } from "./import-plan";
import { loadBoundMap, loadMatchPool } from "./server";
import type { TransferPortal } from "./rules";

/**
 * Portaldan içe aktarma YÜRÜTÜCÜSÜ (kullanıcı oturumu istemcisi; service_role YOK). Karar `import-plan.ts` (saf), burada yazım:
 *   new            → taslak portföy (status 'draft', is_sample false, atanan = çağıran) + `pt_import_bind` (kaynak 'assisted', 'import')
 *   possible_match → YENİ portföy açılmaz; aday eşleşme kuyruğuna `lc_inventory_import` ile yazılır (kullanıcı onaylar)
 *   already_bound  → atlanır
 * Bağlama başarısız olursa (yarış: aynı ilan no aynı anda başka portföye bağlandı) açılan taslak geri alınır (silinmiş işaretlenir).
 */

type Db = SupabaseClient;

export type ImportResultRow = {
  externalId: string;
  kind: "created" | "already_bound" | "possible_match" | "failed";
  propertyId?: string;
  propertyCode?: string | null;
  score?: number;
  message?: string;
};

export type ImportRun = { counts: ImportSummaryCounts; summary: string; results: ImportResultRow[] };

export type ImportDeps = {
  db: Db;
  tenantId: string;
  userId: string;
  role: string;
  portal: TransferPortal;
  /** Konum metni → il/ilçe kimliği (merkezi coğrafya okuyucusu; çözülemezse null). */
  resolvePlace: (text: string | null) => Promise<{ provinceId: string; districtId: string } | null>;
  /** Yeni portföy kodu üretici (`ES-YYAA-XXXXXX`). */
  newPropertyCode: () => string;
};

const MANAGERS = new Set(["owner", "gm", "branch_manager"]);

function failed(item: ImportItem, message: string): ImportResultRow {
  return { externalId: item.externalId, kind: "failed", message };
}

export async function runPortalImport(deps: ImportDeps, items: readonly ImportItem[]): Promise<ImportRun | { error: string }> {
  const { db, tenantId, userId, portal } = deps;
  const scope = MANAGERS.has(deps.role) ? "office" : "mine";
  const [bound, pool] = await Promise.all([loadBoundMap(db, tenantId, portal, items.map((i) => i.externalId)), loadMatchPool(db, scope, userId)]);
  const decisions = planImport(portal, items, bound, pool);
  const results: ImportResultRow[] = [];
  const toRegister: ImportDecision[] = [];

  for (const d of decisions) {
    if (d.kind === "already_bound") {
      results.push({ externalId: d.item.externalId, kind: "already_bound", propertyId: d.propertyId, propertyCode: d.propertyCode });
      continue;
    }
    if (d.kind === "possible_match") {
      toRegister.push(d);
      results.push({ externalId: d.item.externalId, kind: "possible_match", propertyId: d.propertyId, propertyCode: d.propertyCode, score: d.score });
      continue;
    }
    const place = await deps.resolvePlace(d.draft.location);
    const code = deps.newPropertyCode();
    const { data: created, error } = await db
      .from("properties")
      .insert({
        tenant_id: tenantId,
        property_code: code,
        title: d.draft.title,
        transaction_type: d.draft.transaction_type,
        property_type: d.draft.property_type,
        status: "draft",
        list_price: d.draft.list_price,
        province_id: place?.provinceId ?? null,
        district_id: place?.districtId ?? null,
        features: d.draft.features,
        assigned_to: userId,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !created) {
      console.error("portal import insert", { code: error?.code });
      results.push(failed(d.item, "Taslak portföy açılamadı (paket sınırı ya da yetki)."));
      continue;
    }
    const propertyId = String((created as { id: string }).id);
    const { data: bind, error: bindError } = await db.rpc("pt_import_bind", {
      p_property_id: propertyId,
      p_portal: portal,
      p_external_id: d.item.externalId,
      p_url: d.item.url,
    });
    const outcome = String((bind as { outcome?: string } | null)?.outcome ?? "");
    if (bindError || (outcome !== "applied" && outcome !== "replay")) {
      // Yarım kalan taslak bırakılmaz.
      await db.from("properties").update({ deleted_at: daysAgoIso(0) }).eq("id", propertyId).eq("tenant_id", tenantId);
      if (bindError && isMissingSchema(bindError)) return { error: "Portaldan alma için sistem güncellemesi bekleniyor." };
      results.push(failed(d.item, outcome === "bound_to_other_property" ? "Bu ilan numarası başka bir portföye bağlı." : "İlan portföye bağlanamadı."));
      continue;
    }
    results.push({ externalId: d.item.externalId, kind: "created", propertyId, propertyCode: code });
  }

  if (toRegister.length > 0) {
    const rows: InventoryRow[] = toRegister.map((d) => ({
      externalId: d.item.externalId,
      url: d.item.url,
      title: d.item.title,
      price: d.item.price,
      advisorName: null,
      status: d.item.status,
      sqm: d.item.sqm,
      rooms: d.item.rooms,
      location: d.item.location,
    }));
    const { error } = await db.rpc("lc_inventory_import", {
      p_portal: portal,
      p_scope: scope,
      p_source: "extension",
      p_complete: false,
      p_observations: [],
      p_candidates: rankUnregistered(rows, pool),
      p_summary: null,
    });
    if (error) console.error("portal import candidates", { code: error.code });
  }

  const counts = summarizeImport(results);
  // Ölçüm kaydı (kişisel veri yok; en iyi çaba).
  const { error: recErr } = await db.rpc("pt_record_import", { p_portal: portal, p_summary: { ...counts } });
  if (recErr && !isMissingSchema(recErr)) console.error("pt_record_import", { code: recErr.code });
  return { counts, summary: importSummaryText(counts), results };
}
