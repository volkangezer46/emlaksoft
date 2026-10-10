import { fetchAllPaged } from "@/lib/cron-run";
import { now } from "@/lib/clock";
import { featureFacts } from "../duplicates";
import { probeFromInventoryRow, INVENTORY_LIMITS } from "../inventory-import";
import { MATCH_BANDS, rankCandidates, type MatchProbe } from "../matching";
import { chunk, isMissingSchema, type Db } from "./db";

/**
 * GÜNLÜK EŞLEŞTİRME (sunucu; MEVCUT `portal-teyit` cron'unun gece turuna eklenir, yeni cron YOK). Eklentinin yüklediği envanter
 * yüklendiği anda kullanıcı oturumuyla karşılaştırılır (`lc_inventory_import`); bu adım ise GECE açık eşleşme adaylarını
 * güncel portföyle yeniden değerlendirir:
 *   1) Portföye sonradan bağlanmış ilanlar adaylıktan çıkar ('linked').
 *   2) Son TAM eklenti taramasında artık görünmeyen kayıtsız ilanlar kapanır ('ignored'; tek eksik okumayla değil, tam liste şart).
 *   3) Kalan adaylar portföyle "portal" ağırlık profiliyle yeniden sıralanır (bu arada eklenen portföyler yeni öneri doğurur);
 *      60+ yeni en iyi aday için aday portföyde `unregistered_listing` uyarısı açılır (mevcut tür, mükerrer tablo yok).
 * Portala hiç istek atılmaz. service_role istemcisi çağırandan gelir (cron GET). Süre dolarsa kalan ofisler ertesi geceye kalır.
 */

export type DailyMatchSummary = {
  tenants: number;
  candidates: number;
  linked: number;
  closed: number;
  reranked: number;
  anomaliesOpened: number;
  timedOut: boolean;
  schemaMissing: boolean;
};

type CandRow = {
  id: string;
  portal: string;
  external_id: string;
  title: string | null;
  price: number | string | null;
  candidates: { property_id: string; score: number }[] | null;
  top_score: number | string | null;
  detail: { sqm?: number; rooms?: string; location?: string; advisor?: string } | null;
  source_kind: string;
  last_seen_at: string;
  url: string | null;
};

type PropRow = {
  id: string;
  property_code: string | null;
  title: string | null;
  address_line: string | null;
  list_price: number | null;
  features: Record<string, unknown> | null;
  parcel_block: string | null;
  parcel_lot: string | null;
  lat: number | null;
  lng: number | null;
  district_id: string | null;
  branch_id: string | null;
  assigned_to: string | null;
};

const CLOSED_STATUSES = "(sold,rented,withdrawn,passive,archived,auth_expired)";
const MAX_POOL = 5_000;
const FULL_SCAN_WINDOW_HOURS = 48;

/** now() ± ms → ISO (saat tek kaynaktan: clock.ts). */
const isoAt = (offsetMs: number): string => new Date(now() + offsetMs).toISOString();

export async function runDailyMatch(
  db: Db,
  opts: { deadlineMs: number; disabledTenantIds?: ReadonlySet<string>; rotateSeed?: number },
): Promise<DailyMatchSummary> {
  const out: DailyMatchSummary = { tenants: 0, candidates: 0, linked: 0, closed: 0, reranked: 0, anomaliesOpened: 0, timedOut: false, schemaMissing: false };
  const { data: tenantRows, error: tErr } = await db.from("listing_matching_candidates").select("tenant_id").eq("status", "open").limit(5000);
  if (tErr) {
    if (isMissingSchema(tErr)) out.schemaMissing = true;
    return out;
  }
  const tenants = [...new Set(((tenantRows ?? []) as { tenant_id: string }[]).map((r) => r.tenant_id))]
    .filter((id) => !opts.disabledTenantIds?.has(id))
    .sort();
  const start = tenants.length ? Math.abs(Math.floor(opts.rotateSeed ?? 0)) % tenants.length : 0;
  const ordered = [...tenants.slice(start), ...tenants.slice(0, start)];

  for (const tenantId of ordered) {
    if (now() >= opts.deadlineMs) {
      out.timedOut = true;
      break;
    }
    const { data: candData, error: cErr } = await db
      .from("listing_matching_candidates")
      .select("id, portal, external_id, url, title, price, candidates, top_score, detail, source_kind, last_seen_at")
      .eq("tenant_id", tenantId)
      .eq("status", "open")
      .order("last_seen_at", { ascending: false })
      .limit(1000);
    if (cErr) {
      if (isMissingSchema(cErr)) {
        // `detail` kolonu (20261010000500) henüz yok: günlük adım kapalı çalışır.
        out.schemaMissing = true;
        break;
      }
      continue;
    }
    let cands = (candData ?? []) as CandRow[];
    if (cands.length === 0) continue;
    out.tenants += 1;
    out.candidates += cands.length;

    // 1) Portföye sonradan bağlanmış ilanlar adaylıktan çıkar.
    const linkedIds = new Map<string, string>();
    for (const part of chunk(cands.map((c) => c.external_id), 200)) {
      const { data } = await db.from("portal_listings").select("id, portal_name, portal_listing_id").eq("tenant_id", tenantId).eq("status", "live").in("portal_listing_id", part);
      for (const r of (data ?? []) as { id: string; portal_name: string; portal_listing_id: string }[]) {
        linkedIds.set(`${r.portal_name.trim().toLowerCase()}|${r.portal_listing_id.trim().toLowerCase()}`, r.id);
      }
    }
    for (const c of cands) {
      const listingId = linkedIds.get(`${c.portal.trim().toLowerCase()}|${c.external_id.trim().toLowerCase()}`);
      if (!listingId) continue;
      const { error } = await db
        .from("listing_matching_candidates")
        .update({ status: "linked", linked_listing_id: listingId, decided_at: isoAt(0) })
        .eq("id", c.id)
        .eq("tenant_id", tenantId)
        .eq("status", "open");
      if (!error) out.linked += 1;
    }
    cands = cands.filter((c) => !linkedIds.has(`${c.portal.trim().toLowerCase()}|${c.external_id.trim().toLowerCase()}`));

    // 2) Son TAM eklenti taramasında artık görünmeyen kayıtsız ilanlar kapanır.
    const sinceIso = isoAt(-FULL_SCAN_WINDOW_HOURS * 3_600_000);
    const { data: impData } = await db
      .from("listing_inventory_imports")
      .select("portal, created_at")
      .eq("tenant_id", tenantId)
      .eq("source", "extension")
      .eq("complete", true)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(50);
    const latestFull = new Map<string, number>();
    for (const r of (impData ?? []) as { portal: string; created_at: string }[]) {
      const key = r.portal.trim().toLowerCase();
      if (!latestFull.has(key)) latestFull.set(key, Date.parse(r.created_at));
    }
    const vanished = cands.filter((c) => c.source_kind === "assisted" && (latestFull.get(c.portal.trim().toLowerCase()) ?? 0) - Date.parse(c.last_seen_at) > 3_600_000);
    for (const part of chunk(vanished.map((c) => c.id), 100)) {
      const { error } = await db.from("listing_matching_candidates").update({ status: "ignored", decided_at: isoAt(0) }).eq("tenant_id", tenantId).eq("status", "open").in("id", part);
      if (!error) out.closed += part.length;
    }
    const vanishedIds = new Set(vanished.map((c) => c.id));
    cands = cands.filter((c) => !vanishedIds.has(c.id));
    if (cands.length === 0) continue;

    // 3) Güncel portföyle yeniden sırala.
    const { rows: props, error: pErr } = await fetchAllPaged<PropRow>(
      (from, to) =>
        db
          .from("properties")
          .select("id, property_code, title, address_line, list_price, features, parcel_block, parcel_lot, lat, lng, district_id, branch_id, assigned_to")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .not("is_sample", "is", true)
          .not("status", "in", CLOSED_STATUSES)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: PropRow[] | null; error: { message: string } | null }>,
      1000,
      Math.ceil(MAX_POOL / 1000),
    );
    if (pErr && props.length === 0) continue;
    const pool = props.map((p) => {
      const f = featureFacts(p.features);
      const probe: MatchProbe = { title: p.title, address: p.address_line, price: p.list_price === null ? null : Number(p.list_price), sqm: f.sqm, rooms: f.rooms, block: p.parcel_block, lot: p.parcel_lot, lat: p.lat, lng: p.lng, districtKey: p.district_id };
      return { id: p.id, code: p.property_code, branch: p.branch_id, advisor: p.assigned_to, probe };
    });
    const poolById = new Map(pool.map((p) => [p.id, p]));

    for (const c of cands) {
      if (now() >= opts.deadlineMs) {
        out.timedOut = true;
        break;
      }
      const price = c.price === null ? null : Number(c.price);
      const subject = probeFromInventoryRow({ title: c.title, price, sqm: c.detail?.sqm ?? null, rooms: c.detail?.rooms ?? null, location: c.detail?.location ?? null, advisorName: c.detail?.advisor ?? null });
      const near = price ? pool.filter((p) => !p.probe.price || Math.abs(p.probe.price - price) / Math.max(p.probe.price, price) <= 0.25) : pool;
      const ranked = rankCandidates(subject, near, INVENTORY_LIMITS.candidateMinScore, undefined, 3, "portal");
      const next = ranked.map((r) => ({ property_id: r.candidate.id, code: r.candidate.code, score: r.match.score, signals: r.match.signals }));
      const prevTop = c.candidates?.[0];
      const oldScore = c.top_score === null ? null : Number(c.top_score);
      const newScore = next[0]?.score ?? null;
      if (prevTop?.property_id === next[0]?.property_id && oldScore === newScore) continue;
      const { error } = await db.from("listing_matching_candidates").update({ candidates: next, top_score: newScore }).eq("id", c.id).eq("tenant_id", tenantId).eq("status", "open");
      if (error) continue;
      out.reranked += 1;
      // Yeni en iyi aday 60+ ise (önceden yoktu/altındaydı) aday portföyde "kayıtsız ilan" uyarısı.
      const top = next[0];
      if (top && top.score >= MATCH_BANDS.unsure && (oldScore === null || oldScore < MATCH_BANDS.unsure)) {
        const p = poolById.get(top.property_id);
        const key = `unregistered_listing:${c.portal.trim().toLowerCase()}:${c.external_id.trim().toLowerCase()}`.slice(0, 200);
        const { data: ins } = await db
          .from("listing_anomalies")
          .upsert(
            {
              tenant_id: tenantId,
              property_id: top.property_id,
              type: "unregistered_listing",
              severity: "medium",
              dedupe_key: key,
              branch_id: p?.branch ?? null,
              advisor_id: p?.advisor ?? null,
              assignee_id: p?.advisor ?? null,
              details: { portal: c.portal, externalId: c.external_id.slice(0, 200), url: c.url?.slice(0, 2048) ?? null, title: c.title?.slice(0, 300) ?? null, price, score: top.score },
              sla_due_at: isoAt(4 * 3_600_000),
            },
            { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true },
          )
          .select("id");
        const created = (ins ?? []) as { id: string }[];
        if (created.length > 0) {
          out.anomaliesOpened += 1;
          await db.from("listing_anomaly_actions").insert({ tenant_id: tenantId, anomaly_id: created[0].id, action: "opened", note: "Gece eşleştirmesi: portal ilanı portföyle eşleşti" });
        }
      }
    }
    if (out.timedOut) break;
  }
  return out;
}
