"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Pencil, Plus, Power, Users } from "lucide-react";
import { createBuilding, updateBuilding, archiveBuilding, saveBuildingUnit, createUnitsBulk, setUnitActive } from "@/app/actions/building-management";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import type { GeoOption } from "@/app/actions/geo";
import { GeoSelect } from "@/components/app/geo-select";
import { useToast } from "@/components/app/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DISTRIBUTION_LABELS, DISTRIBUTION_METHODS } from "@/lib/building-management/distribution";
import { PAYER_LABELS } from "@/lib/building-management/charges";
import type { BuildingRow, UnitRow } from "@/lib/building-management/load";

const num = (n: number | null, digits = 2) => (n == null ? "—" : new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(n));

export type RentalOption = { value: string; label: string };

/** Bina / site oluşturma ve düzenleme formu. */
export function BuildingForm({ building, canSave, canArchive, provinces }: { building?: BuildingRow; canSave: boolean; canArchive?: boolean; provinces: GeoOption[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!building);
  const [managed, setManaged] = useState(building?.managedByOffice ?? true);
  const [feeType, setFeeType] = useState<string>(building?.feeType ?? "");
  const [confirmArchive, setConfirmArchive] = useState(false);

  function submit(fd: FormData) {
    setError(null);
    const payload = Object.fromEntries(fd.entries()) as Record<string, unknown>;
    payload.managedByOffice = managed;
    payload.feeType = managed ? feeType : "";
    startTransition(async () => {
      const res = building ? await updateBuilding(building.id, payload) : await createBuilding(payload);
      if (res.error) {
        setError(res.error);
        return;
      }
      push(building ? "Bina güncellendi" : "Bina oluşturuldu", "ok");
      if (!building && res.id) router.push(`/app/aidat?sekme=binalar&bina=${res.id}&bolum=daireler`);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (!canSave) return null;
  if (!open && building) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" icon={Pencil} onClick={() => setOpen(true)}>Bina bilgilerini düzenle</Button>
        {canArchive ? <Button size="sm" variant="ghost" onClick={() => setConfirmArchive(true)}>Arşivle</Button> : null}
        <ConfirmDialog
          open={confirmArchive}
          onOpenChange={setConfirmArchive}
          title="Binayı arşivle"
          description="Bina listeden kalkar; geçmiş tahakkuk ve tahsilat kayıtları korunur. Ödenmemiş tahakkuk varsa arşivlenemez."
          confirmLabel="Arşivle"
          onConfirm={async () => {
            const res = await archiveBuilding(building.id);
            if (res.error) push(res.error, "err");
            else {
              push("Bina arşivlendi", "ok");
              router.push("/app/aidat?sekme=binalar");
            }
          }}
        />
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]" aria-label={building ? "Bina düzenleme formu" : "Yeni bina formu"}>
      <h3 className="flex items-center gap-2 font-display font-bold text-ink-950"><Building2 className="h-4 w-4 text-brand-600" /> {building ? "Bina bilgileri" : "Yeni bina / site"}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Bina / site adı" htmlFor="b-name" required>
          <FormInput id="b-name" name="name" required maxLength={120} defaultValue={building?.name} />
        </FormField>
        <FormField label="Adres" htmlFor="b-address">
          <FormInput id="b-address" name="address" maxLength={300} defaultValue={building?.address ?? ""} />
        </FormField>
        <div className="sm:col-span-2">
          <GeoSelect provinces={provinces} defaultProvinceId={building?.provinceId} defaultDistrictId={building?.districtId} withNeighborhood={false} />
        </div>
        <FormField label="Aidat vade günü" htmlFor="b-due" hint="Her ayın kaçıncı günü (1-28).">
          <FormInput id="b-due" name="dueDay" type="number" min={1} max={28} defaultValue={building?.dueDay ?? 5} required />
        </FormField>
        <FormField label="Varsayılan dağıtım yöntemi" htmlFor="b-dist">
          <FormSelect id="b-dist" name="defaultDistribution" defaultValue={building?.defaultDistribution ?? "equal"}>
            {DISTRIBUTION_METHODS.map((m) => <option key={m} value={m}>{DISTRIBUTION_LABELS[m]}</option>)}
          </FormSelect>
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-ink-950">
        <input type="checkbox" checked={managed} onChange={(e) => setManaged(e.target.checked)} className="h-4 w-4 accent-[var(--brand-600)]" />
        Bu binayı ofisimiz yönetiyor (yönetim ücreti alınır)
      </label>
      {managed ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Yönetim ücreti türü" htmlFor="b-feetype">
            <FormSelect id="b-feetype" value={feeType} onChange={(e) => setFeeType(e.target.value)}>
              <option value="">Ücret alınmıyor</option>
              <option value="percent">Tahsilatın yüzdesi (%)</option>
              <option value="fixed">Daire başına aylık sabit (₺)</option>
            </FormSelect>
          </FormField>
          {feeType ? (
            <FormField label={feeType === "percent" ? "Oran (%)" : "Tutar (₺ / daire / ay)"} htmlFor="b-feeval" required>
              <FormInput id="b-feeval" name="feeValue" inputMode="decimal" required defaultValue={building?.feeValue != null ? String(building.feeValue).replace(".", ",") : ""} />
            </FormField>
          ) : null}
        </div>
      ) : null}
      <FormField label="Not" htmlFor="b-notes">
        <FormTextarea id="b-notes" name="notes" rows={2} maxLength={1000} defaultValue={building?.notes ?? ""} />
      </FormField>
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={pending}>{building ? "Kaydet" : "Binayı oluştur"}</Button>
        {building ? <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button> : null}
      </div>
    </form>
  );
}

/** Daire listesi + tek daire formu + numara aralığından toplu ekleme. */
export function UnitsPanel({
  buildingId,
  units,
  rentals,
  canCreate,
  canEdit,
}: {
  buildingId: string;
  units: UnitRow[];
  rentals: RentalOption[];
  canCreate: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UnitRow | "new" | null>(null);
  const [payer, setPayer] = useState<"owner" | "tenant">("owner");
  const [showBulk, setShowBulk] = useState(false);

  function startEdit(u: UnitRow | "new") {
    setEditing(u);
    setPayer(u === "new" ? "owner" : u.payer);
    setError(null);
  }

  function submitUnit(fd: FormData) {
    setError(null);
    const payload = Object.fromEntries(fd.entries()) as Record<string, unknown>;
    payload.buildingId = buildingId;
    payload.payer = payer;
    if (editing && editing !== "new") payload.id = editing.id;
    startTransition(async () => {
      const res = await saveBuildingUnit(payload as Parameters<typeof saveBuildingUnit>[0]);
      if (res.error) {
        setError(res.error);
        return;
      }
      push("Daire kaydedildi", "ok");
      setEditing(null);
      router.refresh();
    });
  }

  function submitBulk(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await createUnitsBulk({ buildingId, from: String(fd.get("from") ?? ""), to: String(fd.get("to") ?? ""), block: String(fd.get("block") ?? "") });
      if (res.error) {
        setError(res.error);
        return;
      }
      push(res.count ? `${res.count} daire eklendi` : (res.info ?? "Eklenecek yeni daire yok"), "ok");
      setShowBulk(false);
      router.refresh();
    });
  }

  function toggleActive(u: UnitRow) {
    startTransition(async () => {
      const res = await setUnitActive(u.id, !u.active);
      if (res.error) push(res.error, "err");
      else router.refresh();
    });
  }

  const current = editing && editing !== "new" ? editing : null;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display font-bold text-ink-950"><Users className="h-4 w-4 text-brand-600" /> Daireler <span className="text-xs font-normal text-text-faint">{units.length}</span></h3>
        {canCreate ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" icon={Plus} onClick={() => { setShowBulk(!showBulk); setEditing(null); setError(null); }}>Toplu ekle (1-12)</Button>
            <Button size="sm" icon={Plus} onClick={() => startEdit("new")}>Daire ekle</Button>
          </div>
        ) : null}
      </div>

      {showBulk ? (
        <form action={submitBulk} className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:grid-cols-4" aria-label="Toplu daire ekleme">
          <FormField label="Blok (isteğe bağlı)" htmlFor="bulk-block"><FormInput id="bulk-block" name="block" maxLength={20} placeholder="A Blok" /></FormField>
          <FormField label="İlk daire no" htmlFor="bulk-from" required><FormInput id="bulk-from" name="from" type="number" min={0} required defaultValue={1} /></FormField>
          <FormField label="Son daire no" htmlFor="bulk-to" required><FormInput id="bulk-to" name="to" type="number" min={0} required defaultValue={12} /></FormField>
          <div className="flex items-end"><Button type="submit" size="sm" loading={pending}>Daireleri ekle</Button></div>
          <div className="sm:col-span-4"><FormError error={error} /></div>
        </form>
      ) : null}

      {editing ? (
        <form key={current?.id ?? "new"} action={submitUnit} className="space-y-3 rounded-[var(--radius-card)] border border-brand-300/50 bg-surface p-4" aria-label="Daire formu">
          <div className="grid gap-3 sm:grid-cols-4">
            <FormField label="Blok" htmlFor="u-block"><FormInput id="u-block" name="block" maxLength={20} defaultValue={current?.block ?? ""} /></FormField>
            <FormField label="Kat" htmlFor="u-floor"><FormInput id="u-floor" name="floor" type="number" min={-10} max={200} defaultValue={current?.floor ?? ""} /></FormField>
            <FormField label="Daire no" htmlFor="u-no" required><FormInput id="u-no" name="unitNo" required maxLength={20} defaultValue={current?.unitNo ?? ""} /></FormField>
            <FormField label="Brüt m²" htmlFor="u-area"><FormInput id="u-area" name="areaM2" inputMode="decimal" defaultValue={current?.areaM2 != null ? String(current.areaM2).replace(".", ",") : ""} /></FormField>
            <FormField label="Arsa payı" htmlFor="u-land" hint="Tapudaki pay (ör. 12,5 ya da 125)."><FormInput id="u-land" name="landShare" inputMode="decimal" defaultValue={current?.landShare != null ? String(current.landShare).replace(".", ",") : ""} /></FormField>
            <FormField label="Sabit aidat (₺)" htmlFor="u-fixed" hint="Yalnız 'Sabit tutar' yönteminde kullanılır."><FormInput id="u-fixed" name="fixedAmount" inputMode="decimal" defaultValue={current?.fixedAmount != null ? String(current.fixedAmount).replace(".", ",") : ""} /></FormField>
            <FormField label="Aidatı kim öder?" htmlFor="u-payer">
              <FormSelect id="u-payer" value={payer} onChange={(e) => setPayer(e.target.value as "owner" | "tenant")}>
                <option value="owner">{PAYER_LABELS.owner}</option>
                <option value="tenant">{PAYER_LABELS.tenant}</option>
              </FormSelect>
            </FormField>
            <FormField label="Not" htmlFor="u-notes"><FormInput id="u-notes" name="notes" maxLength={500} defaultValue="" /></FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Malik (müşteri)" htmlFor="u-owner" inject={false}>
              <Combobox id="u-owner" name="ownerCustomerId" aria-label="Malik" placeholder="Malik seçin" searchPlaceholder="Ad ya da telefon ara…" emptyText="Eşleşen müşteri yok" onSearch={searchCustomers}
                defaultValue={current?.ownerCustomerId ?? ""} options={current?.ownerCustomerId ? [{ value: current.ownerCustomerId, label: current.ownerName ?? "Malik" }] : []} />
            </FormField>
            <FormField label="Kiracı (müşteri)" htmlFor="u-renter" inject={false}>
              <Combobox id="u-renter" name="tenantCustomerId" aria-label="Kiracı" placeholder="Kiracı seçin" searchPlaceholder="Ad ya da telefon ara…" emptyText="Eşleşen müşteri yok" onSearch={searchCustomers}
                defaultValue={current?.tenantCustomerId ?? ""} options={current?.tenantCustomerId ? [{ value: current.tenantCustomerId, label: current.tenantName ?? "Kiracı" }] : []} />
            </FormField>
            <FormField label="Bağlı kira (isteğe bağlı)" htmlFor="u-rental" hint="Malik aidat borcunu kira hakedişinden mahsup etmek için." inject={false}>
              <Combobox id="u-rental" name="rentalId" aria-label="Bağlı kira" placeholder="Kira seçin" searchPlaceholder="Portföy ya da kiracı ara…" emptyText="Eşleşen kira yok"
                defaultValue={current?.rentalId ?? ""} options={rentals} />
            </FormField>
            <FormField label="Portföy bağı (isteğe bağlı)" htmlFor="u-prop" inject={false}>
              <Combobox id="u-prop" name="propertyId" aria-label="Portföy" placeholder="Portföy seçin" searchPlaceholder="Kod ya da başlık ara…" emptyText="Eşleşen portföy yok" onSearch={searchProperties}
                defaultValue={current?.propertyId ?? ""} options={current?.propertyId ? [{ value: current.propertyId, label: current.propertyLabel ?? "Portföy" }] : []} />
            </FormField>
          </div>
          <FormError error={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={pending}>Kaydet</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Vazgeç</Button>
          </div>
        </form>
      ) : null}

      {units.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong p-6 text-center text-sm text-text-muted">
          Henüz daire yok. “Toplu ekle” ile 1-12 gibi bir aralığı tek seferde ekleyebilir, sonra m²/arsa payı ve malik bilgilerini girebilirsiniz.
        </p>
      ) : (
        <TableFrame minWidth={820}>
          <Table>
            <THead>
              <TR>
                <TH>Daire</TH><TH>Kat</TH><TH align="right">m²</TH><TH align="right">Arsa payı</TH><TH>Malik</TH><TH>Kiracı</TH><TH>Ödeyen</TH><TH align="right">İşlem</TH>
              </TR>
            </THead>
            <TBody>
              {units.map((u) => (
                <TR key={u.id}>
                  <TD><span className="font-semibold text-ink-950">{u.label}</span>{!u.active ? <Badge variant="outline" size="sm" className="ml-2">Pasif</Badge> : null}</TD>
                  <TD>{u.floor ?? "—"}</TD>
                  <TD align="right">{num(u.areaM2)}</TD>
                  <TD align="right">{num(u.landShare, 4)}</TD>
                  <TD>{u.ownerName ?? "—"}</TD>
                  <TD>{u.tenantName ?? "—"}</TD>
                  <TD>{PAYER_LABELS[u.payer]}</TD>
                  <TD align="right">
                    {canEdit ? (
                      <span className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => startEdit(u)} aria-label={`${u.label} düzenle`}>Düzenle</Button>
                        <Button size="sm" variant="ghost" icon={Power} onClick={() => toggleActive(u)} loading={pending}>{u.active ? "Pasifleştir" : "Etkinleştir"}</Button>
                      </span>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableFrame>
      )}
    </section>
  );
}
