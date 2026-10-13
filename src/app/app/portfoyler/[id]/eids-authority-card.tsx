import { ShieldCheck } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { now } from "@/lib/clock";
import { formatDateTimeTr, formatDateTr } from "@/lib/format";
import { authorityPublishBlock, AUTHORITY_OVERRIDE_TTL_HOURS } from "@/lib/authority-shield";
import {
  EIDS_EXEMPT_LABELS,
  EIDS_SOURCE_LABELS,
  EIDS_STATUS_LABELS,
  eidsDisplayStatus,
  isEidsExemptReason,
  isEidsSource,
  isEidsVerifyStatus,
  type EidsDisplayStatus,
} from "@/lib/eids/authority-status";
import { activeOverride, loadAuthorityEvents, undoableEvent } from "@/lib/eids/load";
import { EIDS_EVENT_KIND_LABELS, EIDS_EVENT_SOURCE_LABELS } from "@/lib/eids/event-labels";
import { EidsAuthorityForm } from "./eids-authority-form";

/**
 * Portföy "Yetki durumu (EİDS)" kartı (Belgeler sekmesi). Durum, kaynak, bitiş, son teyit / Bakanlık e-postası, maskeli
 * malik, istisna, yayın engeli ve yetki defteri geçmişi. Yazma `setPropertyAuthority` / `setAuthorityExemption` /
 * `undoAuthorityChange` / `overrideAuthorityBlock` eylemleriyle, hepsi tek yazma noktası `applyAuthorityEvent` üzerinden.
 * Defter sütunları yoksa (migration uygulanmamış) kart "kurulum bekliyor" der; sahte durum göstermez.
 */

const VARIANT: Record<EidsDisplayStatus, BadgeVariant> = {
  unknown: "outline",
  pending: "warning",
  approved: "success",
  expiring: "warning",
  expired: "danger",
  revoked: "danger",
  rejected: "danger",
  exempt: "info",
};

type Row = {
  authorization_start: string | null;
  authorization_end: string | null;
  eids_property_no: string | null;
  authority_eids_status: string | null;
  authority_eids_source: string | null;
  authority_eids_verified_at: string | null;
  authority_grantor_masked: string | null;
  authority_last_email_at: string | null;
  eids_exempt_reason: string | null;
};

const SECTION = "rounded-[var(--radius-panel)] border border-line bg-surface p-5";

export async function EidsAuthorityCard({
  tenantId,
  propertyId,
  canEdit,
  isOwner,
}: {
  tenantId: string | null | undefined;
  propertyId: string;
  canEdit: boolean;
  isOwner: boolean;
}) {
  if (!tenantId) return null;
  const supabase = await createClient();
  const [propRes, events, mediaRes] = await Promise.all([
    supabase
      .from("properties")
      .select(
        "authorization_start, authorization_end, eids_property_no, authority_eids_status, authority_eids_source, authority_eids_verified_at, authority_grantor_masked, authority_last_email_at, eids_exempt_reason",
      )
      .eq("id", propertyId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    loadAuthorityEvents(supabase, tenantId, propertyId, 15),
    supabase
      .from("property_media")
      .select("id, file_name, is_document")
      .eq("property_id", propertyId)
      .eq("tenant_id", tenantId)
      .eq("kind", "image")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  if (propRes.error || !propRes.data) {
    if (propRes.error && !isMissingSchema(propRes.error)) console.error("EidsAuthorityCard", { code: propRes.error.code });
    return (
      <section className={SECTION}>
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <ShieldCheck className="h-4 w-4 text-text-muted" /> Yetki durumu (EİDS)
        </h2>
        <p className="mt-2 text-sm text-text-muted">Yetki defteri kurulumu bekleniyor; durum şimdilik İlan Kontrol &gt; Yetki kuyruğundan işaretlenebilir.</p>
      </section>
    );
  }

  const row = propRes.data as Row;
  const nowMs = now();
  const display = eidsDisplayStatus(row, nowMs);
  const block = authorityPublishBlock(row, nowMs);
  const evs = events.available ? events.events : [];
  const override = block ? activeOverride(evs, nowMs, AUTHORITY_OVERRIDE_TTL_HOURS) : null;
  const undo = undoableEvent(evs);
  const docs = ((mediaRes.data ?? []) as { id: string; file_name: string | null; is_document?: boolean | null }[])
    .filter((m) => m.is_document)
    .map((m) => ({ id: m.id, label: m.file_name ?? "Belge" }));
  const exempt = isEidsExemptReason(row.eids_exempt_reason) ? row.eids_exempt_reason : null;
  const fact = (label: string, value: string | null) => (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right font-semibold text-ink-950">{value ?? "—"}</dd>
    </div>
  );

  return (
    <section className={SECTION} id="yetki-durumu">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <ShieldCheck className="h-4 w-4 text-text-muted" /> Yetki durumu (EİDS)
        </h2>
        <Badge variant={VARIANT[display]} size="md">{EIDS_STATUS_LABELS[display]}</Badge>
      </div>

      <dl className="mt-3 grid gap-1.5 sm:grid-cols-2 sm:gap-x-6">
        {fact("Kaynak", isEidsSource(row.authority_eids_source) ? EIDS_SOURCE_LABELS[row.authority_eids_source] : null)}
        {fact("Yetki bitişi", row.authorization_end ? formatDateTr(row.authorization_end) : null)}
        {fact("Taşınmaz no", row.eids_property_no)}
        {fact("Yetkiyi veren", row.authority_grantor_masked)}
        {fact("Son teyit", row.authority_eids_verified_at ? formatDateTimeTr(row.authority_eids_verified_at) : null)}
        {fact("Son Bakanlık e-postası", row.authority_last_email_at ? formatDateTimeTr(row.authority_last_email_at) : null)}
        {exempt ? fact("İstisna", EIDS_EXEMPT_LABELS[exempt]) : null}
      </dl>

      {block ? (
        <div role="alert" className="mt-3 rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm text-danger-600">
          <p className="font-semibold">{override ? "Yayın engeli geçici olarak aşıldı" : "Yeni yayın ve portal aktarımı engelli"}</p>
          <p className="mt-0.5 text-xs">
            {override
              ? `Ofis sahibinin izni ${formatDateTimeTr(Date.parse(override.created_at) + AUTHORITY_OVERRIDE_TTL_HOURS * 3_600_000)} tarihine kadar geçerli. Gerekçe: ${override.note ?? "—"}`
              : block.message}
          </p>
        </div>
      ) : null}

      {!events.available ? (
        <p className="mt-3 text-xs text-text-muted">Yetki defteri kurulumu bekleniyor: değişiklikler kaydedilir ama geçmiş ve geri alma kurulumdan sonra görünür.</p>
      ) : null}

      <EidsAuthorityForm
        propertyId={propertyId}
        canEdit={canEdit}
        isOwner={isOwner}
        showOverride={Boolean(block) && !override}
        initial={{
          status: isEidsVerifyStatus(row.authority_eids_status) ? row.authority_eids_status : "unknown",
          source: row.authority_eids_source && ["manual", "document", "portal_check"].includes(row.authority_eids_source) ? row.authority_eids_source : "manual",
          validUntil: row.authorization_end ? String(row.authorization_end).slice(0, 10) : "",
          grantedOn: row.authorization_start ? String(row.authorization_start).slice(0, 10) : "",
          exempt,
        }}
        documents={docs}
        undo={undo ? { id: undo.id, label: `${EIDS_EVENT_KIND_LABELS[undo.kind] ?? undo.kind} · ${formatDateTimeTr(undo.created_at)}` } : null}
      />

      {evs.length > 0 ? (
        <details className="mt-4 group">
          <summary className="focus-ring cursor-pointer rounded py-2 text-sm font-semibold text-accent-text touch:min-h-11">
            Yetki geçmişi ({evs.length})
          </summary>
          <ol className="mt-2 space-y-1.5">
            {evs.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-1.5 text-xs last:border-0">
                <span className="font-semibold text-ink-950">
                  {EIDS_EVENT_KIND_LABELS[e.kind] ?? e.kind}
                  {e.prev_status !== e.new_status && e.new_status
                    ? ` · ${labelOf(e.prev_status)} → ${labelOf(e.new_status)}`
                    : ""}
                </span>
                <span className="text-text-muted">
                  {EIDS_EVENT_SOURCE_LABELS[e.source] ?? e.source}
                  {e.valid_until ? ` · bitiş ${formatDateTr(e.valid_until)}` : ""}
                  {e.inbound_message_id ? " · e-posta" : ""}
                  {e.note ? ` · ${e.note}` : ""} · {formatDateTimeTr(e.created_at)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

function labelOf(s: string | null): string {
  return s && isEidsVerifyStatus(s) ? EIDS_STATUS_LABELS[s] : "—";
}
