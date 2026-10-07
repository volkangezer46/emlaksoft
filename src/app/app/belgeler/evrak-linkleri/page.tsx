import { batchAll } from "@/lib/supabase/query-batch";
import Link from "@/components/ui/smart-link";
import { ArrowLeft, FileUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { isDocOcrConfigured } from "@/lib/ai/document-ocr";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { formatBytes } from "@/lib/documents";
import { formatDateTr } from "@/lib/format";
import { now } from "@/lib/clock";
import {
  DOC_REQUEST_STATUS_LABELS,
  DOC_TYPE_LABELS,
  displayStatus,
  isDocType,
  isOcrEligible,
  missingTypes,
} from "@/lib/doc-request/doc-request";
import { FileActions, NewRequestForm, RevokeButton } from "./evrak-forms";

export const metadata = { title: "Evrak linkleri" };

const BASE = "/app/belgeler/evrak-linkleri";
const PAGE_SIZE = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DURUMLAR = ["acik", "bekleyen", "tamamlandi", "kapali"] as const;
type Durum = (typeof DURUMLAR)[number];
const DURUM_LABELS: Record<Durum, string> = {
  acik: "Açık linkler",
  bekleyen: "Dosya bekleyen",
  tamamlandi: "Tamamlanan",
  kapali: "İptal / süresi dolan",
};
const STATUS_BADGE: Record<string, BadgeVariant> = {
  active: "info",
  completed: "success",
  revoked: "neutral",
  expired: "warning",
  full: "warning",
};

type Rel<T> = T | T[] | null;
type RequestRow = {
  id: string;
  title: string;
  requested_types: string[];
  status: string;
  expires_at: string;
  file_count: number;
  max_files: number;
  created_at: string;
  customer: Rel<{ id: string; full_name: string }>;
  property: Rel<{ id: string; title: string | null }>;
};
type FileRow = {
  id: string;
  request_id: string;
  doc_type: string;
  file_name: string;
  file_size: number;
  mime_type: string;
};
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

function href(p: { durum?: string; sayfa?: number; musteri?: string; portfoy?: string }) {
  const q = new URLSearchParams();
  if (p.durum) q.set("durum", p.durum);
  if (p.musteri) q.set("musteri", p.musteri);
  if (p.portfoy) q.set("portfoy", p.portfoy);
  if (p.sayfa && p.sayfa > 1) q.set("sayfa", String(p.sayfa));
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

/**
 * Evrak linkleri: ofis, müşteri/maliklerden evrak toplamak için süreli, sınırlı, tokenli
 * yükleme linki üretir. Dosyalar özel depoda kalır; yalnız bu ofisin personeli indirir.
 */
export default async function EvrakLinkleriPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; sayfa?: string; musteri?: string; portfoy?: string }>;
}) {
  await requireModulePage("customers", BASE);
  const sp = (await searchParams) ?? {};
  const durum = (DURUMLAR as readonly string[]).includes(sp.durum ?? "") ? (sp.durum as Durum) : "";
  const musteri = UUID_RE.test(sp.musteri ?? "") ? (sp.musteri as string) : "";
  const portfoy = UUID_RE.test(sp.portfoy ?? "") ? (sp.portfoy as string) : "";
  const sayfaN = Number(sp.sayfa);
  const sayfa = Number.isInteger(sayfaN) && sayfaN >= 1 && sayfaN <= 10_000 ? sayfaN : 1;
  const supabase = await createClient();
  const nowIso = new Date(now()).toISOString();

  const probe = await supabase.from("document_requests").select("id", { count: "exact", head: true });
  const header = (
    <>
      <Link href="/app/belgeler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Belge Merkezi
      </Link>
      <PageHeader
        title="Evrak linkleri"
        eyebrow="Müşteri ve malik evrakı"
        icon={<FileUp className="h-6 w-6" />}
        description="Müşteriden veya maliklerden evrak toplamak için süreli, sınırlı bir link üretin; link panelde kopyalanır, SMS gönderilmez."
        className="mb-0"
      />
    </>
  );
  if (probe.error) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="warning" title="Evrak linkleri bu ortamda henüz etkin değil">
          Veritabanı güncellemesi uygulandığında bu sayfa otomatik çalışır; Belge Merkezi etkilenmez.
        </Alert>
      </div>
    );
  }

  const base = () => supabase.from("document_requests").select("id", { count: "exact", head: true });
  const filters = {
    acik: (q: ReturnType<typeof base>) => q.eq("status", "active").gt("expires_at", nowIso),
    bekleyen: (q: ReturnType<typeof base>) => q.eq("status", "active").gt("expires_at", nowIso).eq("file_count", 0),
    tamamlandi: (q: ReturnType<typeof base>) => q.eq("status", "completed"),
    kapali: (q: ReturnType<typeof base>) => q.or(`status.eq.revoked,and(status.eq.active,expires_at.lte.${nowIso})`),
  };

  const from = (sayfa - 1) * PAGE_SIZE;
  let list = supabase
    .from("document_requests")
    .select(
      "id, title, requested_types, status, expires_at, file_count, max_files, created_at, customer:customers!document_requests_customer_id_fkey(id, full_name), property:properties!document_requests_property_id_fkey(id, title)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (durum === "acik") list = list.eq("status", "active").gt("expires_at", nowIso);
  if (durum === "bekleyen") list = list.eq("status", "active").gt("expires_at", nowIso).eq("file_count", 0);
  if (durum === "tamamlandi") list = list.eq("status", "completed");
  if (durum === "kapali") list = list.or(`status.eq.revoked,and(status.eq.active,expires_at.lte.${nowIso})`);
  if (musteri) list = list.eq("customer_id", musteri);
  if (portfoy) list = list.eq("property_id", portfoy);

  const [listRes, totalRes, acikRes, bekleyenRes, tamamRes, kapaliRes, prefillCustomerRes, prefillPropertyRes] = await batchAll("Evrak linkleri", [], [
    list,
    base(),
    filters.acik(base()),
    filters.bekleyen(base()),
    filters.tamamlandi(base()),
    filters.kapali(base()),
    // Müşteri/portföy seçicileri sunucu taraflı aranır (searchCustomers/searchProperties);
    // yalnız ?musteri=/?portfoy= ön dolgusu tek kayıt olarak gelir (RLS kiracı süzgeci).
    musteri
      ? supabase.from("customers").select("id, full_name").eq("id", musteri).is("deleted_at", null).maybeSingle()
      : Promise.resolve({ data: null }),
    portfoy
      ? supabase.from("properties").select("id, title, property_code").eq("id", portfoy).is("deleted_at", null).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const rows = (listRes.data ?? []) as unknown as RequestRow[];
  const matched = listRes.count ?? 0;
  const lastPage = Math.max(1, Math.ceil(matched / PAGE_SIZE));
  const filesByRequest = new Map<string, FileRow[]>();
  if (rows.length) {
    const { data: files } = await supabase
      .from("document_request_files")
      .select("id, request_id, doc_type, file_name, file_size, mime_type")
      .in("request_id", rows.map((r) => r.id))
      .eq("status", "verified")
      .order("created_at", { ascending: true });
    for (const f of (files ?? []) as FileRow[]) {
      const arr = filesByRequest.get(f.request_id) ?? [];
      arr.push(f);
      filesByRequest.set(f.request_id, arr);
    }
  }
  const ocrEnabled = isDocOcrConfigured();
  const nowMs = now();
  const filterActive = Boolean(durum || musteri || portfoy);

  return (
    <div className="space-y-6">
      {header}

      <StatRow
        items={[
          { label: "Tüm linkler", value: totalRes.count ?? 0, href: BASE },
          { label: "Açık linkler", value: acikRes.count ?? 0, href: href({ durum: "acik" }) },
          { label: "Dosya bekleyen", value: bekleyenRes.count ?? 0, href: href({ durum: "bekleyen" }), attention: true },
          { label: "Tamamlanan", value: tamamRes.count ?? 0, href: href({ durum: "tamamlandi" }) },
          { label: "İptal / süresi dolan", value: kapaliRes.count ?? 0, href: href({ durum: "kapali" }) },
        ]}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Yeni evrak linki</CardTitle>
            <CardDescription>
              Link yalnız bir kez gösterilir. Kaybederseniz iptal edip yenisini üretin. Kimlik belgeleri okuma (OCR) özelliğine gönderilmez.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <NewRequestForm
            prefillCustomer={prefillCustomerRes.data ?? null}
            prefillProperty={prefillPropertyRes.data ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Linkler{durum ? ` · ${DURUM_LABELS[durum]}` : ""}</CardTitle>
            <CardDescription>
              {matched} kayıt
              {filterActive ? (
                <>
                  {" · "}
                  <Link href={BASE} className="font-semibold text-brand-600 hover:underline">Filtreyi temizle</Link>
                </>
              ) : null}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              variant="compact"
              bare
              icon={FileUp}
              tone={filterActive ? "brand" : "mint"}
              title={filterActive ? "Bu süzgeçle evrak linki yok" : "Henüz evrak linki yok"}
              description={
                filterActive
                  ? "Durum veya müşteri süzgecini kaldırıp tüm linkleri görün."
                  : "Müşteriden kimlik, tapu veya vekâlet gibi evrakı güvenli bağlantıyla isteyin; yüklenen dosyalar müşteri kartına bağlanır."
              }
              action={filterActive ? { href: BASE, label: "Filtreyi temizle" } : { href: "/app/belgeler", label: "Belge Merkezi" }}
            />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const cust = one(r.customer);
                const prop = one(r.property);
                const files = filesByRequest.get(r.id) ?? [];
                const state = displayStatus(r, nowMs);
                const missing = missingTypes(r.requested_types, files.map((f) => f.doc_type));
                const active = state === "active";
                return (
                  <li key={r.id} className="space-y-3 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink-950">{r.title}</p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {cust ? (
                            <Link href={`/app/musteriler/${cust.id}`} className="font-semibold text-brand-600 hover:underline">{cust.full_name}</Link>
                          ) : null}
                          {cust && prop ? " · " : null}
                          {prop ? (
                            <Link href={`/app/portfoyler/${prop.id}`} className="font-semibold text-brand-600 hover:underline">{prop.title ?? "Portföy"}</Link>
                          ) : null}
                          {cust || prop ? " · " : null}
                          Son geçerlilik {formatDateTr(r.expires_at)} · {r.file_count}/{r.max_files} dosya
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <Badge variant={STATUS_BADGE[state] ?? "neutral"} size="sm">{DOC_REQUEST_STATUS_LABELS[state]}</Badge>
                          {missing.map((t) => (
                            <Badge key={t} variant="warning" size="sm">Eksik: {DOC_TYPE_LABELS[t]}</Badge>
                          ))}
                        </div>
                      </div>
                      {active ? <RevokeButton id={r.id} /> : null}
                    </div>
                    {files.length > 0 ? (
                      <ul className="space-y-2 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
                        {files.map((f) => (
                          <li key={f.id} className="space-y-1">
                            <p className="text-xs font-semibold text-ink-950">
                              {isDocType(f.doc_type) ? DOC_TYPE_LABELS[f.doc_type] : f.doc_type}
                              <span className="ml-2 font-normal text-text-muted">{f.file_name} · {formatBytes(Number(f.file_size))}</span>
                            </p>
                            <FileActions
                              fileId={f.id}
                              fileName={f.file_name}
                              ocrEligible={isOcrEligible(f.doc_type, f.mime_type)}
                              ocrEnabled={ocrEnabled}
                              hasProperty={Boolean(prop)}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {lastPage > 1 ? (
            <nav aria-label="Sayfalama" className="mt-4 flex items-center justify-between text-sm">
              {sayfa > 1 ? (
                <ButtonLink href={href({ durum, musteri, portfoy, sayfa: sayfa - 1 })} variant="secondary" size="sm">Önceki</ButtonLink>
              ) : <span />}
              <span className="text-text-muted">Sayfa {sayfa} / {lastPage}</span>
              {sayfa < lastPage ? (
                <ButtonLink href={href({ durum, musteri, portfoy, sayfa: sayfa + 1 })} variant="secondary" size="sm">Sonraki</ButtonLink>
              ) : <span />}
            </nav>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
