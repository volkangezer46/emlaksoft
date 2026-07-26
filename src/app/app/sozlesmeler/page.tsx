import Link from "next/link";
import { ArrowUpRight, CalendarRange, FileSignature } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitions } from "@/lib/definitions";
import { createClient } from "@/lib/supabase/server";
import { listContractTemplates } from "@/app/actions/contracts";
import { NewContractDialog } from "./new-contract-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const TYPE_LABELS: Record<string, string> = {
  satis:        "Satış",
  kira:         "Kira",
  sozlesme:     "Sözleşme",
  teklif:       "Teklif",
  yer_gosterme: "Yer gösterme",
  kapora:       "Kapora",
  diger:        "Diğer",
};

const STATUS_LABELS: Record<string, string> = {
  draft:     "Taslak",
  sent:      "Gönderildi",
  signed:    "İmzalandı",
  rejected:  "Reddedildi",
  cancelled: "İptal",
};

/** Durum → tasarım sistemi rozet tonu (palet dışı zinc/blue/emerald yerine). */
const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  draft:     "default",
  sent:      "info",
  signed:    "success",
  rejected:  "danger",
  cancelled: "outline",
};

function relativeDate(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "Bugün";
  if (d === 1) return "Dün";
  if (d < 30) return `${d} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

/**
 * Süresi 30 gün içinde dolacak sözleşme için kalan gün; değilse null.
 * İptal/red edilmişte yenileme uyarısının anlamı yok.
 */
function renewalDays(expiresAt: string | null, status: string) {
  if (!expiresAt || status === "cancelled" || status === "rejected") return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  return days >= 0 && days <= 30 ? days : null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `to` günü dahil olsun diye timestamptz karşılaştırmasında ertesi gün (hariç) kullanılır. */
function nextDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Boş olmayan paramlardan query string üretir — mevcut filtreler korunur. */
function qs(params: Record<string, string | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default async function SozlesmelerPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; customer?: string; property?: string; from?: string; to?: string }>;
}) {
  const { perms } = await requireModulePage("contracts");
  const params = (await searchParams) ?? {};
  // Filtre değerleri DB'deki gerçek durum enum'ları (draft/sent/signed/…)
  const durum = params.durum && STATUS_LABELS[params.durum] ? params.durum : null;
  const from = ISO_DATE.test(params.from ?? "") ? params.from! : null;
  const to = ISO_DATE.test(params.to ?? "") ? params.to! : null;

  // Mevcut filtreleri koruyan link üretici
  const href = (next: { durum?: string | null; from?: string | null; to?: string | null }) =>
    `/app/sozlesmeler${qs({
      durum: next.durum === undefined ? durum : next.durum,
      from: next.from === undefined ? from : next.from,
      to: next.to === undefined ? to : next.to,
    })}`;

  // Hızlı tarih çipleri — sunucu saatine göre
  const now = new Date();
  const presets = [
    { label: "Bu ay", from: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmtDate(now) },
    { label: "Geçen ay", from: fmtDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: fmtDate(new Date(now.getFullYear(), now.getMonth(), 0)) },
    { label: "Son 3 ay", from: fmtDate(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: fmtDate(now) },
  ];

  const supabase = await createClient();

  // Taraf/portföy hücre linkleri için ilişkili ID'ler de çekiliyor;
  // listContracts ID döndürmediği için sorgu burada.
  let contractQuery = supabase
    .from("contracts")
    .select(
      "id, title, contract_type, status, created_at, signed_at, expires_at, property:properties(id, property_code, title), customer:customers(id, full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (durum) contractQuery = contractQuery.eq("status", durum);
  // ?from=&to= sunucu filtresi — created_at aralığı, uç gün dahil
  if (from) contractQuery = contractQuery.gte("created_at", from);
  if (to) contractQuery = contractQuery.lt("created_at", nextDay(to));

  const [{ data: contractData }, { data: statusData }, contractTypeDefs, templates] = await Promise.all([
    contractQuery,
    // KPI sayıları filtreden bağımsız
    supabase.from("contracts").select("status").limit(1000),
    getDefinitions("contract_type"),
    // "Şablondan başla" galerisi — global hazır şablonlar + ofis şablonları
    listContractTemplates(),
  ]);

  const canCreate = perms.contracts?.includes("create") ?? false;
  const contractTypeOptions = contractTypeDefs.length
    ? contractTypeDefs.map((d) => ({ value: d.value, label: d.label }))
    : undefined;

  const contracts = (contractData ?? []).map((c) => {
    const p = one(c.property as { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null);
    const cu = one(c.customer as { id: string; full_name: string } | { id: string; full_name: string }[] | null);
    return {
      id: c.id as string,
      title: c.title as string,
      contract_type: c.contract_type as string,
      status: c.status as string,
      created_at: c.created_at as string,
      signed_at: c.signed_at as string | null,
      expires_at: c.expires_at as string | null,
      property_id: p?.id ?? null,
      property_label: p ? (p.title ?? p.property_code) : null,
      customer_id: cu?.id ?? null,
      customer_name: cu?.full_name ?? null,
    };
  });

  const statuses = (statusData ?? []).map((r) => r.status as string);
  const total   = statuses.length;
  const signed  = statuses.filter((s) => s === "signed").length;
  const pending = statuses.filter((s) => s === "sent").length;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-brand-500/25 blur-[90px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <FileSignature className="h-4 w-4" /> Sözleşmeler
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">
              Sözleşme &amp; E-İmza
            </h1>
            <p className="mt-1 max-w-lg text-sm text-white/75">
              Kira, satış ve diğer sözleşme taslakları oluşturun. İmza linki ile dijital onay alın.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {/* KPI'lar durum filtresine bağlı (tarih aralığı korunur) */}
            {[
              { label: "Toplam", value: total, href: href({ durum: null }), active: durum === null },
              { label: "İmzalandı", value: signed, href: href({ durum: "signed" }), active: durum === "signed" },
              { label: "İmza bekliyor", value: pending, href: href({ durum: "sent" }), active: durum === "sent" },
            ].map((k) => (
              <Link
                key={k.label}
                href={k.href}
                className={`focus-ring press lift group block rounded-[14px] border p-3 transition hover:border-brand-300 ${
                  k.active ? "border-white/35 bg-white/15" : "border-white/12 bg-white/8"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-2xl font-extrabold text-white">{k.value}</span>
                  <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </span>
                <p className="text-[11px] text-white/70">{k.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Üst toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">{total} sözleşme</p>
        {canCreate && <NewContractDialog contractTypes={contractTypeOptions} templates={templates} />}
      </div>

      {/* Liste */}
      {total === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="Henüz sözleşme yok"
          description="İlk sözleşme taslağınızı oluşturun, imzalayanları ekleyin ve dijital onay alın."
          tone="brand"
          action={canCreate ? { label: "Yeni sözleşme", node: <NewContractDialog contractTypes={contractTypeOptions} templates={templates} /> } : undefined}
        />
      ) : (
        <>
          {/* Durum filtre çipleri — sunucu filtresi (?durum=), tarih aralığı korunur */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={href({ durum: null })}
              className={`rounded-[10px] border px-3.5 py-2 text-xs font-semibold transition ${
                durum === null
                  ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                  : "border-line bg-surface text-ink-950 hover:border-brand-300"
              }`}
            >
              Tümü
            </Link>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <Link
                key={value}
                href={href({ durum: value })}
                className={`rounded-[10px] border px-3.5 py-2 text-xs font-semibold transition ${
                  durum === value
                    ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                    : "border-line bg-surface text-ink-950 hover:border-brand-300"
                }`}
              >
                {label}
              </Link>
            ))}
            <span className="numeric ml-auto text-[11px] font-medium tracking-wide text-text-faint">
              {contracts.length} kayıt
            </span>
          </div>

          {/* Tarih aralığı çipleri — sunucu filtresi (?from=&to=), durum korunur */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-text-muted"><CalendarRange className="h-3.5 w-3.5" /> Tarih:</span>
            <Link
              href={href({ from: null, to: null })}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                !from && !to
                  ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                  : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
              }`}
            >
              Tüm zamanlar
            </Link>
            {presets.map((p) => {
              const active = from === p.from && to === p.to;
              return (
                <Link
                  key={p.label}
                  href={href({ from: p.from, to: p.to })}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                    active
                      ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                      : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
                  }`}
                >
                  {p.label}
                </Link>
              );
            })}
          </div>

          {contracts.length === 0 ? (
            <div className="grid place-items-center rounded-[18px] border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
              <FileSignature className="h-8 w-8 text-text-faint" />
              <h2 className="mt-3 font-display text-lg font-bold text-ink-950">
                {durum ? `“${STATUS_LABELS[durum]}” durumunda sözleşme yok` : "Bu filtrelerle eşleşen sözleşme yok"}
              </h2>
              <Link href="/app/sozlesmeler" className="mt-2 text-sm font-semibold text-brand-600 hover:underline">
                Filtreleri temizle
              </Link>
            </div>
          ) : (
            <TableFrame minWidth={760}>
              <Table>
                <THead>
                  <TR>
                    <TH>Sözleşme</TH>
                    <TH>Tür</TH>
                    <TH>Durum</TH>
                    <TH>Taraf</TH>
                    <TH>Tarih</TH>
                  </TR>
                </THead>
                <TBody>
                  {contracts.map((c) => {
                    const kalanGun = renewalDays(c.expires_at, c.status);
                    return (
                      <TR key={c.id} interactive>
                        <TD className="font-semibold text-ink-950">
                          {/* Satır → sözleşme detayı; portföy/taraf linkleri z-10 ile üstte */}
                          <Link
                            href={`/app/sozlesmeler/${c.id}`}
                            className="absolute inset-0"
                            aria-label={`${c.title} detayları`}
                          />
                          {c.title}
                          {c.property_id ? (
                            <Link
                              href={`/app/portfoyler/${c.property_id}`}
                              className="focus-ring relative z-10 mt-0.5 block w-fit rounded-[6px] text-[11px] font-normal text-text-faint transition hover:text-brand-600 hover:underline"
                            >
                              {c.property_label}
                            </Link>
                          ) : c.property_label ? (
                            <span className="mt-0.5 block text-[11px] font-normal text-text-faint">{c.property_label}</span>
                          ) : null}
                        </TD>
                        <TD>
                          <Badge variant="outline" size="sm">
                            {TYPE_LABELS[c.contract_type] ?? c.contract_type}
                          </Badge>
                        </TD>
                        <TD>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={STATUS_VARIANTS[c.status] ?? "default"} size="sm">
                              {STATUS_LABELS[c.status] ?? c.status}
                            </Badge>
                            {kalanGun != null ? (
                              <Badge variant="warning" size="sm">
                                Yenileme yaklaşıyor · {kalanGun === 0 ? "bugün" : `${kalanGun} gün`}
                              </Badge>
                            ) : null}
                          </span>
                        </TD>
                        <TD>
                          {c.customer_id ? (
                            <Link
                              href={`/app/musteriler/${c.customer_id}`}
                              className="focus-ring relative z-10 rounded-[6px] font-medium text-ink-950 transition hover:text-brand-600 hover:underline"
                            >
                              {c.customer_name ?? "Müşteri"}
                            </Link>
                          ) : (
                            c.customer_name ?? "—"
                          )}
                        </TD>
                        <TD className="text-text-muted">
                          {c.status === "signed" && c.signed_at
                            ? `İmzalandı: ${relativeDate(c.signed_at)}`
                            : relativeDate(c.created_at)}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableFrame>
          )}
        </>
      )}

      {/* Bilgi kutusu */}
      <section className="rounded-[16px] border border-dashed border-line-strong bg-surface px-5 py-4 text-sm text-text-muted">
        <p className="font-semibold text-ink-950">E-imza nasıl çalışır?</p>
        <p className="mt-1">
          Sözleşme taslağı oluşturun → imzalayan kişileri ekleyin → sistem benzersiz bir imza linki oluşturur →
          kişi linke tıklayıp onayladığında sözleşme “İmzalandı” durumuna geçer.
          Tüm imzalayanlar onayladığında sözleşme tamamlanır.
        </p>
      </section>
    </div>
  );
}
