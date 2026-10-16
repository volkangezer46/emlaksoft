import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "@/components/ui/smart-link";
import { ClipboardCheck, ClipboardList, DoorClosed, DoorOpen, FileSignature, Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { formatDateTr } from "@/lib/format";
import {
  CONDITION_LABELS,
  KIND_LABELS,
  KIND_SLUGS,
  METER_KEYS,
  METER_LABELS,
  METER_UNITS,
  countConditions,
  deductionLabel,
  depositSummary,
  diffInspections,
  meterUsage,
  normalizeMeters,
  normalizeRooms,
  type InspectionKind,
} from "@/lib/rentals/inspection";
import { DeductionsPanel } from "./deductions-panel";
import { GuarantorCard } from "./guarantor-card";

type InspectionRow = {
  id: string;
  kind: InspectionKind;
  status: string;
  inspected_on: string;
  rooms: unknown;
  meters: unknown;
  contract_id: string | null;
  updated_at: string;
};

const CONTRACT_STATUS: Record<string, { label: string; variant: "success" | "warning" | "outline" }> = {
  draft: { label: "İmza taslağı", variant: "warning" },
  sent: { label: "İmzada", variant: "warning" },
  signed: { label: "İmzalandı", variant: "success" },
  rejected: { label: "İmza reddedildi", variant: "outline" },
  cancelled: { label: "İmza iptal", variant: "outline" },
};

/**
 * Kira detayı "Teslim & tahliye" sekmesi (SP6): giriş/çıkış tutanak kartları, sayaç farkı, kalemli depozito kesintisi
 * (çıkış tutanağındaki kötüleşen kalemlerden öneri) ve kefil. Tablolar yoksa (migration bekliyor) kurulum notu.
 */
export async function InspectionsTab({
  supabase,
  tenantId,
  rentalId,
  deposit,
  depositReturned,
  canEdit,
}: {
  supabase: SupabaseClient;
  tenantId: string;
  rentalId: string;
  deposit: number | null;
  depositReturned: boolean;
  canEdit: boolean;
}) {
  const [inspRes, dedRes, guarantorRes] = await Promise.all([
    supabase
      .from("rental_inspections")
      .select("id, kind, status, inspected_on, rooms, meters, contract_id, updated_at")
      .eq("rental_id", rentalId)
      .eq("tenant_id", tenantId),
    supabase
      .from("rental_deposit_deductions")
      .select("id, label, amount, item_key, inspection_id, created_at")
      .eq("rental_id", rentalId)
      .eq("tenant_id", tenantId)
      .order("created_at"),
    supabase.from("rentals").select("guarantor_name, guarantor_phone, guarantor_address").eq("id", rentalId).eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (inspRes.error || dedRes.error) {
    return (
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 text-sm text-text-muted">
        Teslim ve tahliye tutanağı kurulum bekliyor (veritabanı güncellemesi henüz uygulanmamış).
      </section>
    );
  }
  const inspections = (inspRes.data ?? []) as InspectionRow[];
  const moveIn = inspections.find((i) => i.kind === "move_in") ?? null;
  const moveOut = inspections.find((i) => i.kind === "move_out") ?? null;
  const contractIds = inspections.map((i) => i.contract_id).filter((x): x is string => Boolean(x));
  const { data: contracts } = contractIds.length
    ? await supabase.from("contracts").select("id, status").in("id", contractIds)
    : { data: [] as { id: string; status: string }[] };
  const contractStatus = new Map((contracts ?? []).map((c) => [c.id, c.status as string]));

  const deductions = ((dedRes.data ?? []) as { id: string; label: string; amount: number | string; item_key: string | null; inspection_id: string | null }[]).map((d) => ({
    ...d,
    amount: Number(d.amount),
  }));
  const summary = depositSummary(deposit, deductions);
  const usedKeys = new Set(deductions.map((d) => d.item_key).filter(Boolean));
  const suggestions = moveOut
    ? diffInspections(moveIn ? normalizeRooms(moveIn.rooms) : null, normalizeRooms(moveOut.rooms))
        .filter((c) => !usedKeys.has(c.itemKey))
        .map((c) => ({ itemKey: c.itemKey, label: deductionLabel(c), before: c.before ? CONDITION_LABELS[c.before] : null, after: CONDITION_LABELS[c.after], note: c.note }))
    : [];
  const usage = moveIn && moveOut ? meterUsage(normalizeMeters(moveIn.meters), normalizeMeters(moveOut.meters)) : null;
  const guarantor = guarantorRes.error ? null : (guarantorRes.data as { guarantor_name: string | null; guarantor_phone: string | null; guarantor_address: string | null } | null);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <InspectionCard rentalId={rentalId} kind="move_in" row={moveIn} contractStatus={moveIn?.contract_id ? contractStatus.get(moveIn.contract_id) ?? null : null} canEdit={canEdit} />
        <InspectionCard rentalId={rentalId} kind="move_out" row={moveOut} contractStatus={moveOut?.contract_id ? contractStatus.get(moveOut.contract_id) ?? null : null} canEdit={canEdit} />
      </div>

      {usage ? (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
          <h3 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
            <Gauge className="h-4 w-4 text-brand-600" aria-hidden="true" /> Kira süresince sayaç tüketimi
          </h3>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
            {METER_KEYS.map((k) => (
              <div key={k} className="rounded-[var(--radius-card)] bg-canvas px-3 py-2">
                <dt className="text-xs text-text-muted">{METER_LABELS[k]}</dt>
                <dd className="numeric font-semibold text-ink-950">{usage[k] != null ? `${usage[k]!.toLocaleString("tr-TR")} ${METER_UNITS[k]}` : "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-text-muted">Son faturaları kapatmak ve aboneliği devretmek için tahliye okumasını kullanın.</p>
        </section>
      ) : null}

      {deposit != null && deposit > 0 ? (
        <DeductionsPanel
          rentalId={rentalId}
          moveOutId={moveOut?.id ?? null}
          deductions={deductions.map((d) => ({ id: d.id, label: d.label, amount: d.amount }))}
          suggestions={suggestions}
          summary={summary}
          locked={depositReturned}
          canEdit={canEdit}
        />
      ) : null}

      {!guarantorRes.error ? (
        <GuarantorCard rentalId={rentalId} guarantor={guarantor} canEdit={canEdit} />
      ) : null}
    </div>
  );
}

function InspectionCard({
  rentalId,
  kind,
  row,
  contractStatus,
  canEdit,
}: {
  rentalId: string;
  kind: InspectionKind;
  row: InspectionRow | null;
  contractStatus: string | null;
  canEdit: boolean;
}) {
  const Icon = kind === "move_in" ? DoorOpen : DoorClosed;
  const href = `/app/kiralama/${rentalId}/tutanak/${KIND_SLUGS[kind]}`;
  const counts = row ? countConditions(normalizeRooms(row.rooms)) : null;
  const sign = contractStatus ? CONTRACT_STATUS[contractStatus] : null;
  return (
    <section className="flex flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
          <Icon className="h-4 w-4 text-brand-600" aria-hidden="true" /> {KIND_LABELS[kind]}
        </h3>
        {row ? (
          <Badge variant={row.status === "final" ? "success" : "warning"} size="sm">{row.status === "final" ? "Kesinleşti" : "Taslak"}</Badge>
        ) : (
          <Badge variant="outline" size="sm">Yok</Badge>
        )}
      </div>
      {row && counts ? (
        <div className="mt-2 space-y-1 text-xs text-text-muted">
          <p>{formatDateTr(row.inspected_on, { day: "2-digit", month: "long", year: "numeric" })} · {counts.total} kalem</p>
          <p>
            <span className="text-mint-700">{counts.good} iyi</span>
            {counts.worn ? <> · <span className="text-amber-700">{counts.worn} yıpranmış</span></> : null}
            {counts.damaged ? <> · <span className="text-danger-600">{counts.damaged} hasarlı</span></> : null}
            {counts.missing ? <> · <span className="text-danger-600">{counts.missing} eksik</span></> : null}
          </p>
          {sign ? (
            <p className="flex items-center gap-1.5">
              <FileSignature className="h-3.5 w-3.5" aria-hidden="true" />
              <Link href={`/app/sozlesmeler/${row.contract_id}`} className="font-semibold text-brand-600 hover:underline">{sign.label}</Link>
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-text-muted">
          {kind === "move_in"
            ? "Anahtar tesliminde oda oda durumu, sayaçları ve anahtarları fotoğraflı kaydedin; tahliyede kıyas buna göre yapılır."
            : "Tahliyede aynı odaları gezin; kötüleşen kalemler depozito kesintisi olarak önerilir."}
        </p>
      )}
      <div className="mt-auto pt-3">
        {row || canEdit ? (
          <ButtonLink href={href} variant={row ? "outline" : "primary"} icon={row ? ClipboardList : ClipboardCheck}>
            {row ? (row.status === "final" || !canEdit ? "Tutanağı aç" : "Tutanağa devam et") : "Tutanak başlat"}
          </ButtonLink>
        ) : null}
      </div>
    </section>
  );
}
