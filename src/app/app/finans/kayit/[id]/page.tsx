import { financePath } from "@/lib/finance/routes";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { canHandleSalary } from "@/lib/finance/cash/categories";
import { entryReturnHref, isUuidLike, parseEntryPrefill } from "@/lib/finance/entry-workspace";
import { requireModulePage } from "@/lib/require-module-page";
import { lockReasonFor } from "../../(merkez)/_hareketler/ledger-filters";
import { loadEntryContext } from "../_data";
import { EditEntryForm, type EditEntry } from "../_components/edit-entry-form";

/**
 * Finans > Kaydı düzenle (TAM SAYFA; eski "Hareketi düzenle" penceresinin yerine). Yalnız elle girilmiş gelir/gider
 * düzenlenir; tahsilat/transfer/düzenli/ekstre kaynaklı, iptal edilmiş ya da kapatılmış dönemdeki kayıt salt okunur açıklama
 * ile gösterilir. Ofis hesabı satırı defter v2 ile (belge tutarı + KDV dahil/hariç + KDV/stopaj oranı + cari + portföy),
 * kişisel hesap (Kasam, `?kapsam=kisisel`) eski yolla güncellenir. Okuma RLS'lidir: başkasının kişisel hareketi gelmez.
 */

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata = { title: "Kaydı düzenle · Muhasebe" };

const SOURCE_LABEL: Record<string, string> = {
  commission: "komisyon tahsilatından",
  rent: "kira tahsilatından",
  building: "aidat tahsilatından",
  owner_payout: "mülk sahibi ödemesinden",
  due: "aidattan",
  recurring: "düzenli ödemeden",
  import: "ekstreden",
  open_item: "vadeli kalemden",
};

type EntryRow = {
  id: string;
  account_id: string;
  direction: string;
  amount: number | string;
  currency: string | null;
  entry_date: string;
  kind: string;
  category: string | null;
  title: string | null;
  counterparty: string | null;
  document_url: string | null;
  note: string | null;
  source_type: string | null;
  voided_at: string | null;
  vat_rate: number | string | null;
  vat_amount: number | string | null;
  vat_included: boolean | null;
  withholding_rate: number | string | null;
  withholding_amount: number | string | null;
  party_id: string | null;
  property_id: string | null;
  party: { name: string | null } | { name: string | null }[] | null;
  property: { property_code: string | null; title: string | null } | { property_code: string | null; title: string | null }[] | null;
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export default async function EditEntryPage({ params, searchParams }: { params: Params; searchParams?: SearchParams }) {
  const { id } = await params;
  const prefill = parseEntryPrefill((await searchParams) ?? {});
  const personalPage = prefill.personal;
  if (!isUuidLike(id)) notFound();
  const { perms, userId, role } = personalPage ? await requireModulePage("dashboard") : await requireModulePage("expenses", financePath());
  const canEdit = !personalPage && (perms.expenses?.includes("edit") ?? false);

  const supabase = await createClient();
  const [entryRes, locksRes, attachRes, ctx] = await Promise.all([
    supabase
      .from("cash_entries")
      .select(
        "id, account_id, direction, amount, currency, entry_date, kind, category, title, counterparty, document_url, note, source_type, voided_at, vat_rate, vat_amount, vat_included, withholding_rate, withholding_amount, party_id, property_id, party:finance_parties!cash_entries_party_id_fkey(name), property:properties!cash_entries_property_id_fkey(property_code, title)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("finance_period_locks").select("period_month"),
    supabase.from("finance_attachments").select("id", { count: "exact", head: true }).eq("entry_id", id),
    loadEntryContext({ personal: personalPage, userId, canOffice: canEdit }),
  ]);
  const row = entryRes.data as unknown as EntryRow | null;
  if (!row) notFound();
  const account = ctx.accounts.find((a) => a.id === row.account_id) ?? null;
  // Kişisel sayfada ofis hareketi açılmaz (kapı dashboard); ofis sayfasında kişisel hesap hareketi yalnız sahibine gelir (RLS).
  if (personalPage && account?.scope !== "user") notFound();
  const personal = account?.scope === "user";
  const returnHref = entryReturnHref(personalPage);

  const lockedMonths = new Set(((locksRes.data ?? []) as { period_month: string }[]).map((l) => String(l.period_month).slice(0, 7)));
  const manual = row.source_type === "manual" && (row.kind === "income" || row.kind === "expense");
  const readonlyReason = row.voided_at
    ? "Bu kayıt iptal edilmiş; düzenlenemez."
    : !manual
      ? row.kind === "transfer"
        ? "Transfer kayıtları düzenlenemez; gerekirse iptal edip yeniden girin."
        : `Bu kayıt ${SOURCE_LABEL[row.source_type ?? ""] ?? "otomatik"} oluştu; tutar ve tarih kaynağından yönetilir. Kategori, not ve kişi/firmayı Hareketler listesinde satır içinde değiştirebilirsiniz.`
      : !account
        ? "Bu hesabın kayıtlarını düzenleme yetkiniz yok."
        : !personal && !canEdit
          ? "Ofis kayıtlarını düzenleme yetkiniz yok."
          : lockReasonFor(String(row.entry_date).slice(0, 10), lockedMonths);

  const party = one(row.party);
  const property = one(row.property);
  const entry: EditEntry = {
    id: row.id,
    accountId: row.account_id,
    direction: row.direction === "in" ? "in" : "out",
    amount: Number(row.amount),
    currency: row.currency ?? account?.currency ?? "TRY",
    date: String(row.entry_date).slice(0, 10),
    category: row.category,
    title: row.title ?? "",
    counterparty: row.counterparty,
    documentUrl: row.document_url,
    note: row.note,
    partyId: row.party_id,
    partyName: party?.name ?? null,
    propertyId: row.property_id,
    propertyLabel: property ? (property.property_code ?? property.title ?? null) : null,
    attachmentCount: attachRes.count ?? 0,
    ledger: !personal
      ? {
          vatRate: num(row.vat_rate),
          vatAmount: num(row.vat_amount),
          vatIncluded: row.vat_included,
          withholdingRate: num(row.withholding_rate),
          withholdingAmount: num(row.withholding_amount),
        }
      : null,
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4">
      <PageHeader
        eyebrow={personalPage ? "Kasam" : "Finans"}
        title="Kaydı düzenle"
        breadcrumbs={
          personalPage
            ? [{ label: "Hesabım", href: "/app/hesabim" }, { label: "Kasam", href: returnHref }, { label: "Kaydı düzenle" }]
            : [{ label: "Muhasebe", href: financePath() }, { label: "Hareketler", href: returnHref }, { label: "Kaydı düzenle" }]
        }
        description={entry.title || undefined}
      />
      <EditEntryForm
        entry={entry}
        account={account}
        readonlyReason={readonlyReason}
        ctx={{
          userId,
          personal: personalPage,
          office: canEdit && !personal,
          today: ctx.today,
          accounts: ctx.accounts,
          categories: ctx.categories,
          recent: ctx.recent,
          budgets: ctx.budgets,
          vatIncludedDefault: ctx.vatIncludedDefault,
          canSalary: !personalPage && canHandleSalary(role),
          returnHref,
        }}
      />
    </div>
  );
}
