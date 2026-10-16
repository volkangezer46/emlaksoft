import { notFound } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { ArrowLeft } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { trDayKey, now } from "@/lib/clock";
import {
  DEFAULT_KEYS,
  KIND_LABELS,
  defaultRooms,
  emptyMeters,
  kindFromSlug,
  normalizeKeys,
  normalizeMeters,
  normalizeRooms,
  roomsFromMoveIn,
  type Condition,
} from "@/lib/rentals/inspection";
import { InspectionEditor, type EditorPhoto } from "./inspection-editor";

export const metadata = { title: "Teslim / tahliye tutanağı" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Teslim (giriş) / tahliye (çıkış) tutanağı (SP6) — mobil öncelikli: oda oda kalem durumu, kalem başına kamera ile
 * fotoğraf, sayaçlar, anahtarlar; taslak otomatik kaydedilir. Çıkış tutanağı giriş tutanağının odalarıyla açılır ve her
 * kalemde teslimdeki durumu gösterir. Fotoğraflar özel kovada; önizleme 10 dk geçerli imzalı bağlantıyla.
 */
export default async function TutanakPage({ params }: { params: Promise<{ id: string; tur: string }> }) {
  const [{ perms, tenantId }, { id, tur }] = await Promise.all([requireModulePage("rentals", "/app/kiralama"), params]);
  const kind = kindFromSlug(tur);
  if (!kind || !UUID_RE.test(id)) notFound();
  const canEdit = perms.rentals?.includes("edit") ?? false;
  const canSign = perms.contracts?.includes("create") ?? false;

  const supabase = await createClient();
  const [{ data: rental }, inspRes] = await Promise.all([
    supabase
      .from("rentals")
      .select("id, deposit, deposit_returned, property:properties!rentals_property_id_fkey(id, title, property_code), renter:customers!rentals_renter_customer_id_fkey(id, full_name)")
      .eq("id", id)
      .eq("tenant_id", tenantId ?? "")
      .maybeSingle(),
    supabase
      .from("rental_inspections")
      .select("id, kind, status, inspected_on, rooms, meters, keys, notes, contract_id, updated_at")
      .eq("rental_id", id)
      .eq("tenant_id", tenantId ?? ""),
  ]);
  if (!rental) notFound();
  const property = one(rental.property as Rel<{ id: string; title: string | null; property_code: string | null }>);
  const renter = one(rental.renter as Rel<{ id: string; full_name: string | null }>);
  const back = (
    <Link href={`/app/kiralama/${id}?sekme=teslim`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
      <ArrowLeft className="h-4 w-4" /> Kira kaydı
    </Link>
  );
  if (inspRes.error) {
    return (
      <div className="space-y-6">
        {back}
        <PageHeader title={KIND_LABELS[kind]} />
        <Alert tone="warning">Teslim/tahliye tutanağı kurulum bekliyor: veritabanı güncellemesi henüz uygulanmamış.</Alert>
      </div>
    );
  }
  type Insp = { id: string; kind: string; status: string; inspected_on: string; rooms: unknown; meters: unknown; keys: unknown; notes: string | null; contract_id: string | null };
  const rows = (inspRes.data ?? []) as Insp[];
  const current = rows.find((r) => r.kind === kind) ?? null;
  const moveIn = kind === "move_out" ? (rows.find((r) => r.kind === "move_in") ?? null) : null;
  const moveInRooms = moveIn ? normalizeRooms(moveIn.rooms) : null;

  // Başlangıç içeriği: kayıt varsa o; çıkışta giriş tutanağının odaları (abone numaraları taşınır); yoksa şablon.
  const initialRooms = current ? normalizeRooms(current.rooms) : moveInRooms && moveInRooms.length > 0 ? roomsFromMoveIn(moveInRooms) : defaultRooms();
  const moveInMeters = moveIn ? normalizeMeters(moveIn.meters) : null;
  const initialMeters = current
    ? normalizeMeters(current.meters)
    : moveInMeters
      ? { electricity: { reading: "", subscriber: moveInMeters.electricity.subscriber }, water: { reading: "", subscriber: moveInMeters.water.subscriber }, gas: { reading: "", subscriber: moveInMeters.gas.subscriber } }
      : emptyMeters();
  const initialKeys = current ? normalizeKeys(current.keys) : moveIn ? normalizeKeys(moveIn.keys) : [...DEFAULT_KEYS];
  const before: Record<string, Condition> = {};
  for (const r of moveInRooms ?? []) for (const it of r.items) before[it.key] = it.condition;

  let photos: EditorPhoto[] = [];
  let contractStatus: string | null = null;
  if (current) {
    const [{ data: photoRows }, contractRes] = await Promise.all([
      supabase
        .from("rental_inspection_photos")
        .select("id, item_key, storage_path")
        .eq("inspection_id", current.id)
        .eq("tenant_id", tenantId ?? "")
        .eq("status", "verified")
        .order("created_at"),
      current.contract_id ? supabase.from("contracts").select("status").eq("id", current.contract_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    contractStatus = (contractRes.data as { status?: string } | null)?.status ?? null;
    const list = (photoRows ?? []) as { id: string; item_key: string; storage_path: string }[];
    const safe = list.filter((p) => p.storage_path.startsWith(`${tenantId}/`));
    if (safe.length > 0) {
      const { data: signed } = await createAdminClient().storage.from("customer-files").createSignedUrls(safe.map((p) => p.storage_path), 600);
      const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
      photos = safe.map((p) => ({ id: p.id, itemKey: p.item_key, url: byPath.get(p.storage_path) ?? null }));
    }
  }

  const title = property?.title ?? property?.property_code ?? "Kira kaydı";
  return (
    <div className="space-y-5 pb-28 lg:pb-6">
      {back}
      <PageHeader title={KIND_LABELS[kind]} eyebrow={title} description={renter?.full_name ? `Kiracı: ${renter.full_name}` : undefined} />
      <InspectionEditor
        rentalId={id}
        kind={kind}
        inspectionId={current?.id ?? null}
        status={current?.status === "final" ? "final" : "draft"}
        contractId={current?.contract_id ?? null}
        contractStatus={contractStatus}
        initial={{
          inspectedOn: current ? String(current.inspected_on).slice(0, 10) : trDayKey(now()),
          rooms: initialRooms,
          meters: initialMeters,
          keys: initialKeys,
          notes: current?.notes ?? "",
        }}
        before={kind === "move_out" && moveIn ? before : null}
        photos={photos}
        canEdit={canEdit}
        canSign={canSign}
        depositReturned={Boolean(rental.deposit_returned)}
      />
    </div>
  );
}
