"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronsUpDown,
  MessageSquareText,
  UserRound,
} from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SlaState } from "./sla";
import { SlaBadge } from "./sla-badge";
import { TicketRowActions } from "./ticket-row-actions";
import { TicketBulkToolbar } from "./ticket-bulk-toolbar";
import {
  buildTicketListHref,
  shortTicketId,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
  type TicketListFilters,
  type TicketSortDirection,
  type TicketSortKey,
} from "./ticket-list-model";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export type TicketQueueRow = {
  id: string;
  ticketNo: string | null;
  subject: string;
  body: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  tenantId: string | null;
  tenantName: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  messageCount: number;
  sla: SlaState;
};

const statusTone: Record<string, string> = {
  open: "border-brand-500/20 bg-brand-600/[0.07] text-brand-700",
  in_progress: "border-cyan-400/30 bg-cyan-400/10 text-ink-800",
  waiting: "border-amber-400/30 bg-amber-400/12 text-amber-700",
  resolved: "border-mint-500/25 bg-mint-500/10 text-mint-700",
  closed: "border-line bg-canvas text-text-muted",
};

const statusDot: Record<string, string> = {
  open: "bg-brand-500",
  in_progress: "bg-cyan-400",
  waiting: "bg-amber-400",
  resolved: "bg-mint-500",
  closed: "bg-ink-950/30",
};

const priorityTone: Record<string, string> = {
  urgent: "border-danger-500/25 bg-danger-500/[0.08] text-danger-700",
  high: "border-amber-400/35 bg-amber-400/12 text-amber-700",
  normal: "border-brand-500/20 bg-brand-600/[0.07] text-brand-700",
  low: "border-line bg-canvas text-text-muted",
};

function TicketStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-bold", statusTone[status] ?? statusTone.closed)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", statusDot[status] ?? statusDot.closed)} aria-hidden />
      {TICKET_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function TicketPriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn("inline-flex rounded-[7px] border px-2 py-1 text-xs font-bold", priorityTone[priority] ?? priorityTone.low)}>
      {TICKET_PRIORITY_LABEL[priority] ?? priority}
    </span>
  );
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("tr-TR") ?? "")
    .join("");
}

function dt(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function TicketTitle({ row }: { row: TicketQueueRow }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={`/admin/tickets/${row.id}`}
          className="focus-ring rounded-[5px] font-mono text-xs font-bold tracking-[0.04em] text-brand-600 transition hover:text-brand-700 hover:underline"
          aria-label={`${row.subject} destek talebini aç`}
        >
          {row.ticketNo || shortTicketId(row.id)}
        </Link>
        {row.priority === "urgent" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-danger-500/[0.08] px-1.5 py-0.5 text-xs font-bold uppercase tracking-[0.05em] text-danger-600">
            <AlertTriangle className="h-2.5 w-2.5" aria-hidden /> Acil
          </span>
        ) : null}
      </div>
      <Link
        href={`/admin/tickets/${row.id}`}
        className="focus-ring mt-1 block max-w-full rounded-[5px] font-display text-sm font-extrabold leading-snug text-ink-950 transition hover:text-brand-700"
      >
        {row.subject}
      </Link>
      <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-text-faint">
        <span className="max-w-[250px] truncate">{row.body || "Açıklama eklenmedi"}</span>
        <span aria-hidden>·</span>
        <span className="inline-flex shrink-0 items-center gap-1">
          <MessageSquareText className="h-3 w-3" aria-hidden /> {row.messageCount}
          <span className="sr-only">mesaj</span>
        </span>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  column,
  filters,
  hrefFor,
}: {
  label: string;
  column: TicketSortKey;
  filters: TicketListFilters;
  hrefFor: (patch: Partial<Record<keyof TicketListFilters, string | number | null | undefined>>) => string;
}) {
  const active = filters.sirala === column;
  const currentDirection = filters.yon ?? "desc";
  const nextDirection: TicketSortDirection = active && currentDirection === "desc" ? "asc" : "desc";
  const Icon = active ? ChevronDown : ChevronsUpDown;
  return (
    <Link
      href={hrefFor({ sirala: column, yon: nextDirection })}
      className={cn("focus-ring inline-flex items-center gap-1 rounded-[5px] transition hover:text-brand-700", active && "text-brand-700")}
      title={`${label} alanına göre sırala`}
    >
      {label}
      <Icon className={cn("h-3 w-3", active && currentDirection === "asc" && "rotate-180")} aria-hidden />
    </Link>
  );
}

function EmptyQueue({ filtered }: { filtered: boolean }) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-[var(--radius-card)] bg-brand-600/[0.07] text-brand-600">
        <MessageSquareText className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="mt-4 font-display text-base font-extrabold text-ink-950">
        {filtered ? "Bu görünümde talep bulunamadı" : "Destek kuyruğu boş"}
      </h2>
      <p className="mt-1 max-w-md text-sm text-text-muted">
        {filtered
          ? "Arama veya filtreleri değiştirerek diğer destek taleplerini görüntüleyebilirsiniz."
          : "Yeni destek talepleri oluşturulduğunda burada görünecek."}
      </p>
      {filtered ? (
        <ButtonLink href="/admin/tickets" variant="secondary" size="sm" className="mt-4">
          Filtreleri temizle
        </ButtonLink>
      ) : null}
    </div>
  );
}

export function TicketQueueView({
  rows,
  staff,
  statusOptions,
  categoryLabels,
  filters,
  filtered,
}: {
  rows: TicketQueueRow[];
  staff: { id: string; full_name: string }[];
  statusOptions: { value: string; label: string }[];
  categoryLabels: Record<string, string>;
  filters: TicketListFilters;
  filtered: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>();
  // Sayfa/filtre değişince `rows` yeni bir talep kümesi taşır ama bu client
  // bileşeni yeniden mount olmaz — önceki sayfadan kalan seçim, artık ekranda
  // olmayan id'leri işaret edip toplu-işlem çubuğunu yanıltıcı gösterebilirdi.
  // Render sırasında ayarlama (React'ın "adjusting state on prop change" deseni) —
  // ekstra bir commit turu gerektiren useEffect yerine, aynı render'da düzeltilir.
  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    const visible = new Set(rows.map((row) => row.id));
    setSelectedIds((current) => current.filter((id) => visible.has(id)));
  }
  const hrefFor = (patch: Partial<Record<keyof TicketListFilters, string | number | null | undefined>>) =>
    buildTicketListHref(filters, patch);

  if (rows.length === 0) {
    return (
      <section className="surface-card overflow-hidden rounded-[var(--radius-panel)]">
        <EmptyQueue filtered={filtered} />
      </section>
    );
  }

  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));
  const partlySelected = !allSelected && rows.some((row) => selectedIds.includes(row.id));

  function toggleRow(id: string) {
    setNotice(undefined);
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : current.length < 50
          ? [...current, id]
          : current,
    );
  }

  function toggleAll() {
    setNotice(undefined);
    setSelectedIds(allSelected ? [] : rows.slice(0, 50).map((row) => row.id));
  }

  return (
    <>
      {notice ? (
        <div role="status" className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-mint-500/20 bg-mint-500/[0.08] px-4 py-3 text-sm font-semibold text-mint-700">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(undefined)} className="focus-ring rounded-[7px] p-1 text-mint-700/70 transition hover:bg-mint-500/10" aria-label="Bildirimi kapat">
            ×
          </button>
        </div>
      ) : null}

      <section aria-label="Destek kuyruğu" className="surface-card overflow-hidden rounded-[var(--radius-panel)]">
      {/* Geniş ekran: hizalı operasyon tablosu. */}
      <div className="relative hidden max-w-full overflow-x-auto xl:block">
        <Table className="w-full min-w-[1120px] table-fixed text-left text-xs">
          <caption className="sr-only">Seçilebilir destek talepleri; durum, SLA ve personel işlemleri</caption>
          <THead className="border-b border-hairline bg-canvas/75 text-xs font-bold uppercase tracking-[0.06em] text-text-faint">
            <TR>
              <TH scope="col" className="w-[4%] px-3 py-3 text-center">
                <input
                  ref={(node) => {
                    if (node) node.indeterminate = partlySelected;
                  }}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={allSelected ? "Sayfadaki tüm taleplerin seçimini kaldır" : "Sayfadaki tüm talepleri seç"}
                  className="focus-ring h-4 w-4 cursor-pointer rounded border-line-strong accent-[var(--brand-600)]"
                />
              </TH>
              <TH scope="col" className="w-[25%] px-4 py-3">
                <SortHeader label="Talep" column="subject" filters={filters} hrefFor={hrefFor} />
              </TH>
              <TH scope="col" className="w-[13%] px-3 py-3">Ofis</TH>
              <TH scope="col" className="w-[10%] px-3 py-3">Kategori</TH>
              <TH scope="col" className="w-[11%] px-3 py-3">
                <SortHeader label="Oluşturma" column="created_at" filters={filters} hrefFor={hrefFor} />
              </TH>
              <TH scope="col" className="w-[16%] px-3 py-3">
                <SortHeader label="SLA / Durum" column="status" filters={filters} hrefFor={hrefFor} />
              </TH>
              <TH scope="col" className="w-[21%] px-3 py-3">Durum ve atama</TH>
            </TR>
          </THead>
          <TBody className="divide-y divide-hairline">
            {rows.map((row) => (
              <TR
                key={row.id}
                className={cn(
                  "group align-middle transition hover:bg-brand-600/[0.025]",
                  selectedIds.includes(row.id) && "bg-brand-600/[0.045]",
                  row.priority === "urgent" && "shadow-[inset_3px_0_0_0_var(--danger-500)]",
                )}
              >
                <TD className="px-3 py-3.5 text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleRow(row.id)}
                    aria-label={`${row.ticketNo || shortTicketId(row.id)} · ${row.subject} talebini seç`}
                    className="focus-ring h-4 w-4 cursor-pointer rounded border-line-strong accent-[var(--brand-600)]"
                  />
                </TD>
                <TD className="px-4 py-3.5"><TicketTitle row={row} /></TD>
                <TD className="px-3 py-3.5">
                  {row.tenantId ? (
                    <Link href={`/admin/tenants/${row.tenantId}`} className="focus-ring block rounded-[5px] transition hover:text-brand-700">
                      <span className="flex items-center gap-1.5 font-semibold text-ink-950">
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden />
                        <span className="line-clamp-2">{row.tenantName}</span>
                      </span>
                    </Link>
                  ) : (
                    <span className="text-text-muted">{row.tenantName}</span>
                  )}
                </TD>
                <TD className="px-3 py-3.5">
                  <span className="inline-flex rounded-[7px] border border-line bg-canvas px-2 py-1 text-xs font-bold text-ink-950">
                    {categoryLabels[row.category] ?? row.category}
                  </span>
                  <div className="mt-1.5"><TicketPriorityBadge priority={row.priority} /></div>
                </TD>
                <TD className="px-3 py-3.5">
                  <span className="flex items-start gap-1.5 text-xs font-semibold leading-relaxed text-ink-950">
                    <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden />
                    {dt(row.createdAt)}
                  </span>
                  <p className="mt-1 text-xs text-text-faint">Son hareket {dt(row.updatedAt)}</p>
                </TD>
                <TD className="px-3 py-3.5">
                  <div className="flex flex-col items-start gap-1.5">
                    <TicketStatusBadge status={row.status} />
                    <SlaBadge sla={row.sla} />
                    {!row.sla.tracked && row.assignedStaffName ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted">
                        <UserRound className="h-3 w-3" aria-hidden /> {row.assignedStaffName}
                      </span>
                    ) : null}
                  </div>
                </TD>
                <TD className="px-3 py-3.5">
                  <div className="flex flex-col items-stretch gap-2">
                    <TicketRowActions
                      id={row.id}
                      status={row.status}
                      statusOptions={statusOptions}
                      assignedId={row.assignedStaffId}
                      staff={staff}
                    />
                    <ButtonLink href={`/admin/tickets/${row.id}`} variant="ghost" size="xs" iconRight={ArrowUpRight} className="self-end">
                      Konuşmayı aç
                    </ButtonLink>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      {/* Mobil/tablet: semantik, dokunma hedefleri geniş kartlar. */}
      <div className="flex items-center justify-between border-b border-hairline bg-canvas/70 px-4 py-2.5 xl:hidden">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-ink-950">
          <input
            ref={(node) => {
              if (node) node.indeterminate = partlySelected;
            }}
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="focus-ring h-4 w-4 rounded border-line-strong accent-[var(--brand-600)]"
          />
          Sayfadakileri seç
        </label>
        {selectedIds.length > 0 ? <span className="numeric text-xs font-semibold text-brand-700">{selectedIds.length}/50</span> : null}
      </div>
      <ul className="divide-y divide-hairline xl:hidden" role="list">
        {rows.map((row) => (
          <li key={row.id} className={cn("p-4 sm:p-5", selectedIds.includes(row.id) && "bg-brand-600/[0.035]", row.priority === "urgent" && "shadow-[inset_3px_0_0_0_var(--danger-500)]")}>
            <article>
              <div className="flex items-start justify-between gap-3">
                <TicketTitle row={row} />
                <div className="flex shrink-0 items-center gap-2">
                  <TicketPriorityBadge priority={row.priority} />
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleRow(row.id)}
                    aria-label={`${row.ticketNo || shortTicketId(row.id)} · ${row.subject} talebini seç`}
                    className="focus-ring h-5 w-5 cursor-pointer rounded border-line-strong accent-[var(--brand-600)]"
                  />
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <div className="min-w-0">
                  <dt className="text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Ofis</dt>
                  <dd className="mt-1 truncate text-xs font-semibold text-ink-950">{row.tenantName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Kategori</dt>
                  <dd className="mt-1 text-xs font-semibold text-ink-950">{categoryLabels[row.category] ?? row.category}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Oluşturma</dt>
                  <dd className="mt-1 text-xs font-semibold text-ink-950">{dt(row.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-[0.05em] text-text-faint">Atanan</dt>
                  <dd className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-ink-950">
                    {row.assignedStaffName ? (
                      <>
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cyan-400/12 text-xs font-extrabold text-ink-800" aria-hidden>
                          {initials(row.assignedStaffName)}
                        </span>
                        <span className="truncate">{row.assignedStaffName}</span>
                      </>
                    ) : (
                      <span className="text-text-faint">Atanmadı</span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
                <TicketStatusBadge status={row.status} />
                <SlaBadge sla={row.sla} />
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <TicketRowActions
                  id={row.id}
                  status={row.status}
                  statusOptions={statusOptions}
                  assignedId={row.assignedStaffId}
                  staff={staff}
                />
                <ButtonLink href={`/admin/tickets/${row.id}`} variant="secondary" size="sm" iconRight={ArrowUpRight} className="w-full sm:w-auto">
                  Konuşmayı aç
                </ButtonLink>
              </div>
            </article>
          </li>
        ))}
      </ul>
      </section>

      {selectedIds.length > 0 ? (
        <TicketBulkToolbar
          selectedTickets={rows
            .filter((row) => selectedIds.includes(row.id))
            .map((row) => ({ id: row.id, status: row.status }))}
          staff={staff}
          onClear={() => setSelectedIds([])}
          onCompleted={setNotice}
        />
      ) : null}
    </>
  );
}
