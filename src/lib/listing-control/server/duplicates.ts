import { fetchAllPaged } from "@/lib/cron-run";
import { now } from "@/lib/clock";
import { duplicateAnomalies, featureFacts, findDuplicatePairs, type DupProperty } from "../duplicates";
import type { ListingControlConfig } from "../config";
import { chunk, isMissingSchema, type Db } from "./db";

/**
 * KOPYA PORTFÖY TARAMASI (sunucu, günlük; MEVCUT `portal-teyit` cron'unun gece turuna eklenir, yeni cron YOK).
 * Ofis ofis aktif portföyleri okur, saf `findDuplicatePairs` ile çiftleri bulur ve `lc_sync_anomalies`'i YALNIZ
 * `duplicate` türüyle çağırır: koşulu kalmayan kopya uyarısı otomatik kapanır, "yanlış alarm" denen çift yeniden açılmaz,
 * portföy motorunun diğer türlerine dokunulmaz. service_role istemcisi çağırandan gelir (cron GET). Zaman bütçesi
 * dolarsa kalan ofisler ertesi geceye kalır (ofis sırası her gün döner).
 */

export type DuplicateScanSummary = { tenants: number; properties: number; pairs: number; opened: number; closed: number; timedOut: boolean; schemaMissing: boolean };

type PropRow = {
  id: string;
  property_code: string | null;
  created_at: string | null;
  district_id: string | null;
  property_type: string | null;
  transaction_type: string | null;
  title: string | null;
  address_line: string | null;
  list_price: number | null;
  features: Record<string, unknown> | null;
  parcel_block: string | null;
  parcel_lot: string | null;
  lat: number | null;
  lng: number | null;
};

const CLOSED_STATUSES = "(sold,rented,withdrawn,passive,archived,auth_expired)";
const MAX_PROPERTIES_PER_TENANT = 8_000;

export async function runDuplicateScan(
  db: Db,
  opts: { deadlineMs: number; cfgFor: (tenantId: string) => Promise<ListingControlConfig>; disabledTenantIds?: ReadonlySet<string>; rotateSeed?: number },
): Promise<DuplicateScanSummary> {
  const out: DuplicateScanSummary = { tenants: 0, properties: 0, pairs: 0, opened: 0, closed: 0, timedOut: false, schemaMissing: false };
  const { data: tenantRows, error: tErr } = await db.from("tenants").select("id").in("status", ["trial", "active", "past_due"]).order("id");
  if (tErr) return out;
  const tenants = ((tenantRows ?? []) as { id: string }[]).map((t) => t.id).filter((id) => !opts.disabledTenantIds?.has(id));
  // Her gece başka ofisten başla: bütçe yetmezse hep aynı ofisler atlanmasın.
  const start = tenants.length ? Math.abs(Math.floor(opts.rotateSeed ?? 0)) % tenants.length : 0;
  const ordered = [...tenants.slice(start), ...tenants.slice(0, start)];

  for (const tenantId of ordered) {
    if (now() >= opts.deadlineMs) {
      out.timedOut = true;
      break;
    }
    const cfg = await opts.cfgFor(tenantId);
    const { rows, error } = await fetchAllPaged<PropRow>(
      (from, to) =>
        db
          .from("properties")
          .select("id, property_code, created_at, district_id, property_type, transaction_type, title, address_line, list_price, features, parcel_block, parcel_lot, lat, lng")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .not("is_sample", "is", true)
          .not("status", "in", CLOSED_STATUSES)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: PropRow[] | null; error: { message: string } | null }>,
      1000,
      Math.ceil(MAX_PROPERTIES_PER_TENANT / 1000),
    );
    if (error && rows.length === 0) continue;
    out.tenants += 1;
    out.properties += rows.length;
    const props: DupProperty[] = rows.map((r) => {
      const f = featureFacts(r.features);
      return {
        id: r.id,
        code: r.property_code,
        createdAt: r.created_at,
        districtId: r.district_id,
        propertyType: r.property_type,
        transactionType: r.transaction_type,
        title: r.title,
        address: r.address_line,
        price: r.list_price === null ? null : Number(r.list_price),
        sqm: f.sqm,
        rooms: f.rooms,
        floor: f.floor,
        block: r.parcel_block,
        lot: r.parcel_lot,
        lat: r.lat,
        lng: r.lng,
      };
    });
    const pairs = findDuplicatePairs(props, cfg.duplicate.thresholdPercent);
    out.pairs += pairs.length;
    const desired = duplicateAnomalies(pairs);

    // Açık kopya uyarısı olan portföyler de eşitlenir (koşulu kalmayan otomatik kapanır).
    const { data: openRows, error: openErr } = await db
      .from("listing_anomalies")
      .select("property_id")
      .eq("tenant_id", tenantId)
      .eq("type", "duplicate")
      .in("status", ["open", "acknowledged", "explained"])
      .limit(2000);
    if (openErr) {
      if (isMissingSchema(openErr)) {
        out.schemaMissing = true;
        break;
      }
      continue;
    }
    const targets = new Set<string>([...desired.keys(), ...((openRows ?? []) as { property_id: string }[]).map((r) => r.property_id)]);
    for (const part of chunk([...targets], 50)) {
      for (const propertyId of part) {
        if (now() >= opts.deadlineMs) {
          out.timedOut = true;
          break;
        }
        const list = desired.get(propertyId) ?? [];
        const { data, error: e } = await db.rpc("lc_sync_anomalies", {
          p_tenant_id: tenantId,
          p_property_id: propertyId,
          p_desired: list.map((a) => ({
            type: a.type,
            severity: a.severity,
            dedupe_key: a.dedupeKey,
            portal_listing_id: null,
            risk_score: null,
            risk_points: [],
            details: a.details,
            sla_due_at: null,
          })),
          p_managed_types: ["duplicate"],
        });
        if (e) {
          if (isMissingSchema(e)) {
            out.schemaMissing = true;
            return out;
          }
          console.error("duplicate lc_sync_anomalies", { code: e.code });
          continue;
        }
        const r = (data ?? {}) as { opened?: number; reopened?: number; closed?: number };
        out.opened += (r.opened ?? 0) + (r.reopened ?? 0);
        out.closed += r.closed ?? 0;
      }
      if (out.timedOut) break;
    }
    if (out.timedOut) break;
  }
  return out;
}
