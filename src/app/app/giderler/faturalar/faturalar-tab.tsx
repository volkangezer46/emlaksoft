import Link from "@/components/ui/smart-link";
import { redirect } from "next/navigation";
import { AlertTriangle, Ban, CheckCircle2, FilePlus2, FileText, PencilLine, Plug } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ListHero, ListPage } from "@/components/ui/list-page";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { EffectivePermissions } from "@/lib/permissions-effective";
import { DOC_TYPE_LABEL, EINVOICE_PROVIDER_META, MODE_LABEL } from "@/lib/integrations/einvoice/providers";
import { DEFAULT_VAT_RATE } from "@/lib/integrations/einvoice/invoice-math";
import {
  EINVOICE_ROW_COLUMNS,
  getConnectionInfo,
  type EInvoiceRow,
} from "@/lib/integrations/einvoice/service";
import { loadSourcePrefill, SOURCE_QUERY, SOURCE_TYPE_LABEL } from "@/lib/integrations/einvoice/source-prefill";
import { InvoiceEditor, type EditorInitial } from "./invoice-editor";
import { InvoiceRowActions, IssuePanel } from "./invoice-actions";

/** Finans sayfası sekme kaydı: sekme şeridine tek satır eklenir (`?sekme=faturalar`). */
export const FATURALAR_SEKME = { key: "faturalar", label: "Faturalar" } as const;

export type FaturalarParams = { durum?: string; kaynak?: string; id?: string; duzenle?: string; adet?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE = "/app/giderler?sekme=faturalar";
const STATUS_FILTERS = ["draft", "issued", "error", "cancelled"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const STATUS_LABEL: Record<StatusFilter, string> = { draft: "Taslak", issued: "Resmileşti", error: "Hata", cancelled: "İptal" };

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);
const dateFmt = (iso: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" }).format(new Date(`${iso}T12:00:00`));

function StatusBadge({ row }: { row: Pick<EInvoiceRow, "status" | "provider_state"> }) {
  if (row.status === "draft") return <Badge variant="neutral" size="sm" dot>Taslak</Badge>;
  if (row.status === "error") return <Badge variant="danger" size="sm" dot>Hata</Badge>;
  if (row.status === "cancelled") return <Badge variant="outline" size="sm">İptal</Badge>;
  if (row.provider_state === "succeeded") return <Badge variant="success" size="sm" dot>Resmileşti</Badge>;
  return <Badge variant="info" size="sm" dot pulse>Sağlayıcıda işleniyor</Badge>;
}

function sourceHref(row: EInvoiceRow): string | null {
  if (row.source_type === "commission") return "/app/komisyon";
  if (row.source_type === "rent_management_fee") return "/app/kiralama";
  return null;
}

function toEditorLines(lines: EInvoiceRow["lines"]): EditorInitial["lines"] {
  return lines.map((l) => ({ description: String(l.description), quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatRate: Number(l.vatRate) }));
}

function todayIso(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date(now()));
}

export async function FaturalarTab({ perms, params }: { perms: EffectivePermissions; params: FaturalarParams }) {
  const canInvoice = perms.commissions?.includes("create") ?? false;
  const canEditSettings = perms.settings?.includes("edit") ?? false;
  const hero = (
    <ListHero
      eyebrow="Finans"
      title="Faturalar"
      description="Komisyon ve hizmet bedeli için e-Fatura / e-Arşiv kesin, durumunu ve PDF belgesini buradan izleyin."
      actions={
        canInvoice ? (
          <ButtonLink href={`${BASE}&kaynak=serbest`} icon={FilePlus2}>
            Serbest fatura
          </ButtonLink>
        ) : null
      }
    />
  );

  if (!canInvoice) {
    return (
      <ListPage>
        {hero}
        <EmptyState icon={FileText} title="Faturalar bu hesapta açık değil" description="Fatura kesmek ve görmek için komisyon yönetimi yetkisi gerekir. Ofis yöneticinizle görüşün." tone="amber" />
      </ListPage>
    );
  }

  const supabase = await createClient();
  const { info, available } = await getConnectionInfo(supabase);
  if (!available) {
    return (
      <ListPage>
        {hero}
        <EmptyState icon={FileText} title="e-Fatura henüz etkin değil" description="Veritabanı güncellemesi tamamlanınca burada görünür." tone="amber" />
      </ListPage>
    );
  }
  if (!info) {
    return (
      <ListPage>
        {hero}
        <EmptyState
          icon={Plug}
          title="e-Fatura'yı bağlayın"
          description="Nilvera ya da Paraşüt hesabınızı bağlayın; sonra komisyonlardan tek tıkla fatura taslağı hazırlayın. Tüm paketlerde, ek ücretsiz."
          action={{ href: "/app/ayarlar/entegrasyonlar#e-fatura", label: "e-Fatura'yı bağla" }}
          tone="brand"
        />
        {!canEditSettings ? <p className="text-center text-xs text-text-faint">Bağlantıyı yalnız ofis yöneticisi kurabilir.</p> : null}
      </ListPage>
    );
  }

  const providerName = EINVOICE_PROVIDER_META[info.provider].name;
  const sandbox = info.mode === "sandbox";
  const canCancelByProvider = info.provider === "nilvera";

  // --- Taslak düzenleme / kontrol ---
  if (params.duzenle && UUID_RE.test(params.duzenle)) {
    const { data } = await supabase.from("einvoices").select(EINVOICE_ROW_COLUMNS).eq("id", params.duzenle).maybeSingle();
    const row = data as unknown as EInvoiceRow | null;
    if (row && row.status === "draft") {
      const initial: EditorInitial = {
        id: row.id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        sourceLabel: row.source_label ?? SOURCE_TYPE_LABEL[row.source_type as keyof typeof SOURCE_TYPE_LABEL] ?? "Fatura",
        buyerName: row.buyer_name,
        buyerTaxId: row.buyer_tax_id,
        buyerTaxOffice: row.buyer_tax_office ?? "",
        buyerAddress: row.buyer_address ?? "",
        buyerCity: row.buyer_city ?? "",
        buyerDistrict: row.buyer_district ?? "",
        issueDate: row.issue_date,
        note: row.note ?? "",
        lines: toEditorLines(row.lines),
      };
      return (
        <ListPage>
          {hero}
          <Link href={BASE} className="text-sm font-semibold text-text-muted hover:text-brand-600">← Fatura listesi</Link>
          {row.error ? <p className="rounded-[var(--radius-card)] border border-danger-400/40 bg-danger-500/8 px-4 py-3 text-sm font-semibold text-danger-600" role="alert">Son deneme başarısız: {row.error}</p> : null}
          <InvoiceEditor initial={initial} />
          <IssuePanel
            id={row.id}
            sandbox={sandbox}
            providerName={providerName}
            docTypeLabel={DOC_TYPE_LABEL[row.doc_type]}
            grossLabel={money(Number(row.gross_total))}
          />
        </ListPage>
      );
    }
    redirect(BASE);
  }

  // --- Kaynaktan yeni taslak ---
  const sourceType = params.kaynak ? SOURCE_QUERY[params.kaynak] : undefined;
  if (sourceType) {
    if (sourceType === "free") {
      return (
        <ListPage>
          {hero}
          <Link href={BASE} className="text-sm font-semibold text-text-muted hover:text-brand-600">← Fatura listesi</Link>
          <InvoiceEditor
            initial={{
              id: null,
              sourceType: "free",
              sourceId: null,
              sourceLabel: "Serbest fatura",
              buyerName: "",
              buyerTaxId: "",
              buyerTaxOffice: "",
              buyerAddress: "",
              buyerCity: "",
              buyerDistrict: "",
              issueDate: todayIso(),
              note: "",
              lines: [{ description: "", quantity: "1", unitPrice: "", vatRate: DEFAULT_VAT_RATE }],
            }}
          />
        </ListPage>
      );
    }
    if (params.id && UUID_RE.test(params.id)) {
      // Aynı kaynak iki kez faturalanmaz: varsa onu aç.
      const { data: existing } = await supabase
        .from("einvoices")
        .select("id, status")
        .eq("source_type", sourceType)
        .eq("source_id", params.id)
        .neq("status", "cancelled")
        .maybeSingle();
      const found = existing as { id: string; status: string } | null;
      if (found?.status === "draft") redirect(`${BASE}&duzenle=${found.id}`);
      if (found) redirect(`${BASE}&durum=${found.status}`);

      const prefill = await loadSourcePrefill(supabase, sourceType, params.id);
      if (prefill) {
        return (
          <ListPage>
            {hero}
            <Link href={BASE} className="text-sm font-semibold text-text-muted hover:text-brand-600">← Fatura listesi</Link>
            <InvoiceEditor
              initial={{
                id: null,
                sourceType,
                sourceId: prefill.sourceId,
                sourceLabel: prefill.label,
                buyerName: prefill.buyerName,
                buyerTaxId: "",
                buyerTaxOffice: "",
                buyerAddress: "",
                buyerCity: "",
                buyerDistrict: "",
                issueDate: todayIso(),
                note: "",
                lines: prefill.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatRate: l.vatRate })),
              }}
            />
          </ListPage>
        );
      }
    }
  }

  // --- Liste ---
  const durum = (STATUS_FILTERS as readonly string[]).includes(params.durum ?? "") ? (params.durum as StatusFilter) : null;
  const adet = Math.min(Math.max(Math.trunc(Number(params.adet)) || 100, 100), 500);
  let query = supabase.from("einvoices").select(EINVOICE_ROW_COLUMNS).order("created_at", { ascending: false }).limit(adet);
  if (durum) query = query.eq("status", durum);
  const [listRes, countsRes] = await Promise.all([query, supabase.from("einvoices").select("status").limit(2000)]);
  const rows = ((listRes.data ?? []) as unknown as EInvoiceRow[]);
  const counts: Record<string, number> = { draft: 0, issued: 0, error: 0, cancelled: 0 };
  for (const r of (countsRes.data ?? []) as Array<{ status: string }>) counts[r.status] = (counts[r.status] ?? 0) + 1;

  const STATUS_ICON = { draft: <PencilLine />, issued: <CheckCircle2 />, error: <AlertTriangle />, cancelled: <Ban /> } as const;
  const STATUS_TONE = { draft: "neutral", issued: "success", error: "danger", cancelled: "neutral" } as const;
  const kpis: KpiItem[] = STATUS_FILTERS.map((s) => ({
    label: STATUS_LABEL[s],
    value: counts[s] ?? 0,
    icon: STATUS_ICON[s],
    tone: STATUS_TONE[s],
    href: `${BASE}&durum=${s}`,
  }));

  return (
    <ListPage>
      {hero}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={sandbox ? "warning" : "info"} size="sm">{providerName} · {MODE_LABEL[info.mode]}</Badge>
        {info.status === "error" ? <Badge variant="danger" size="sm">Bağlantı hatası: Ayarlar&apos;dan test edin</Badge> : null}
        <Link href="/app/ayarlar/entegrasyonlar#e-fatura" className="text-xs font-semibold text-accent-text hover:underline">Bağlantı ayarları</Link>
      </div>
      <KpiStrip items={kpis} />
      {durum ? (
        <p className="text-sm text-text-muted">
          Süzgeç: <strong>{STATUS_LABEL[durum]}</strong> · <Link href={BASE} className="font-semibold text-accent-text hover:underline">Tümünü göster</Link>
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={durum ? "Bu durumda fatura yok" : "Henüz fatura yok"}
          description="Anlaşma ya da komisyon sayfasındaki “Fatura kes” düğmesiyle önceden doldurulmuş bir taslak açabilirsiniz."
          action={durum ? { href: BASE, label: "Tümünü göster" } : { href: "/app/komisyon", label: "Komisyonlara git" }}
          tone="brand"
        />
      ) : (
        <TableFrame minWidth={900}>
          <Table>
            <THead>
              <TR>
                <TH>Tarih</TH>
                <TH>Alıcı</TH>
                <TH>Kaynak</TH>
                <TH>Tür</TH>
                <TH align="right">Tutar</TH>
                <TH>Durum</TH>
                <TH align="right">İşlem</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const href = sourceHref(r);
                return (
                  <TR key={r.id}>
                    <TD label="Tarih">{dateFmt(r.issue_date)}</TD>
                    <TD label="Alıcı" primary>
                      <span className="font-semibold text-ink-950">{r.buyer_name}</span>
                      {r.number ? <span className="block text-xs text-text-faint">No {r.number}</span> : null}
                    </TD>
                    <TD label="Kaynak">
                      {href ? <Link href={href} className="text-accent-text hover:underline">{r.source_label ?? "Kaynak"}</Link> : (r.source_label ?? "—")}
                    </TD>
                    <TD label="Tür">
                      {DOC_TYPE_LABEL[r.doc_type]}
                      {r.mode === "sandbox" ? <Badge variant="warning" size="sm" className="ml-1.5">Test</Badge> : null}
                    </TD>
                    <TD label="Tutar" align="right"><span className="numeric font-semibold">{money(Number(r.gross_total))}</span></TD>
                    <TD label="Durum">
                      <StatusBadge row={r} />
                      {r.error ? <span className="mt-1 block max-w-[260px] text-xs text-danger-600">{r.error}</span> : null}
                    </TD>
                    <TD actions align="right">
                      <InvoiceRowActions id={r.id} status={r.status} canCancel={canCancelByProvider && r.doc_type === "e-arsiv" && r.provider === info.provider} sandbox={r.mode === "sandbox"} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableFrame>
      )}
      {rows.length >= adet && adet < 500 ? (
        <div className="text-center">
          <Link href={`${BASE}${durum ? `&durum=${durum}` : ""}&adet=${adet + 100}`} className="focus-ring inline-flex rounded-[var(--radius-control)] border border-line px-4 py-2 text-sm font-semibold text-accent-text hover:border-brand-300">
            Daha fazla göster ({adet} kayıt gösteriliyor)
          </Link>
        </div>
      ) : null}
    </ListPage>
  );
}

