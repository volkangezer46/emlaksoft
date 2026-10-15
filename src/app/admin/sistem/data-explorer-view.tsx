import { ArrowLeft, ArrowUpRight, EyeOff, Filter, Lock, SearchX, ShieldAlert, Table2, X } from "lucide-react";
// Gezgin içi bağlantıların HEPSİ `prefetch={false}`: SmartLink hover/odakta tam sunucu render'ı ısıtır, bu da açılmamış
// liste/kayıt için `data_explorer.*` denetim satırı yazar ve maskeli veriyi istemciye taşır (KVKK kanıtı yanlış pozitifsiz kalmalı).
import Link from "@/components/ui/smart-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@/components/ui/form-controls";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/app/admin/_components/pagination";
import { requirePlatformModule } from "@/lib/platform";
import {
  EXPLORER_BASE,
  EXPLORER_MAX_ROWS,
  EXPLORER_PAGE_SIZE,
  explorerHref,
  filterParam,
  parseExplorerParams,
  planHrefInput,
  type ExplorerParams,
  type ExplorerPlan,
} from "@/lib/admin/data-explorer/plan";
import { EXPLORER_TABLES, filterColumns, listColumns, type ExplorerColumn } from "@/lib/admin/data-explorer/registry";
import { MASK_LABELS } from "@/lib/admin/data-explorer/mask";
import { readExplorerList, readExplorerRecord, type ExplorerDisplayRow } from "@/lib/admin/data-explorer/read";

/**
 * Sistem > Veri gezgini (SN4): izinli tablolarda SALT OKUNUR arama. Kapı `veri` modülü (varsayılan yalnız süper admin;
 * başka personel yalnız özel rolle). Yazma, ham SQL ve dışa aktarma yok (dosya çıktısı yalnız Rapor merkezinde).
 * Süzgeçler URL'dedir (GET formu; sunucu süzgeci + gerçek sayfalama). Her liste/kayıt görüntülemesi denetim izine
 * yazılır; iz yazılamazsa veri gösterilmez (`read.ts`).
 */
export async function DataExplorerView({ params }: { params: ExplorerParams }) {
  const staff = await requirePlatformModule("veri");
  const plan = parseExplorerParams(params);

  const header = (
    <AdminPageHeader
      eyebrow="Operasyon"
      icon={Table2}
      title="Veri gezgini"
      description="İzinli tablolarda salt okunur arama. Kişisel veriler maskeli, sır sütunları hiç seçilmez; her görüntüleme denetim izine yazılır."
    />
  );

  if (!plan) {
    return (
      <div className="space-y-6">
        {header}
        <TablePicker />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <TableSwitcher current={plan.table.key} />
      {plan.recordId ? <RecordDetail plan={plan} actorId={staff.id} /> : <ListView plan={plan} actorId={staff.id} />}
    </div>
  );
}

function TablePicker() {
  return (
    <section aria-label="İzinli tablolar" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {EXPLORER_TABLES.map((t) => {
        const masked = t.columns.filter((c) => c.mask).length;
        return (
          <Link
            key={t.key}
            href={explorerHref({ table: t.key })}
            prefetch={false}
            className="focus-ring press group rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-brand-400"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-display font-bold text-ink-950">{t.label}</span>
              <ArrowUpRight className="h-4 w-4 text-text-faint transition group-hover:text-brand-600" aria-hidden />
            </span>
            <span className="mt-1 block text-xs text-text-muted">{t.description}</span>
            <span className="mt-3 flex flex-wrap gap-1.5">
              <Badge size="sm" variant="outline">
                {t.columns.length} sütun
              </Badge>
              {masked > 0 ? (
                <Badge size="sm" variant="info">
                  {masked} maskeli
                </Badge>
              ) : null}
              {t.secretColumns.length > 0 ? (
                <Badge size="sm" variant="neutral">
                  {t.secretColumns.length} sütun seçilmez
                </Badge>
              ) : null}
            </span>
          </Link>
        );
      })}
    </section>
  );
}

function TableSwitcher({ current }: { current: string }) {
  return (
    <nav aria-label="Tablo seçimi" className="flex flex-wrap gap-1.5">
      <Link href={EXPLORER_BASE} prefetch={false} className="focus-ring press inline-flex touch:min-h-11 items-center gap-1 rounded-full border border-line px-3 py-1 text-xs font-semibold text-text-muted hover:border-brand-400">
        Tüm tablolar
      </Link>
      {EXPLORER_TABLES.map((t) => (
        <Link
          key={t.key}
          href={explorerHref({ table: t.key })}
          prefetch={false}
          aria-current={t.key === current ? "page" : undefined}
          className={`focus-ring press inline-flex touch:min-h-11 items-center rounded-full px-3 py-1 text-xs font-semibold ${
            t.key === current ? "bg-brand-600 text-white" : "border border-line text-ink-950 hover:border-brand-400"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

function Notice({ icon: Icon, title, text }: { icon: typeof ShieldAlert; title: string; text: string }) {
  return (
    <section role="status" className="rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <Icon className="mx-auto h-8 w-8 text-amber-600" aria-hidden />
      <h2 className="mt-3 font-display text-lg font-bold text-ink-950">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-text-muted">{text}</p>
    </section>
  );
}

const AUDIT_FAILED = {
  icon: ShieldAlert,
  title: "Denetim izi yazılamadı",
  text: "Her görüntüleme denetim izine yazılmak zorunda; iz yazılamadığı için kayıtlar gösterilmiyor. Birkaç dakika sonra yeniden deneyin.",
};
const READ_FAILED = { icon: ShieldAlert, title: "Kayıtlar okunamadı", text: "Bağlantı ya da yetki hatası; birkaç dakika sonra yeniden deneyin." };

function FilterField({ col, value }: { col: ExplorerColumn; value: string }) {
  const name = filterParam(col.key);
  const label = <span className="mb-1 block text-xs font-semibold text-text-muted">{col.label}</span>;
  if (col.filter === "bool") {
    return (
      <label className="block">
        {label}
        <FormSelect name={name} defaultValue={value}>
          <option value="">Tümü</option>
          <option value="evet">Evet</option>
          <option value="hayir">Hayır</option>
        </FormSelect>
      </label>
    );
  }
  if (col.options) {
    return (
      <label className="block">
        {label}
        <FormSelect name={name} defaultValue={value}>
          <option value="">Tümü</option>
          {col.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </FormSelect>
      </label>
    );
  }
  return (
    <label className="block">
      {label}
      <Input
        type={col.filter === "search" ? "search" : "text"}
        name={name}
        defaultValue={value}
        maxLength={80}
        placeholder={col.kind === "uuid" ? "Kayıt kimliği (uuid)" : col.filter === "search" ? "İçerir…" : "Tam değer"}
      />
    </label>
  );
}

function FilterForm({ plan, officeValue }: { plan: ExplorerPlan; officeValue: string }) {
  const t = plan.table;
  const cols = filterColumns(t);
  const values = new Map(plan.filters.map((f) => [f.column, typeof f.value === "boolean" ? (f.value ? "evet" : "hayir") : f.value]));
  const dateLabel = t.columns.find((c) => c.key === t.orderBy)?.label ?? "Tarih";
  const active = plan.filters.length > 0 || Boolean(officeValue || plan.from || plan.to);
  return (
    <form action="/admin/sistem" role="search" className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <input type="hidden" name="sekme" value="veri" />
      <input type="hidden" name="tablo" value={t.key} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {t.tenantColumn ? (
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-text-muted">Ofis (kimlik ya da kısa ad)</span>
            <Input type="text" name="ofis" defaultValue={officeValue} maxLength={64} placeholder="ör. demo-ofis" />
          </label>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-text-muted">{dateLabel}: başlangıç</span>
          <Input type="date" name="bas" defaultValue={plan.from ?? ""} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-text-muted">{dateLabel}: bitiş</span>
          <Input type="date" name="bit" defaultValue={plan.to ?? ""} />
        </label>
      </div>
      {cols.length > 0 ? (
        <details open={plan.filters.length > 0} className="group">
          <summary className="focus-ring inline-flex cursor-pointer touch:min-h-11 items-center gap-1.5 text-xs font-semibold text-brand-600">
            <Filter className="h-3.5 w-3.5" aria-hidden /> Sütun süzgeçleri ({cols.length})
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cols.map((c) => (
              <FilterField key={c.key} col={c} value={values.get(c.key) ?? ""} />
            ))}
          </div>
          <p className="mt-2 text-xs text-text-faint">Maskeli sütunlarda süzgeç yoktur: kişisel veriyle arama yapılamaz.</p>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="navy" size="sm" type="submit">
          Uygula
        </Button>
        {active ? (
          <ButtonLink variant="outline" size="sm" href={explorerHref({ table: t.key })} prefetch={false}>
            <X className="h-3.5 w-3.5" aria-hidden /> Süzgeçleri temizle
          </ButtonLink>
        ) : null}
      </div>
    </form>
  );
}

function OfficeCell({ row, names, hrefFor }: { row: ExplorerDisplayRow; names: Record<string, string>; hrefFor: (officeId: string) => string }) {
  if (!row.tenantId) return <span className="text-text-faint">—</span>;
  return (
    <Link href={hrefFor(row.tenantId)} prefetch={false} className="focus-ring font-semibold text-brand-600 hover:underline" title="Bu ofise süz">
      {names[row.tenantId] ?? row.tenantId.slice(0, 8)}
    </Link>
  );
}

function Cell({ col, value }: { col: ExplorerColumn; value: string | null }) {
  if (value === null) return <span className="text-text-faint">—</span>;
  if (col.mask) {
    return (
      <span className="inline-flex items-center gap-1 text-text-muted" title={`Maskeli: ${MASK_LABELS[col.mask]}`}>
        <EyeOff className="h-3 w-3 shrink-0" aria-hidden />
        {value}
      </span>
    );
  }
  return <span className={col.kind === "uuid" ? "numeric text-text-muted" : "text-ink-950"}>{col.kind === "uuid" ? value.slice(0, 8) : value}</span>;
}

async function ListView({ plan, actorId }: { plan: ExplorerPlan; actorId: string }) {
  const res = await readExplorerList(plan, actorId);
  const rawOffice = plan.office ? ("id" in plan.office ? plan.office.id : plan.office.slug) : "";

  if (res.kind !== "ok") {
    return (
      <div className="space-y-4">
        <FilterForm plan={plan} officeValue={rawOffice} />
        {res.kind === "office_not_found" ? (
          <Notice icon={SearchX} title="Ofis bulunamadı" text={`"${rawOffice}" kısa adıyla bir ofis yok. Ofis kimliğini ya da kısa adını kontrol edin.`} />
        ) : res.kind === "audit_failed" ? (
          <Notice {...AUDIT_FAILED} />
        ) : (
          <Notice {...READ_FAILED} />
        )}
      </div>
    );
  }

  const t = plan.table;
  const officeId = res.office?.id ?? null;
  const base = planHrefInput(plan, officeId);
  const cols = listColumns(t).filter((c) => c.key !== "tenant_id");
  const showOffice = t.tenantColumn === "tenant_id";
  const officeHref = (id: string) => explorerHref({ ...base, office: id, page: 1 });

  return (
    <div className="space-y-4">
      <FilterForm plan={plan} officeValue={officeId ?? rawOffice} />
      {res.office ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          Ofis: <strong className="text-ink-950">{res.office.name ?? res.office.id}</strong>
          <Link href={`/admin/tenants/${res.office.id}`} className="focus-ring inline-flex touch:min-h-11 items-center gap-1 font-semibold text-brand-600 hover:underline">
            Ofis 360 <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
        </p>
      ) : null}

      <section aria-label={`${t.label} kayıtları`} className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="font-display font-bold text-ink-950">{t.label}</h2>
          <span className="flex items-center gap-1 text-xs text-text-muted">
            <Lock className="h-3 w-3" aria-hidden /> Salt okunur ·{" "}
            <span className="numeric">{res.total.toLocaleString("tr-TR")}</span> kayıt{res.total >= 1000 ? " (tahmini)" : ""}
          </span>
        </div>
        {res.rows.length === 0 ? (
          <p role="status" className="px-5 py-8 text-center text-sm text-text-muted">
            Bu süzgeçlerle eşleşen kayıt yok.
          </p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-text-muted">
                <tr>
                  {cols.map((c) => (
                    <th key={c.key} scope="col" className="px-3 py-2 font-semibold first:pl-5">
                      {c.label}
                      {c.mask ? <EyeOff className="ml-1 inline h-3 w-3" aria-label="maskeli" /> : null}
                    </th>
                  ))}
                  {showOffice ? (
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Ofis
                    </th>
                  ) : null}
                  <th scope="col" className="px-5 py-2 text-right font-semibold">
                    <span className="sr-only">Ayrıntı</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {res.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas">
                    {cols.map((c) => (
                      <td key={c.key} className="max-w-[280px] truncate px-3 py-2 first:pl-5">
                        <Cell col={c} value={r.cells[c.key] ?? null} />
                      </td>
                    ))}
                    {showOffice ? (
                      <td className="px-3 py-2">
                        <OfficeCell row={r} names={res.officeNames} hrefFor={officeHref} />
                      </td>
                    ) : null}
                    <td className="px-5 py-2 text-right">
                      <Link
                        href={explorerHref({ ...base, recordId: r.id })}
                        prefetch={false}
                        className="focus-ring inline-flex touch:min-h-11 items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                      >
                        Ayrıntı <ArrowUpRight className="h-3 w-3" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {res.total > EXPLORER_MAX_ROWS ? (
        <p role="note" className="text-xs text-text-muted">
          İlk <span className="numeric">{EXPLORER_MAX_ROWS.toLocaleString("tr-TR")}</span> kayıt sayfalanır; tamamını görmek için süzgeçle daraltın.
        </p>
      ) : null}
      {/* Sayfa bağlantıları sayfalama tavanını aşmaz: 401. sayfa bağlantısı 400. sayfayı yeniden göstermesin. */}
      <Pagination page={plan.page} total={Math.min(res.total, EXPLORER_MAX_ROWS)} pageSize={EXPLORER_PAGE_SIZE} prefetch={false} hrefFor={(p) => explorerHref({ ...base, page: p })} />
    </div>
  );
}

async function RecordDetail({ plan, actorId }: { plan: ExplorerPlan; actorId: string }) {
  const res = await readExplorerRecord(plan, actorId);
  const officeId = plan.office && "id" in plan.office ? plan.office.id : null;
  const back = explorerHref(planHrefInput(plan, officeId));
  const backLink = (
    <Link href={back} prefetch={false} className="focus-ring inline-flex touch:min-h-11 items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {plan.table.label} listesine dön
    </Link>
  );

  if (res.kind !== "ok") {
    return (
      <div className="space-y-4">
        {backLink}
        {res.kind === "not_found" ? (
          <Notice icon={SearchX} title="Kayıt bulunamadı" text="Bu kimlikle bir kayıt yok ya da silinmiş." />
        ) : res.kind === "audit_failed" ? (
          <Notice {...AUDIT_FAILED} />
        ) : (
          <Notice {...READ_FAILED} />
        )}
      </div>
    );
  }

  const t = plan.table;
  const { row } = res;
  return (
    <div className="space-y-4">
      {backLink}
      <section aria-label="Kayıt ayrıntısı" className="rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-xs font-semibold text-brand-600">
              <Lock className="h-3 w-3" aria-hidden /> {t.label} · salt okunur
            </p>
            <h2 className="numeric mt-1 truncate font-display font-bold text-ink-950">{row.id}</h2>
          </div>
          {row.link ? (
            <ButtonLink variant="outline" size="sm" href={row.link.href}>
              {row.link.label} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </ButtonLink>
          ) : null}
        </div>
        <dl className="grid gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-2">
          {t.columns.map((c) => (
            <div key={c.key} className="min-w-0">
              <dt className="flex items-center gap-1 text-xs font-semibold text-text-muted">
                {c.label}
                {c.mask ? (
                  <Badge size="sm" variant="info">
                    maskeli
                  </Badge>
                ) : null}
              </dt>
              <dd className="m-0 mt-0.5 break-words">
                {c.key === "tenant_id" && row.tenantId ? (
                  <Link href={`/admin/tenants/${row.tenantId}`} className="focus-ring font-semibold text-brand-600 hover:underline">
                    {res.officeNames[row.tenantId] ?? row.tenantId}
                  </Link>
                ) : c.kind === "uuid" && row.cells[c.key] ? (
                  <span className="numeric text-text-muted">{row.cells[c.key]}</span>
                ) : (
                  <Cell col={c} value={row.cells[c.key] ?? null} />
                )}
              </dd>
            </div>
          ))}
        </dl>
        {t.secretColumns.length > 0 ? (
          <p className="border-t border-line px-5 py-3 text-xs text-text-faint">
            Bu tablodaki {t.secretColumns.length} sütun (sır, jeton ya da gizli içerik) güvenlik gereği seçilmez ve gösterilmez.
          </p>
        ) : null}
      </section>
    </div>
  );
}
