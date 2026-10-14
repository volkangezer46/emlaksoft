import type { JSX } from "react";
import Link from "@/components/ui/smart-link";
import { FileCheck2, FileText, Files, Inbox, ScanText, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
import type { EffectivePermissions } from "@/lib/permissions-effective";
import { FaturalarTab, type FaturalarParams } from "../faturalar/faturalar-tab";
import { UploadDropzone } from "../belgeler/upload-dropzone";
import { ReceiptInbox, type InboxItem, type InboxLink } from "../belgeler/receipt-inbox";

/**
 * MUHASEBE > BELGELER (FN5). Alt görünümler (`?tur=`):
 *  - `fis`    Fiş kutusu: harekete ya da açık kaleme bağlı OLMAYAN ekler (varsayılan)
 *  - `tumu`   Tüm ekler (bağlı olanlar kayda gider; gelir hareketinde "Fatura kes")
 *  - `fatura` e-Fatura / e-Arşiv ekranı (`faturalar/*`; kanonik adres `?sekme=belgeler&tur=fatura`)
 * Her görünüm yalnız kendi verisini çeker (sorgular Promise.all). Yükleme `/api/app/finans/belge`.
 * Fiş okuma yalnız `finance_settings.ocr_enabled` açıkken; okunan değerler YALNIZ öneri.
 */

/** FN1 `FinanceTabProps` ile yapısal olarak aynı (src/lib/finance/ledger/types.ts). */
export type BelgelerTabProps = {
  params: Record<string, string | undefined>;
  perms: EffectivePermissions;
  tenantId: string;
  userId: string;
  role: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSalary: boolean;
  isOwnerGm: boolean;
};

export type BelgeTur = "fis" | "tumu" | "fatura";
const BASE = "/app/giderler?sekme=belgeler";
const PAGE = 60;
const MAX_PAGE = 300;

export function belgeTurOf(value: string | undefined): BelgeTur {
  return value === "fatura" || value === "tumu" ? value : "fis";
}

const SUBVIEWS: ReadonlyArray<{ id: BelgeTur; label: string; icon: typeof Inbox }> = [
  { id: "fis", label: "Fiş kutusu", icon: Inbox },
  { id: "tumu", label: "Tüm belgeler", icon: Files },
  { id: "fatura", label: "Faturalar", icon: FileText },
];

type AttachmentRow = {
  id: string;
  entry_id: string | null;
  open_item_id: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | string | null;
  ocr_status: string | null;
  ocr_json: Record<string, unknown> | null;
  created_at: string;
};
type EntryRow = {
  id: string;
  title: string | null;
  amount: number | string;
  direction: string;
  counterparty: string | null;
  source_type: string | null;
  source_id: string | null;
  entry_date: string | null;
  vat_rate: number | string | null;
};
type OpenItemRow = { id: string; title: string | null; amount: number | string; direction: string };

const isMissing = (e: { code?: string } | null | undefined) => e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "PGRST200";

function ocrFrom(json: Record<string, unknown> | null): InboxItem["ocr"] {
  if (!json || typeof json !== "object") return null;
  const amount = typeof json.amount === "number" && json.amount > 0 ? json.amount : undefined;
  const date = typeof json.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(json.date) ? json.date : undefined;
  const vatRate = json.vatRate === 1 || json.vatRate === 10 || json.vatRate === 20 ? json.vatRate : undefined;
  const vendor = typeof json.vendor === "string" && json.vendor.trim() ? json.vendor.trim().slice(0, 120) : undefined;
  return amount || date || vatRate || vendor ? { amount, date, vatRate, vendor } : null;
}

function invoiceHrefFor(e: EntryRow): string | null {
  if (e.direction !== "in") return null;
  if (e.source_type === "commission" && e.source_id) return `${BASE}&tur=fatura&kaynak=komisyon&id=${e.source_id}`;
  if (e.source_type && e.source_type !== "manual") return null;
  const sp = new URLSearchParams({ kaynak: "serbest", tutar: String(Number(e.amount) || "") });
  // Hareketin KDV oranı (FN1 `vat_rate`): net birim fiyat bu oranla brütten geri hesaplanır.
  if (e.vat_rate != null && e.vat_rate !== "" && Number.isFinite(Number(e.vat_rate))) sp.set("kdv", String(Number(e.vat_rate)));
  if (e.title) sp.set("aciklama", e.title.slice(0, 120));
  if (e.counterparty) sp.set("alici", e.counterparty.slice(0, 120));
  return `${BASE}&tur=fatura&${sp.toString()}`;
}

/**
 * Bağlı harekete gidiş: Hareketler (FN3) kimlikle açma parametresi sunmuyor; başlık araması (`q`) hareketin GÜNÜNE
 * daraltılır (`from`/`to`), aynı başlıklı başka günlerdeki kayıtlar karışmaz. Birleştirme notu: FN3 `hareket=<id>`
 * eklerse burası ona geçer.
 */
function entryHref(title: string, entryDate: string | null): string {
  const sp = new URLSearchParams({ sekme: "hareketler", q: title.slice(0, 60) });
  if (entryDate && /^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    sp.set("from", entryDate);
    sp.set("to", entryDate);
  }
  return `/app/giderler?${sp.toString()}`;
}

function SubviewChips({ active, counts }: { active: BelgeTur; counts?: Partial<Record<BelgeTur, number | null>> }) {
  return (
    <nav aria-label="Belge görünümleri" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {SUBVIEWS.map((v) => {
        const Icon = v.icon;
        return (
          <FilterChip key={v.id} href={`${BASE}&tur=${v.id}`} active={active === v.id} count={counts?.[v.id] ?? null} prefetch={false}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {v.label}
          </FilterChip>
        );
      })}
    </nav>
  );
}

export async function BelgelerTab(props: BelgelerTabProps): Promise<JSX.Element> {
  const { params, perms, tenantId, canCreate, canEdit } = props;
  const tur = belgeTurOf(params.tur);
  const canInvoice = perms.commissions?.includes("create") ?? false;

  if (tur === "fatura") {
    const fp: FaturalarParams = {
      durum: params.durum,
      kaynak: params.kaynak,
      id: params.id,
      duzenle: params.duzenle,
      adet: params.adet,
      tutar: params.tutar,
      kdv: params.kdv,
      aciklama: params.aciklama,
      alici: params.alici,
    };
    return (
      <div className="flex flex-col gap-4">
        <SubviewChips active="fatura" />
        <FaturalarTab tenantId={tenantId} perms={perms} params={fp} embedded />
      </div>
    );
  }

  const adet = Math.min(Math.max(Math.trunc(Number(params.adet)) || PAGE, PAGE), MAX_PAGE);
  const supabase = await createClient();
  const head = () => supabase.from("finance_attachments").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  let list = supabase
    .from("finance_attachments")
    .select("id, entry_id, open_item_id, file_name, file_type, file_size, ocr_status, ocr_json, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(adet);
  if (tur === "fis") list = list.is("entry_id", null).is("open_item_id", null);

  const [listRes, inboxRes, allRes, ocrRes, settingsRes] = await Promise.all([
    list,
    head().is("entry_id", null).is("open_item_id", null),
    head(),
    head().is("entry_id", null).is("open_item_id", null).eq("ocr_status", "done"),
    supabase.from("finance_settings").select("ocr_enabled").eq("tenant_id", tenantId).maybeSingle(),
  ]);

  if (listRes.error) {
    const missing = isMissing(listRes.error);
    if (!missing) console.error("BelgelerTab list", { code: listRes.error.code });
    return (
      <div className="flex flex-col gap-4">
        <SubviewChips active={tur} />
        <EmptyState
          icon={FileText}
          title={missing ? "Belgeler henüz etkin değil" : "Belgeler şu an okunamadı"}
          description={missing ? "Veritabanı güncellemesi tamamlanınca fiş kutusu burada açılır. Faturalar görünümü şimdiden çalışır." : "Sayfayı yenileyip yeniden deneyin."}
          action={{ href: `${BASE}&tur=fatura`, label: "Faturalara git" }}
          tone="amber"
        />
      </div>
    );
  }

  const rows = (listRes.data ?? []) as AttachmentRow[];
  const entryIds = [...new Set(rows.map((r) => r.entry_id).filter((v): v is string => !!v))];
  const itemIds = [...new Set(rows.map((r) => r.open_item_id).filter((v): v is string => !!v))];
  const [entriesRes, itemsRes] = await Promise.all([
    entryIds.length
      ? supabase.from("cash_entries").select("id, title, amount, direction, counterparty, source_type, source_id, entry_date, vat_rate").eq("tenant_id", tenantId).in("id", entryIds)
      : Promise.resolve({ data: [] as EntryRow[], error: null }),
    itemIds.length
      ? supabase.from("finance_open_items").select("id, title, amount, direction").eq("tenant_id", tenantId).in("id", itemIds)
      : Promise.resolve({ data: [] as OpenItemRow[], error: null }),
  ]);
  const entries = new Map(((entriesRes.data ?? []) as EntryRow[]).map((e) => [e.id, e]));
  const openItems = new Map(((itemsRes.data ?? []) as OpenItemRow[]).map((o) => [o.id, o]));

  const items: InboxItem[] = rows.map((r) => {
    let link: InboxLink | null = null;
    const e = r.entry_id ? entries.get(r.entry_id) : undefined;
    const o = r.open_item_id ? openItems.get(r.open_item_id) : undefined;
    if (r.entry_id) {
      const title = e?.title || "Hareket";
      link = {
        kind: "entry",
        title,
        amount: e ? Number(e.amount) : null,
        incoming: e?.direction === "in",
        href: entryHref(title, e?.entry_date ?? null),
        invoiceHref: e && canInvoice ? invoiceHrefFor(e) : null,
      };
    } else if (r.open_item_id) {
      link = {
        kind: "open_item",
        title: o?.title || "Açık kalem",
        amount: o ? Number(o.amount) : null,
        incoming: o?.direction === "receivable",
        href: "/app/giderler?sekme=cari",
        invoiceHref: null,
      };
    }
    return {
      id: r.id,
      fileName: r.file_name || "Belge",
      fileType: r.file_type || "",
      fileSize: Number(r.file_size) || 0,
      createdAt: r.created_at,
      ocrStatus: r.ocr_status || "none",
      ocr: ocrFrom(r.ocr_json),
      link,
    };
  });

  const inboxCount = inboxRes.count ?? 0;
  const allCount = allRes.count ?? 0;
  const ocrCount = ocrRes.count ?? 0;
  const ocrEnabled = (settingsRes.data as { ocr_enabled?: boolean } | null)?.ocr_enabled === true;
  // Bağlama kapısı FN1 `finance_attachment_link` RPC ile aynı: expenses:edit.
  const canLink = canEdit;

  const kpis: KpiItem[] = [
    { label: "Fiş kutusunda", value: inboxCount, icon: <Inbox />, tone: inboxCount > 0 ? "info" : "neutral", href: `${BASE}&tur=fis`, hint: "kayda bağlanmayı bekliyor" },
    { label: "Okunan öneri", value: ocrEnabled ? ocrCount : "Kapalı", icon: <Sparkles />, tone: "neutral", href: ocrEnabled ? `${BASE}&tur=fis` : "/app/giderler?sekme=ayarlar", hint: ocrEnabled ? "fiş okuma önerisi hazır" : "Ayarlar'dan açılır" },
    { label: "Tüm belgeler", value: allCount, icon: <FileCheck2 />, tone: "neutral", href: `${BASE}&tur=tumu`, hint: "kayda bağlı ve kutuda" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <SubviewChips active={tur} counts={{ fis: inboxCount, tumu: allCount }} />
      <KpiStrip items={kpis} />
      <UploadDropzone canUpload={canCreate} compact={items.length > 0} />
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
        <ScanText className="h-3.5 w-3.5" aria-hidden="true" />
        {ocrEnabled
          ? "Fiş okuma açık: yüklenen fişin tutarı, tarihi, KDV oranı ve satıcısı ÖNERİ olarak doldurulur; siz Kaydet demeden kayıt oluşmaz."
          : "Fiş okuma kapalı (varsayılan). Açılırsa görseller yapay zekâ ile okunur ve yalnız öneri olarak doldurulur."}
        {!ocrEnabled && props.isOwnerGm ? (
          <Link href="/app/giderler?sekme=ayarlar" className="font-semibold text-accent-text hover:underline">
            Ayarlar
          </Link>
        ) : null}
      </p>
      {items.length === 0 ? (
        <EmptyState
          icon={tur === "fis" ? Inbox : Files}
          title={tur === "fis" ? "Fiş kutusu boş" : "Henüz belge yok"}
          description={
            tur === "fis"
              ? "Fişleri ve faturaları yukarıya bırakın ya da telefonla çekin; sonra bir harekete bağlayın veya fişten yeni kayıt açın."
              : "Yüklenen her fiş ve fatura burada görünür; harekete bağlananlar kaydına gider."
          }
          action={tur === "fis" && allCount > 0 ? { href: `${BASE}&tur=tumu`, label: "Tüm belgeleri göster" } : undefined}
          tone="brand"
        />
      ) : (
        <ReceiptInbox items={items} canLink={canLink} canCreate={canCreate} />
      )}
      {rows.length >= adet && adet < MAX_PAGE ? (
        <div className="text-center">
          <Link
            href={`${BASE}&tur=${tur}&adet=${adet + PAGE}`}
            className="focus-ring inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line px-4 text-sm font-semibold text-accent-text hover:border-brand-300"
          >
            Daha fazla göster ({adet} belge gösteriliyor)
          </Link>
        </div>
      ) : null}
    </div>
  );
}
