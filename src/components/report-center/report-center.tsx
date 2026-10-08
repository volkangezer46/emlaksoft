import Link from "@/components/ui/smart-link";
import {
  ArrowLeft,
  BarChart3,
  Banknote,
  Building2,
  CalendarClock,
  Clock3,
  Download,
  FileSpreadsheet,
  Headset,
  Home,
  Megaphone,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeField } from "@/components/ui/date-range-field";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { buildPlatformContext, buildTenantContext } from "@/lib/report-center/context";
import { previewReport } from "@/lib/report-center/engine";
import { parseFilters, summarizeFilters } from "@/lib/report-center/filters";
import { loadRecentDownloads } from "@/lib/report-center/history";
import { REPORT_CENTER_PATH, reportCenterHref, reportDownloadHref } from "@/lib/report-center/links";
import { categoriesFor, searchReports, visiblePlatformReports, visibleTenantReports } from "@/lib/report-center/registry";
import { REPORT_PREVIEW_ROWS, REPORT_ROW_LIMITS, type FilterField, type ReportContext, type ReportDef, type ReportScope, type Filters } from "@/lib/report-center/types";
import { computeTotals, displayValue, formatDateTimeTr } from "@/lib/report-center/values";
import { requirePermission } from "@/lib/require-permission";
import { requirePlatformModule } from "@/lib/platform";
import { REPORT_FORMAT_LABELS } from "@/lib/report-center/types";
import { ReportDownloadButtons } from "./download-buttons";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const CATEGORY_ICON: Record<string, LucideIcon> = {
  musteri: Users,
  portfoy: Home,
  satis: TrendingUp,
  finans: Banknote,
  ekip: BarChart3,
  pazarlama: Megaphone,
  ofis: ShieldCheck,
  platform: Building2,
  gelir: Banknote,
  destek: Headset,
};

type Loaded = { ctx: ReportContext; reports: ReportDef[]; error?: string };

/** Oturumdan rapor bağlamı + bu kullanıcının görebileceği raporlar. Sayfa kapısı (requireModulePage) ayrıca geçilmiştir. */
async function load(scope: ReportScope): Promise<Loaded> {
  if (scope === "platform") {
    const staff = await requirePlatformModule("reports");
    return { ctx: buildPlatformContext({ id: staff.id, role: staff.role }), reports: visiblePlatformReports(staff.role) };
  }
  const gate = await requirePermission("reports", "view");
  if (!gate.ok) throw new Error(gate.error);
  const ctx = await buildTenantContext(gate);
  const reports = visibleTenantReports({ perms: ctx.perms, role: gate.role, officeWide: ctx.officeWide, seeAllEarnings: ctx.seeAllEarnings });
  return { ctx, reports };
}

/**
 * RAPOR MERKEZİ — /app/raporlar ve /admin/raporlar `?sekme=merkez`. Katalog (arama + kategori) → rapor çalışma alanı
 * (filtre formu, sunucuda önizleme, Excel / PDF / CSV indirme) → son indirmeler. Filtre kontratı: durum URL'dedir
 * (`rapor`, rapora özel filtre anahtarları, `ara`, `kategori`); sayfa içi "Raporlarda aç" bağlantıları aynı adresi üretir.
 */
export async function ReportCenter({ scope, params }: { scope: ReportScope; params: Params }) {
  const { ctx, reports } = await load(scope);
  const pathname = REPORT_CENTER_PATH[scope];
  const selectedId = one(params.rapor);
  const selected = selectedId ? reports.find((r) => r.id === selectedId) : undefined;
  const history = await loadRecentDownloads(ctx);
  const crumbs = [{ label: "Raporlar", href: pathname }, { label: "Rapor merkezi" }];

  if (!selected) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Raporlar"
          title="Rapor merkezi"
          description={scope === "platform" ? "Platform raporlarını filtreleyin, önizleyin ve Excel, PDF ya da CSV olarak indirin." : "Ofis verilerinizi filtreleyin, önizleyin ve Excel, PDF ya da CSV olarak indirin. Görünen raporlar yetkinize ve veri kapsamınıza göre belirlenir."}
          breadcrumbs={crumbs}
        />
        {selectedId ? (
          <Alert tone="warning" title="Rapor bulunamadı">
            Bu rapor yok ya da görüntüleme yetkiniz bulunmuyor. Aşağıdaki listeden seçebilirsiniz.
          </Alert>
        ) : null}
        <Catalog scope={scope} pathname={pathname} reports={reports} params={params} />
        <RecentDownloads scope={scope} items={history} />
      </div>
    );
  }

  const parsed = parseFilters(selected, params);
  const filters: Filters = parsed.ok ? parsed.filters : {};
  const preview = parsed.ok ? await previewReport(selected, ctx, filters) : null;
  const options = await loadFilterOptions(selected, ctx);
  const summary = parsed.ok ? summarizeFilters(selected, filters, options.advisorNames) : [];
  const total = preview?.ok ? preview.total : 0;
  const hrefs = {
    xlsx: reportDownloadHref(scope, selected.id, "xlsx", filters),
    pdf: reportDownloadHref(scope, selected.id, "pdf", filters),
    csv: reportDownloadHref(scope, selected.id, "csv", filters),
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={categoriesFor(scope).find((c) => c.id === selected.category)?.label ?? "Rapor"}
        title={selected.title}
        description={selected.description}
        breadcrumbs={[...crumbs.slice(0, 1), { label: "Rapor merkezi", href: `${pathname}?sekme=merkez` }, { label: selected.title }]}
        actions={
          <ButtonLink href={`${pathname}?sekme=merkez`} variant="outline" icon={ArrowLeft}>
            Tüm raporlar
          </ButtonLink>
        }
      />

      {selected.personalData ? (
        <Alert tone="info" title="Kişisel veri içerir (KVKK)">
          Bu rapor ad, telefon gibi kişisel veriler içerebilir. İndirmeler denetim kaydına yazılır; dosyayı yetkisiz kişilerle paylaşmayın.
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
          <FilterCard def={selected} filters={filters} pathname={pathname} options={options} />

          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Önizleme</CardTitle>
                <CardDescription>
                  {preview?.ok
                    ? `İlk ${Math.min(REPORT_PREVIEW_ROWS, preview.table.rows.length)} satır gösteriliyor · toplam ${total.toLocaleString("tr-TR")} kayıt`
                    : "Filtreyi uygulayınca ilk satırlar burada görünür."}
                </CardDescription>
              </div>
              {summary.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {summary.map((s) => (
                    <StatusBadge key={s.label} tone="neutral">{`${s.label}: ${s.value}`}</StatusBadge>
                  ))}
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4 p-0 sm:p-0">
              {!parsed.ok ? (
                <div className="p-5">
                  <Alert tone="danger" title="Filtre geçersiz">{parsed.error}</Alert>
                </div>
              ) : !preview?.ok ? (
                <div className="p-5">
                  <Alert tone="danger" title="Önizleme hazırlanamadı">{preview?.error}</Alert>
                </div>
              ) : preview.table.rows.length === 0 ? (
                <EmptyState variant="compact" bare title="Bu filtreyle kayıt bulunamadı" description="Tarih aralığını genişletmeyi ya da filtreleri temizlemeyi deneyin." />
              ) : (
                <PreviewTable table={preview.table} />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Dosya olarak indir</CardTitle>
                <CardDescription>Uygulanan filtrelerle, tüm kayıtlar (önizleme yalnız ilk {REPORT_PREVIEW_ROWS} satırdır).</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <ReportDownloadButtons
                hrefs={hrefs}
                disabled={!preview?.ok || total === 0}
                disabledReason={!parsed.ok ? "Önce geçerli bir filtre uygulayın." : total === 0 ? "İndirilecek kayıt yok." : undefined}
                limits={REPORT_ROW_LIMITS}
                total={total}
              />
              <ul className="space-y-1 text-xs text-text-muted">
                <li>Excel: kalın başlık, dondurulmuş satır, süzgeç, tarih ve para biçimleri; üstte ofis ve filtre özeti.</li>
                <li>PDF: yatay / dikey otomatik, her sayfada başlık satırı ve sayfa numarası.</li>
                <li>CSV: UTF-8, noktalı virgül ayraç (Excel Türkçe uyumlu).</li>
              </ul>
            </CardContent>
          </Card>
          <RecentDownloads scope={scope} items={history.filter((h) => h.reportId === selected.id)} title="Bu rapordaki son indirmeleriniz" compact />
        </div>
      </div>
    </div>
  );
}

function Catalog({ scope, pathname, reports, params }: { scope: ReportScope; pathname: string; reports: ReportDef[]; params: Params }) {
  const ara = one(params.ara).slice(0, 80);
  const kategori = one(params.kategori);
  const categories = categoriesFor(scope).filter((c) => reports.some((r) => r.category === c.id));
  const matched = searchReports(reports, ara).filter((r) => !kategori || r.category === kategori);
  const catHref = (id: string) => `${pathname}?${new URLSearchParams({ sekme: "merkez", ...(ara ? { ara } : {}), ...(id ? { kategori: id } : {}) }).toString()}`;

  return (
    <div className="space-y-5">
      <form method="get" action={pathname} role="search" className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="sekme" value="merkez" />
        {kategori ? <input type="hidden" name="kategori" value={kategori} /> : null}
        <label htmlFor="rapor-ara" className="sr-only">Rapor ara</label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
          <FormInput id="rapor-ara" name="ara" defaultValue={ara} placeholder="Rapor ara: müşteri, komisyon, fatura..." className="pl-9" autoComplete="off" />
        </div>
        <Button type="submit" variant="primary" size="lg" className="min-h-11 sm:w-auto">Ara</Button>
      </form>

      <nav aria-label="Rapor kategorileri" className="flex flex-wrap gap-2">
        <CategoryChip href={catHref("")} active={!kategori} label={`Tümü (${searchReports(reports, ara).length})`} />
        {categories.map((c) => (
          <CategoryChip key={c.id} href={catHref(c.id)} active={kategori === c.id} label={`${c.label} (${searchReports(reports, ara).filter((r) => r.category === c.id).length})`} />
        ))}
      </nav>

      {matched.length === 0 ? (
        <EmptyState variant="compact" icon={FileSpreadsheet} title="Aramanıza uyan rapor yok" description="Farklı bir sözcük deneyin ya da kategoriyi temizleyin." />
      ) : (
        categories
          .filter((c) => matched.some((r) => r.category === c.id))
          .map((c) => {
            const Icon = CATEGORY_ICON[c.id] ?? BarChart3;
            const list = matched.filter((r) => r.category === c.id);
            return (
              <section key={c.id} aria-labelledby={`kat-${c.id}`} className="space-y-3">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-accent" aria-hidden />
                  <h2 id={`kat-${c.id}`} className="font-display text-base font-bold text-text">{c.label}</h2>
                  <span className="text-xs text-text-faint">{c.description}</span>
                </div>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={reportCenterHref(scope, r.id)}
                        className="focus-ring press group flex h-full min-h-11 flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--elev-1)] transition hover:border-border-interactive hover:shadow-[var(--elev-2)]"
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-text group-hover:text-accent-text">{r.title}</span>
                          <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-text-faint group-hover:text-accent" aria-hidden />
                        </span>
                        <span className="text-xs leading-relaxed text-text-muted">{r.description}</span>
                        <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 text-xs text-text-faint">
                          <span>Excel · PDF · CSV</span>
                          {r.personalData ? <StatusBadge tone="attention">Kişisel veri</StatusBadge> : null}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
      )}
    </div>
  );
}

function CategoryChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`focus-ring press inline-flex min-h-11 items-center rounded-full border px-3.5 text-xs font-semibold transition sm:min-h-9 ${active ? "border-accent bg-accent-subtle text-accent-text" : "border-line bg-surface text-text-muted hover:border-border-interactive"}`}
    >
      {label}
    </Link>
  );
}

type Options = { advisors: { value: string; label: string }[]; campaigns: { value: string; label: string }[]; advisorNames: Map<string, string> };

async function loadFilterOptions(def: ReportDef, ctx: ReportContext): Promise<Options> {
  const out: Options = { advisors: [], campaigns: [], advisorNames: new Map() };
  if (ctx.scope !== "tenant" || !ctx.tenantId) return out;
  if (def.filters.some((f) => f.kind === "advisor") && ctx.officeWide) {
    const { data } = await ctx.supabase.from("profiles").select("id, full_name").eq("tenant_id", ctx.tenantId).eq("is_active", true).order("full_name", { ascending: true }).limit(300);
    for (const p of (data ?? []) as { id: string; full_name: string }[]) {
      out.advisors.push({ value: p.id, label: p.full_name });
      out.advisorNames.set(p.id, p.full_name);
    }
  }
  if (def.filters.some((f) => f.kind === "campaign")) {
    const { data } = await ctx.supabase.from("campaigns").select("id, title").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(100);
    for (const c of (data ?? []) as { id: string; title: string }[]) out.campaigns.push({ value: c.id, label: c.title });
  }
  return out;
}

function FilterCard({ def, filters, pathname, options }: { def: ReportDef; filters: Filters; pathname: string; options: Options }) {
  const hasRange = def.filters.some((f) => f.key === "from") && def.filters.some((f) => f.key === "to");
  const fields = def.filters.filter((f) => !(hasRange && (f.key === "from" || f.key === "to")) && !(f.kind === "advisor" && options.advisors.length === 0));
  const from = def.filters.find((f) => f.key === "from");
  const to = def.filters.find((f) => f.key === "to");
  const active = Object.values(filters).filter(Boolean).length;
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Filtreler</CardTitle>
          <CardDescription>{active ? `${active} filtre uygulandı` : "Filtre uygulanmadı: tüm kayıtlar"}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form method="get" action={pathname} className="space-y-4">
          <input type="hidden" name="sekme" value="merkez" />
          <input type="hidden" name="rapor" value={def.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <FieldControl key={f.key} field={f} value={filters[f.key]} options={options} />
            ))}
            {hasRange ? (
              <DateRangeField
                className="sm:col-span-2"
                legend="Tarih aralığı"
                fromLabel={from?.label ?? "Başlangıç"}
                toLabel={to?.label ?? "Bitiş"}
                fromValue={filters.from}
                toValue={filters.to}
                idPrefix="rapor"
              />
            ) : null}
          </div>
          {def.filters.length === 0 ? <p className="text-sm text-text-muted">Bu rapor için filtre yok; tüm kayıtlar gösterilir.</p> : null}
          <div className="flex flex-wrap gap-2">
            {def.filters.length > 0 ? (
              <Button type="submit" variant="primary" size="lg" icon={Search} className="min-h-11">
                Önizlemeyi güncelle
              </Button>
            ) : null}
            {active > 0 ? (
              <ButtonLink href={reportCenterHref(def.scope, def.id)} variant="outline" size="lg" className="min-h-11">
                Filtreleri temizle
              </ButtonLink>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FieldControl({ field, value, options }: { field: FilterField; value?: string; options: Options }) {
  const id = `f-${field.key}`;
  const list =
    field.kind === "select" ? field.options : field.kind === "advisor" ? options.advisors : field.kind === "campaign" ? options.campaigns : null;
  return (
    <FormField label={field.label} htmlFor={id}>
      {list ? (
        <FormSelect id={id} name={field.key} defaultValue={value ?? ""}>
          <option value="">Tümü</option>
          {list.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </FormSelect>
      ) : field.kind === "date" ? (
        <FormInput id={id} type="date" lang="tr-TR" name={field.key} defaultValue={value ?? ""} />
      ) : (
        <FormInput id={id} name={field.key} defaultValue={value ?? ""} placeholder={field.kind === "text" ? field.placeholder : undefined} maxLength={120} autoComplete="off" />
      )}
    </FormField>
  );
}

function PreviewTable({ table }: { table: { columns: readonly { key: string; label: string; type: string; decimals?: number; total?: boolean }[]; rows: (string | number | boolean | null | undefined)[][] } }) {
  const align = (t: string) => (t === "money" || t === "number" || t === "percent" ? "right" : t === "bool" ? "center" : "left");
  const totals = computeTotals(table.columns as never, table.rows);
  const hasTotals = totals.some((t) => t !== null);
  return (
    <TableFrame minWidth={Math.max(640, table.columns.length * 120)} maxHeight="70vh" className="rounded-none border-0 shadow-none">
      <Table>
        <THead sticky>
          <TR>
            {table.columns.map((c) => (
              <TH key={c.key} align={align(c.type)}>{c.label}</TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {table.rows.map((row, i) => (
            <TR key={i}>
              {table.columns.map((c, j) => (
                <TD key={c.key} align={align(c.type)} truncate className="max-w-72">
                  {displayValue(row[j], c as never)}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
        {hasTotals ? (
          <tfoot>
            <tr className="border-t border-line bg-surface-sunken text-xs font-semibold text-text-muted">
              {table.columns.map((c, j) => (
                <td key={c.key} className={`px-4 py-2 ${align(c.type) === "right" ? "numeric text-right" : ""}`}>
                  {j === 0 && totals[j] === null ? "Önizleme toplamı" : totals[j] !== null ? displayValue(totals[j], c as never) : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </Table>
    </TableFrame>
  );
}

function RecentDownloads({ scope, items, title = "Son indirmeleriniz", compact = false }: { scope: ReportScope; items: Awaited<ReturnType<typeof loadRecentDownloads>>; title?: string; compact?: boolean }) {
  if (items.length === 0 && compact) return null;
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-text-faint" aria-hidden />{title}</CardTitle>
          <CardDescription>Denetim kaydından, yalnız sizin indirmeleriniz.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState variant="inline" icon={Download} title="Henüz rapor indirmediniz" />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <Link href={reportCenterHref(scope, h.reportId, h.filters)} className="focus-ring text-sm font-semibold text-text hover:text-accent-text">
                    {h.title}
                  </Link>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
                    <CalendarClock className="h-3 w-3" aria-hidden />
                    <span>{formatDateTimeTr(h.at)}</span>
                    <span>{REPORT_FORMAT_LABELS[h.format as keyof typeof REPORT_FORMAT_LABELS] ?? h.format}</span>
                    <span>{h.rows.toLocaleString("tr-TR")} satır</span>
                    {h.truncated ? <StatusBadge tone="attention">Kesildi</StatusBadge> : null}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
