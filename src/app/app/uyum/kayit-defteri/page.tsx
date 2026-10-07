import { batchAll } from "@/lib/supabase/query-batch";
import Link from "@/components/ui/smart-link";
import { ArrowLeft, BookLock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { exportLedgerCsv } from "@/app/actions/compliance-ledger";
import { trDayKey } from "@/lib/clock";
import { formatDateTr, formatTryAmount } from "@/lib/format";
import {
  DEFAULT_LEDGER_THRESHOLDS,
  LEDGER_DISCLAIMER,
  LEDGER_FLAG_LABELS,
  LEDGER_METHOD_LABELS,
  LEDGER_PAGE_SIZE,
  LEDGER_PARTY_LABELS,
  LEDGER_TX_LABELS,
  LEDGER_TX_TYPES,
  parseLedgerFilters,
  type LedgerFlag,
  type LedgerMethod,
  type LedgerPartyRole,
  type LedgerTxType,
} from "@/lib/compliance/ledger";
import { LedgerEntryForm, LedgerSettingsForm, type CorrectionDefaults } from "./ledger-forms";

export const metadata = { title: "Yasal kayıt defteri" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE = "/app/uyum/kayit-defteri";
const FILTER_LABELS = {
  isaretli: "Eşik üstü işaretli",
  kimliksiz: "Kimlik görüldü işaretsiz",
  nakit: "Nakit işlemler",
  suredoldu: "Saklama süresi dolmuş",
} as const;

type EntryRow = {
  id: string;
  kind: string;
  corrects_entry_id: string | null;
  transaction_type: LedgerTxType;
  transaction_date: string;
  party_name: string;
  party_role: LedgerPartyRole;
  counterparty_name: string | null;
  identity_checked: boolean;
  amount_try: number | string;
  payment_method: LedgerMethod;
  flags: string[] | null;
  retain_until: string;
  note: string | null;
  created_by: string;
  created_at: string;
};

function href(params: { filtre?: string; tur?: string; sayfa?: number; duzelt?: string }) {
  const q = new URLSearchParams();
  if (params.filtre) q.set("filtre", params.filtre);
  if (params.tur) q.set("tur", params.tur);
  if (params.sayfa && params.sayfa > 1) q.set("sayfa", String(params.sayfa));
  if (params.duzelt) q.set("duzelt", params.duzelt);
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

/**
 * Yasal kayıt defteri: ekle-yalnız kayıt (düzeltme yeni kayıttır), ofis eşikleriyle işaretleme, CSV.
 * Ofis sahibi / genel müdür tüm ofisi görür; diğer roller yalnız kendi kayıtlarını (RLS de zorlar).
 */
export default async function LedgerPage({
  searchParams,
}: {
  searchParams?: Promise<{ filtre?: string; tur?: string; sayfa?: string; duzelt?: string }>;
}) {
  const { role } = await requireModulePage("compliance", "/app/uyum");
  const sp = (await searchParams) ?? {};
  const f = parseLedgerFilters(sp);
  const officeLevel = role === "owner" || role === "gm";
  const today = trDayKey();
  const supabase = await createClient();

  const settingsRes = await supabase
    .from("compliance_ledger_settings")
    .select("cash_threshold_try, amount_threshold_try, retention_years")
    .maybeSingle();
  const entriesProbe = await supabase
    .from("compliance_ledger_entries")
    .select("id", { count: "exact", head: true });
  const supported = !settingsRes.error && !entriesProbe.error;

  const header = (
    <>
      <Link href="/app/uyum" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> KVKK ve uyum
      </Link>
      <PageHeader
        title="Yasal kayıt defteri"
        eyebrow="İşlem kaydı"
        icon={<BookLock className="h-6 w-6" />}
        description="İşlem kayıtları yalnız eklenir, değiştirilemez; düzeltme yeni kayıt olarak girilir. Kimlik numarası saklanmaz."
        className="mb-0"
      />
    </>
  );

  if (!supported) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="warning" title="Yasal kayıt defteri bu ortamda henüz etkin değil">
          Veritabanı güncellemesi uygulandığında bu sayfa otomatik çalışır; mevcut uyum sayfaları etkilenmez.
        </Alert>
      </div>
    );
  }

  const thresholds = settingsRes.data
    ? {
        cash: Number(settingsRes.data.cash_threshold_try),
        amount: Number(settingsRes.data.amount_threshold_try),
        years: Number(settingsRes.data.retention_years),
      }
    : {
        cash: DEFAULT_LEDGER_THRESHOLDS.cashThresholdTry,
        amount: DEFAULT_LEDGER_THRESHOLDS.amountThresholdTry,
        years: DEFAULT_LEDGER_THRESHOLDS.retentionYears,
      };

  const from = (f.sayfa - 1) * LEDGER_PAGE_SIZE;
  let listQuery = supabase
    .from("compliance_ledger_entries")
    .select(
      "id, kind, corrects_entry_id, transaction_type, transaction_date, party_name, party_role, counterparty_name, identity_checked, amount_try, payment_method, flags, retain_until, note, created_by, created_at",
      { count: "exact" },
    )
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + LEDGER_PAGE_SIZE - 1);
  if (f.tur) listQuery = listQuery.eq("transaction_type", f.tur);
  if (f.filtre === "isaretli") listQuery = listQuery.overlaps("flags", ["cash_over_threshold", "amount_over_threshold"]);
  if (f.filtre === "kimliksiz") listQuery = listQuery.eq("identity_checked", false);
  if (f.filtre === "nakit") listQuery = listQuery.eq("payment_method", "cash");
  if (f.filtre === "suredoldu") listQuery = listQuery.lt("retain_until", today);

  const base = () => supabase.from("compliance_ledger_entries").select("id", { count: "exact", head: true });
  const count = (build: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => build(base());

  const correctId = typeof sp.duzelt === "string" && UUID_RE.test(sp.duzelt) ? sp.duzelt : "";
  const [listRes, totalRes, flaggedRes, noIdRes, cashRes, expiredRes, correctionRes] = await batchAll("Uyum kayıt defteri", [], [
    listQuery,
    count((q) => q),
    count((q) => q.overlaps("flags", ["cash_over_threshold", "amount_over_threshold"])),
    count((q) => q.eq("identity_checked", false)),
    count((q) => q.eq("payment_method", "cash")),
    count((q) => q.lt("retain_until", today)),
    correctId
      ? supabase
          .from("compliance_ledger_entries")
          .select("id, transaction_type, transaction_date, party_name, party_role, counterparty_name, identity_checked, amount_try, payment_method")
          .eq("id", correctId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const rows = (listRes.data ?? []) as unknown as EntryRow[];
  const matched = listRes.count ?? 0;
  const lastPage = Math.max(1, Math.ceil(matched / LEDGER_PAGE_SIZE));

  const creatorIds = [...new Set(rows.map((r) => r.created_by))];
  const names = new Map<string, string>();
  if (creatorIds.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", creatorIds);
    for (const p of profiles ?? []) names.set(p.id, p.full_name);
  }

  const filterActive = Boolean(f.filtre || f.tur);
  const scopeLabel = officeLevel ? "Ofisin tüm kayıtları" : "Yalnız sizin kayıtlarınız";

  return (
    <div className="space-y-6">
      {header}

      <Alert tone="info" title="Hukuki danışmanlık değildir">
        {LEDGER_DISCLAIMER}
      </Alert>

      <StatRow
        items={[
          { label: "Tüm kayıtlar", value: totalRes.count ?? 0, href: BASE, hint: scopeLabel },
          { label: "Eşik üstü işaretli", value: flaggedRes.count ?? 0, href: href({ filtre: "isaretli" }), attention: true },
          { label: "Kimlik görüldü işaretsiz", value: noIdRes.count ?? 0, href: href({ filtre: "kimliksiz" }), attention: true },
          { label: "Nakit işlemler", value: cashRes.count ?? 0, href: href({ filtre: "nakit" }) },
          { label: "Saklama süresi dolmuş", value: expiredRes.count ?? 0, href: href({ filtre: "suredoldu" }), hint: "ofis ayarına göre" },
        ]}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{correctionRes.data ? "Düzeltme kaydı" : "Yeni kayıt"}</CardTitle>
            <CardDescription>
              {correctionRes.data ? (
                <>
                  Seçili kayıt değişmez; bu form yeni bir düzeltme kaydı ekler.{" "}
                  <Link href={BASE} className="font-semibold text-brand-600 hover:underline">Vazgeç</Link>
                </>
              ) : (
                "Her kayıt sizin adınıza eklenir. Kimlik numarası veya fotokopisi bu deftere girilmez."
              )}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <LedgerEntryForm
            todayIso={today}
            correction={(correctionRes.data as CorrectionDefaults | null) ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>
                Kayıtlar{f.filtre ? ` · ${FILTER_LABELS[f.filtre]}` : ""}{f.tur ? ` · ${LEDGER_TX_LABELS[f.tur]}` : ""}
              </CardTitle>
              <CardDescription>
                {scopeLabel} · {matched} kayıt
                {filterActive ? (
                  <>
                    {" · "}
                    <Link href={BASE} className="font-semibold text-brand-600 hover:underline">Filtreyi temizle</Link>
                  </>
                ) : null}
              </CardDescription>
            </div>
            {officeLevel ? <ExportCsvButton label="CSV indir" action={exportLedgerCsv} /> : null}
          </div>
        </CardHeader>
        <CardContent>
          <nav aria-label="İşlem türü filtresi" className="mb-4 flex flex-wrap gap-2">
            {LEDGER_TX_TYPES.map((t) => (
              <Link
                key={t}
                href={href({ filtre: f.filtre, tur: f.tur === t ? "" : t })}
                aria-current={f.tur === t ? "true" : undefined}
                className={`focus-ring rounded-full px-3 py-1 text-xs font-semibold transition ${
                  f.tur === t ? "bg-brand-600 text-white" : "bg-canvas text-text-muted hover:text-brand-600"
                }`}
              >
                {LEDGER_TX_LABELS[t]}
              </Link>
            ))}
          </nav>

          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              {filterActive
                ? "Bu filtreyle kayıt yok."
                : "Defterde henüz kayıt yok. İlk işlemi yukarıdaki formdan ekleyin."}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="grid gap-2 py-3 md:grid-cols-[1.4fr_1fr_auto] md:items-start">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-950">
                      {LEDGER_TX_LABELS[r.transaction_type] ?? r.transaction_type} · {r.party_name}
                      <span className="ml-2 text-xs font-normal text-text-muted">
                        {LEDGER_PARTY_LABELS[r.party_role] ?? r.party_role}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {formatDateTr(r.transaction_date)} · {LEDGER_METHOD_LABELS[r.payment_method] ?? r.payment_method} ·
                      Kaydeden: {names.get(r.created_by) ?? "—"}
                    </p>
                    {r.note ? <p className="mt-1 text-xs text-text-muted">{r.note}</p> : null}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {r.kind === "correction" ? <Badge variant="info" size="sm">Düzeltme kaydı</Badge> : null}
                      {(r.flags ?? []).map((flag) => (
                        <Badge key={flag} variant={flag === "identity_not_checked" ? "neutral" : "warning"} size="sm">
                          {LEDGER_FLAG_LABELS[flag as LedgerFlag] ?? flag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="text-sm">
                    <p className="font-semibold text-ink-950">{formatTryAmount(Number(r.amount_try))}</p>
                    <p className="text-xs text-text-muted">Saklama bitişi: {formatDateTr(r.retain_until)}</p>
                  </div>
                  <Link
                    href={`${href({ filtre: f.filtre, tur: f.tur, sayfa: f.sayfa, duzelt: r.id })}`}
                    className="focus-ring text-xs font-semibold text-brand-600 hover:underline"
                  >
                    Düzeltme kaydı ekle
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {lastPage > 1 ? (
            <nav aria-label="Sayfalama" className="mt-4 flex items-center justify-between text-sm">
              {f.sayfa > 1 ? (
                <ButtonLink href={href({ filtre: f.filtre, tur: f.tur, sayfa: f.sayfa - 1 })} variant="secondary" size="sm">Önceki</ButtonLink>
              ) : <span />}
              <span className="text-text-muted">Sayfa {f.sayfa} / {lastPage}</span>
              {f.sayfa < lastPage ? (
                <ButtonLink href={href({ filtre: f.filtre, tur: f.tur, sayfa: f.sayfa + 1 })} variant="secondary" size="sm">Sonraki</ButtonLink>
              ) : <span />}
            </nav>
          ) : null}
        </CardContent>
      </Card>

      {officeLevel ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Ofis ayarları</CardTitle>
              <CardDescription>
                Eşikler ve saklama süresi sizin ayarınızdır; mevzuattaki değerler değildir. Değişiklik yalnız yeni kayıtları etkiler.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <LedgerSettingsForm cash={thresholds.cash} amount={thresholds.amount} years={thresholds.years} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
