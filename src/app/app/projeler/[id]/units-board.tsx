"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, BadgeCheck, Building2, Clock3, KeyRound, LayoutGrid, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { EmptyState } from "@/components/app/empty-state";
import { searchCustomers } from "@/app/actions/lookup";
import { UnitPaymentPlan } from "./unit-payment-plan";
import {
  markUnitDeposit,
  releaseUnit,
  reserveUnit,
  sellUnit,
  type UnitRow,
  type UnitStatus,
} from "@/app/actions/projects";

const STATUS_META: Record<UnitStatus, { label: string; chip: string; dot: string }> = {
  // Görsel dil: müsait = yeşil KONTUR (dolgu değil), rezerve = amber,
  // kapora = cyan, satıldı = soluk/pasif.
  available: {
    label: "Müsait",
    chip: "border-mint-500/60 bg-mint-500/5 text-mint-700 hover:bg-mint-500/12",
    dot: "bg-mint-500",
  },
  reserved: {
    label: "Rezerve",
    chip: "border-amber-400/70 bg-amber-400/12 text-amber-700 hover:bg-amber-400/20",
    dot: "bg-amber-400",
  },
  deposit: {
    label: "Kapora",
    chip: "border-cyan-400/70 bg-cyan-400/10 text-cyan-600 hover:bg-cyan-400/18",
    dot: "bg-cyan-400",
  },
  sold: {
    label: "Satıldı",
    chip: "border-line bg-ink-950/5 text-text-faint opacity-70 hover:opacity-90",
    dot: "bg-text-faint",
  },
};

const GENEL_BLOK = "__genel__";

function rel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function money(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Number(n)) + " ₺";
}

function isExpired(u: UnitRow, now: number) {
  return u.status === "reserved" && !!u.reserved_until && new Date(u.reserved_until).getTime() < now;
}

export function UnitsBoard({
  projectId: _projectId,
  units,
  canEdit,
  canCreate: _canCreate,
}: {
  projectId: string;
  units: UnitRow[];
  canEdit: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [durum, setDurum] = useState<UnitStatus | "all">("all");
  const [blok, setBlok] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [optionDays, setOptionDays] = useState("7");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Render saflığı: Date.now() render içinde çağrılamaz (react-hooks/purity).
  // Mount anındaki zaman yeterli — opsiyon süresi dakika hassasiyeti istemiyor.
  const [now] = useState(() => Date.now());
  const selected = units.find((u) => u.id === selectedId) ?? null;

  const blocks = useMemo(() => {
    const set = new Set(units.map((u) => u.block ?? GENEL_BLOK));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [units]);

  const filtered = units.filter((u) => {
    if (durum !== "all" && u.status !== durum) return false;
    if (blok !== "all" && (u.block ?? GENEL_BLOK) !== blok) return false;
    return true;
  });

  // Blok → kat → daire gruplaması (kat yüksekten alçağa — bina gibi okunsun).
  const grouped = useMemo(() => {
    const byBlock = new Map<string, Map<number | null, UnitRow[]>>();
    for (const u of filtered) {
      const b = u.block ?? GENEL_BLOK;
      if (!byBlock.has(b)) byBlock.set(b, new Map());
      const floors = byBlock.get(b)!;
      const f = u.floor;
      if (!floors.has(f)) floors.set(f, []);
      floors.get(f)!.push(u);
    }
    return Array.from(byBlock.entries())
      .sort(([a], [b]) => a.localeCompare(b, "tr"))
      .map(([blockName, floors]) => ({
        blockName,
        floors: Array.from(floors.entries())
          .sort(([a], [b]) => (b ?? -999) - (a ?? -999))
          .map(([floor, list]) => ({
            floor,
            list: list.sort((a, b) => a.unit_no.localeCompare(b.unit_no, "tr", { numeric: true })),
          })),
      }));
  }, [filtered]);

  const expiredCount = units.filter((u) => isExpired(u, now)).length;

  const counts: Record<UnitStatus, number> = {
    available: units.filter((u) => u.status === "available").length,
    reserved: units.filter((u) => u.status === "reserved").length,
    deposit: units.filter((u) => u.status === "deposit").length,
    sold: units.filter((u) => u.status === "sold").length,
  };

  const openUnit = (id: string) => {
    setSelectedId(id);
    setCustomerId("");
    setOptionDays("7");
    setError(null);
  };

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, closeOnSuccess = true) => {
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      if (closeOnSuccess) setSelectedId(null);
      router.refresh();
    });
  };

  const selectedCustomer = selected ? rel(selected.customer) : null;
  const sellCustomerReady = Boolean(selected && (selected.customer_id || customerId));

  return (
    <section className="space-y-4">
      {expiredCount > 0 ? (
        <div className="flex items-center gap-2 rounded-[14px] border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {expiredCount} dairenin rezervasyon opsiyon süresi doldu — satışa çevirin ya da serbest bırakın.
        </div>
      ) : null}

      {/* Filtre çipleri: durum + blok */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", `Tümü (${units.length})`],
            ["available", `Müsait (${counts.available})`],
            ["reserved", `Rezerve (${counts.reserved})`],
            ["deposit", `Kapora (${counts.deposit})`],
            ["sold", `Satıldı (${counts.sold})`],
          ] as [UnitStatus | "all", string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setDurum(value)}
            className={`focus-ring press rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              durum === value
                ? "bg-brand-600 text-white"
                : "border border-line bg-surface text-text-muted hover:border-brand-300 hover:text-ink-950"
            }`}
          >
            {label}
          </button>
        ))}

        {blocks.length > 1 ? (
          <>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <button
              type="button"
              onClick={() => setBlok("all")}
              className={`focus-ring press rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                blok === "all"
                  ? "bg-ink-950 text-white"
                  : "border border-line bg-surface text-text-muted hover:border-brand-300 hover:text-ink-950"
              }`}
            >
              Tüm bloklar
            </button>
            {blocks.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBlok(b)}
                className={`focus-ring press rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  blok === b
                    ? "bg-ink-950 text-white"
                    : "border border-line bg-surface text-text-muted hover:border-brand-300 hover:text-ink-950"
                }`}
              >
                {b === GENEL_BLOK ? "Bloksuz" : `${b} Blok`}
              </button>
            ))}
          </>
        ) : null}
      </div>

      {units.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="Henüz daire eklenmedi"
          description={'Sağ üstteki "Daire ekle" ile tekil daire girin ya da "Çoğalt" sekmesiyle kat kat üretin.'}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="Filtreye uyan daire yok"
          description="Durum ya da blok filtresini değiştirip tekrar deneyin."
          tone="amber"
        />
      ) : (
        <div className="space-y-5">
          {grouped.map(({ blockName, floors }) => (
            <div key={blockName} className="rounded-[20px] border border-line bg-surface p-5">
              <h3 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
                <Building2 className="h-4 w-4 text-brand-600" />
                {blockName === GENEL_BLOK ? "Blok belirtilmemiş" : `${blockName} Blok`}
              </h3>
              <div className="mt-4 space-y-2.5">
                {floors.map(({ floor, list }) => (
                  <div key={floor ?? "x"} className="flex items-start gap-3">
                    <span className="numeric mt-1.5 w-14 shrink-0 text-right text-[11px] font-bold text-text-faint">
                      {floor == null ? "Kat —" : floor === 0 ? "Zemin" : `Kat ${floor}`}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((u) => {
                        const meta = STATUS_META[u.status];
                        const expired = isExpired(u, now);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => openUnit(u.id)}
                            title={`Daire ${u.unit_no} — ${meta.label}${expired ? " (opsiyon doldu)" : ""}`}
                            className={`focus-ring press relative rounded-[10px] border px-2.5 py-1.5 text-left transition ${meta.chip} ${
                              expired ? "ring-2 ring-amber-400/70" : ""
                            }`}
                          >
                            <span className="numeric block text-xs font-bold">{u.unit_no}</span>
                            <span className="block text-[10px] opacity-80">{u.rooms ?? "—"}</span>
                            {expired ? (
                              <span
                                className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-amber-400 text-white"
                                aria-label="Opsiyon süresi doldu"
                              >
                                <AlertTriangle className="h-2.5 w-2.5" />
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Durum açıklaması (legend) */}
      <div className="flex flex-wrap items-center gap-4 text-[11px] font-semibold text-text-muted">
        {(Object.keys(STATUS_META) as UnitStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${STATUS_META[s].dot}`} />
            {STATUS_META[s].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 text-amber-600" /> Opsiyon süresi doldu
        </span>
      </div>

      {/* Daire detay + durum akışı */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent size="md">
          {selected ? (
            <>
              <DialogHeader
                icon={<LayoutGrid />}
                title={`${selected.block ? `${selected.block} Blok — ` : ""}Daire ${selected.unit_no}`}
                description={`${STATUS_META[selected.status].label}${
                  isExpired(selected, now) ? " — opsiyon süresi doldu" : ""
                }`}
              />
              <div className="space-y-4 p-6">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-[14px] border border-line bg-canvas p-4 text-sm">
                  <dt className="text-text-muted">Kat</dt>
                  <dd className="text-right font-semibold text-ink-950">
                    {selected.floor == null ? "—" : selected.floor === 0 ? "Zemin" : selected.floor}
                  </dd>
                  <dt className="text-text-muted">Oda</dt>
                  <dd className="text-right font-semibold text-ink-950">{selected.rooms ?? "—"}</dd>
                  <dt className="text-text-muted">Brüt m²</dt>
                  <dd className="numeric text-right font-semibold text-ink-950">{selected.gross_m2 ?? "—"}</dd>
                  <dt className="text-text-muted">Liste fiyatı</dt>
                  <dd className="numeric text-right font-semibold text-ink-950">{money(selected.list_price)}</dd>
                  {selectedCustomer ? (
                    <>
                      <dt className="text-text-muted">Müşteri</dt>
                      <dd className="text-right">
                        <Link
                          href={`/app/musteriler/${selectedCustomer.id}`}
                          className="focus-ring inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline"
                        >
                          {selectedCustomer.full_name ?? "İsimsiz"}
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </dd>
                    </>
                  ) : null}
                  {selected.status === "reserved" && selected.reserved_until ? (
                    <>
                      <dt className="text-text-muted">Opsiyon bitişi</dt>
                      <dd
                        className={`text-right font-semibold ${
                          isExpired(selected, now) ? "text-amber-600" : "text-ink-950"
                        }`}
                      >
                        {new Date(selected.reserved_until).toLocaleDateString("tr-TR", {
                          day: "2-digit",
                          month: "long",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </dd>
                    </>
                  ) : null}
                  {selected.sold_at ? (
                    <>
                      <dt className="text-text-muted">Satış tarihi</dt>
                      <dd className="text-right font-semibold text-ink-950">
                        {new Date(selected.sold_at).toLocaleDateString("tr-TR", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                        })}
                      </dd>
                    </>
                  ) : null}
                  {selected.notes ? (
                    <>
                      <dt className="text-text-muted">Not</dt>
                      <dd className="text-right text-ink-950">{selected.notes}</dd>
                    </>
                  ) : null}
                </dl>

                {/* Ödeme planı — yalnızca kaporalı/satılan dairede anlamlı */}
                {selected.status === "deposit" || selected.status === "sold" ? (
                  <UnitPaymentPlan
                    key={selected.id}
                    unitId={selected.id}
                    listPrice={selected.list_price}
                    canEdit={canEdit}
                  />
                ) : null}

                {canEdit && selected.status !== "sold" && !selected.customer_id ? (
                  <div className="space-y-3">
                    <div>
                      <span className="mb-1.5 block text-xs font-semibold text-ink-950">Müşteri</span>
                      <Combobox
                        aria-label="Müşteri"
                        value={customerId}
                        onValueChange={setCustomerId}
                        options={[] as ComboboxOption[]}
                        onSearch={searchCustomers}
                        placeholder="Müşteri ara ve seçin"
                        searchPlaceholder="Ad, telefon ya da e-posta…"
                        emptyText="Eşleşen müşteri yok"
                      />
                    </div>
                    <div>
                      <span className="mb-1.5 block text-xs font-semibold text-ink-950">Opsiyon süresi</span>
                      <Select value={optionDays} onValueChange={setOptionDays}>
                        <SelectTrigger aria-label="Opsiyon süresi" placeholder="Süre" />
                        <SelectContent>
                          <SelectItem value="3">3 gün</SelectItem>
                          <SelectItem value="7">7 gün</SelectItem>
                          <SelectItem value="14">14 gün</SelectItem>
                          <SelectItem value="30">30 gün</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
                    {error}
                  </p>
                ) : null}

                {canEdit ? (
                  <div className="hairline-t flex flex-wrap justify-end gap-2 pt-4">
                    {selected.status === "available" ? (
                      <Button
                        loading={pending}
                        disabled={!customerId}
                        onClick={() => run(() => reserveUnit(selected.id, customerId, parseInt(optionDays, 10)))}
                      >
                        <Clock3 className="h-4 w-4" /> Rezerve et
                      </Button>
                    ) : null}

                    {selected.status !== "sold" && selected.status !== "deposit" ? (
                      <Button
                        variant="secondary"
                        loading={pending}
                        disabled={!sellCustomerReady}
                        onClick={() => run(() => markUnitDeposit(selected.id, customerId || undefined))}
                      >
                        <KeyRound className="h-4 w-4" /> Kapora alındı
                      </Button>
                    ) : null}

                    {selected.status !== "sold" ? (
                      <ConfirmDialog
                        tone="default"
                        title={`Daire ${selected.unit_no} satıldı olarak işaretlensin mi?`}
                        description={
                          sellCustomerReady
                            ? "Satış tarihi bugün olarak kaydedilir; işlem denetim kaydına yazılır."
                            : "Önce müşteri seçmelisiniz."
                        }
                        confirmLabel="Satıldı işaretle"
                        onConfirm={
                          sellCustomerReady
                            ? async () => {
                                const res = await sellUnit(selected.id, customerId || undefined);
                                if (res.error) setError(res.error);
                                else {
                                  setError(null);
                                  setSelectedId(null);
                                  router.refresh();
                                }
                              }
                            : undefined
                        }
                        trigger={
                          <Button disabled={!sellCustomerReady} loading={pending}>
                            <BadgeCheck className="h-4 w-4" /> Satıldı
                          </Button>
                        }
                      />
                    ) : null}

                    {selected.status !== "available" ? (
                      selected.status === "sold" ? (
                        <ConfirmDialog
                          title={`Daire ${selected.unit_no} serbest bırakılsın mı?`}
                          description="Satış kaydı geri alınır; daire yeniden müsait olur. Bu işlem denetim kaydına yazılır."
                          confirmLabel="Serbest bırak"
                          onConfirm={async () => {
                            const res = await releaseUnit(selected.id);
                            if (res.error) setError(res.error);
                            else {
                              setError(null);
                              setSelectedId(null);
                              router.refresh();
                            }
                          }}
                          trigger={
                            <Button variant="secondary" loading={pending}>
                              <Undo2 className="h-4 w-4" /> Serbest bırak
                            </Button>
                          }
                        />
                      ) : (
                        <Button variant="secondary" loading={pending} onClick={() => run(() => releaseUnit(selected.id))}>
                          <Undo2 className="h-4 w-4" /> Serbest bırak
                        </Button>
                      )
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
