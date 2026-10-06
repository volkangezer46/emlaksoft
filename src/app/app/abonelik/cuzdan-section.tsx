import Link from "next/link";
import { ArrowUpRight, CalendarClock, Clock3, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableEmptyRow, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { now } from "@/lib/clock";
import { readTryMovements, readTryOverview } from "@/lib/try-credits/reader";
import {
  TRY_WALLET_LINKS,
  describeMovement,
  expiryText,
  formatShare,
  formatTry,
  invoiceLink,
  summarizeWallet,
} from "@/lib/try-credits/view";
import { fullCreditEnabled } from "@/lib/try-credits/invoice-credit";
import { stackedBalance } from "@/lib/ef-credits/balance-viz";
import { StackedBalance } from "./stacked-balance";
import type { SupabaseClient } from "@supabase/supabase-js";

const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
const BASE = "/app/abonelik";

const DIRECTIONS = [
  { id: "hepsi", label: "Tümü" },
  { id: "giren", label: "Yüklenen" },
  { id: "cikan", label: "Kullanılan / geri alınan" },
] as const;
export type WalletDirection = (typeof DIRECTIONS)[number]["id"];

export function resolveDirection(raw: string | undefined): WalletDirection {
  return DIRECTIONS.some((d) => d.id === raw) ? (raw as WalletDirection) : "hepsi";
}

function hrefOf(yon: WalletDirection): string {
  const sp = new URLSearchParams({ sekme: "cuzdan" });
  if (yon !== "hepsi") sp.set("yon", yon);
  return `${BASE}?${sp.toString()}#hareketler`;
}

/**
 * Cüzdan sekmesi: TL hesap kredisi bakiyesi, açık rezervler (bekleyen ödemeler), vade, hareketler ve "kredi ile öde" göstergesi.
 * Okuma oturumlu (RLS'li) istemciyle yapılır; SQL henüz uygulanmamışsa "etkin değil" boş durumu gösterilir.
 * Her sayı/kart tıklanabilir ve ilgili hedefe (paketler, koltuk, faturalar, süzülmüş hareketler) götürür.
 */
export async function CuzdanSection({
  supabase,
  maxShare,
  yon,
  canSpend,
}: {
  supabase: SupabaseClient;
  maxShare: number;
  yon?: string;
  /** Faturada kredi kullanabilecek roller (owner/gm). */
  canSpend: boolean;
}) {
  // Hesap kredisi ofis geneli finans verisidir: yalnız ofis sahibi ve genel müdür görür (okuma bile yapılmaz).
  if (!canSpend) {
    return (
      <section className="rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-1)]">
        <EmptyState
          variant="full"
          icon={Wallet}
          title="Hesap kredisi bu rol için kapalı"
          description="Yalnız ofis sahibi ve genel müdür görür."
          action={{ href: "/app/abonelik", label: "Aboneliğe dön" }}
        />
      </section>
    );
  }
  const [overview, movements] = await Promise.all([readTryOverview(supabase), readTryMovements(supabase)]);
  const direction = resolveDirection(yon);

  if (!overview) {
    return (
      <section className="rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-1)]">
        <EmptyState
          variant="full"
          icon={Wallet}
          title="Hesap kredisi henüz etkin değil"
          description="Davet ödülleri, kampanya ve iade kredileri etkinleşince bakiyeniz burada görünür ve paket, ek kullanıcı ve kontör faturalarınızda kullanılır."
          action={{ href: TRY_WALLET_LINKS.invoices, label: "Faturalarıma git" }}
        />
      </section>
    );
  }

  const nowMs = now();
  const summary = summarizeWallet(overview, nowMs);
  const rows = movements
    .map(describeMovement)
    .filter((m) => direction === "hepsi" || (direction === "giren" ? m.kind === "in" : m.kind === "out"));
  const full = fullCreditEnabled(maxShare);
  const stacked = stackedBalance({ available: summary.availableTry, reserved: summary.reservedTry, spent: overview.spent_total });
  const stackedLabels = { available: "Kullanılabilir", reserved: "Bekleyen ödemede ayrılan", spent: "Bugüne dek kullanılan" } as const;
  const stackedColors = { available: "var(--viz-1)", reserved: "var(--viz-5)", spent: "var(--viz-neutral)" } as const;
  const stackedHrefs = {
    available: TRY_WALLET_LINKS.plans,
    reserved:
      summary.reservedTry > 0 && overview.open_reservations[0]?.invoice_id ? invoiceLink(overview.open_reservations[0].invoice_id) : TRY_WALLET_LINKS.invoices,
    spent: hrefOf("cikan"),
  } as const;

  return (
    <div className="space-y-5">
      {summary.negative ? (
        <Alert tone="warning" title="Kredi bakiyeniz eksiye düştü">
          Bir kredi geri alındığı için bakiye {formatTry(summary.balanceTry)}. Yeni krediler önce bu tutarı kapatır; eksi bakiye
          faturada kullanılamaz.
        </Alert>
      ) : null}

      <section className="rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-3)]">
        <p className="flex items-center gap-2 text-xs font-semibold text-accent-text">
          <Wallet className="h-4 w-4" /> Hesap kredisi (₺)
        </p>
        <h2 className="mt-1 font-display font-bold text-text">Hesap kredisi bakiyeniz</h2>
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-center">
          <Link href={TRY_WALLET_LINKS.plans} className="focus-ring group block rounded-[var(--radius-control)] p-2 hover:bg-surface-hover">
            <div className="flex items-start justify-between">
              <p className="text-xs font-semibold text-text-muted">Kullanılabilir kredi</p>
              <ArrowUpRight className="h-4 w-4 text-text-faint transition group-hover:text-accent-text" />
            </div>
            <p className="numeric mt-1 font-display text-3xl font-extrabold text-text">{formatTry(summary.availableTry)}</p>
            <p className="mt-1 text-xs text-text-muted">Faturada kullanmak için bir paket seçin</p>
          </Link>
          {stacked ? (
            <StackedBalance
              ariaLabel="Hesap kredisi dağılımı"
              note="Çubuk: kullanılabilir, bekleyen ödemede ayrılan ve bugüne dek kullanılan tutarın payları."
              items={stacked.segments.map((seg) => ({
                key: seg.key,
                pct: seg.pct,
                label: stackedLabels[seg.key],
                valueText: formatTry(seg.value),
                href: stackedHrefs[seg.key],
                color: stackedColors[seg.key],
              }))}
            />
          ) : (
            <p className="text-sm text-text-muted">Henüz kredi hareketi yok: ilk kredi yüklenince dağılım burada görünür.</p>
          )}
        </div>

        <div className="mt-4 grid gap-1 sm:grid-cols-2">
          <Link
            href={hrefOf("giren")}
            className="focus-ring group flex min-h-10 items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 py-2 hover:bg-surface-hover"
          >
            <span className="flex items-center gap-2 text-sm text-text-muted">
              <CalendarClock className="h-4 w-4 text-text-faint" aria-hidden="true" /> Vadesi yaklaşan
            </span>
            <span className="text-right">
              <span className="numeric block text-sm font-bold text-text">{formatTry(summary.expiringTry)}</span>
              <span className="block text-xs text-text-muted">
                {summary.nextExpiryText ? `En yakın vade: ${summary.nextExpiryText}` : "30 gün içinde vade yok"}
              </span>
            </span>
          </Link>
          <Link
            href={hrefOf("giren")}
            className="focus-ring group flex min-h-10 items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 py-2 hover:bg-surface-hover"
          >
            <span className="flex items-center gap-2 text-sm text-text-muted">
              <Clock3 className="h-4 w-4 text-text-faint" aria-hidden="true" /> Toplam yüklenen
            </span>
            <span className="numeric text-sm font-bold text-text">{formatTry(overview.granted_total)}</span>
          </Link>
        </div>

        {overview.expiring_buckets.length > 0 ? (
          <ul className="mt-3 space-y-1.5 px-3 text-xs text-text-muted" aria-label="Vadeli krediler">
            {overview.expiring_buckets.map((b) => (
              <li key={`${b.expires_at}-${b.amount}`}>
                <Link href={hrefOf("giren")} className="font-semibold text-text hover:text-accent-text">
                  {formatTry(b.amount)}
                </Link>{" "}
                · {expiryText(b.expires_at, nowMs)} ({dt.format(new Date(b.expires_at))})
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="rounded-[var(--radius-panel)] border bg-success-soft p-5">
        <p className="text-xs font-semibold text-success-strong">Kredi ile öde</p>
        <p className="mt-1 text-sm text-text">
          {canSpend
            ? summary.availableTry > 0
              ? `Ödeme adımında "Hesap kredimi kullan" kutusunu işaretleyin: bir faturanın (KDV dahil) en fazla ${formatShare(maxShare)} kadarı, ${formatTry(
                  summary.availableTry,
                )} bakiyenizle sınırlı olarak kredi ile ödenir, kalanı kartla tahsil edilir.`
              : "Kredi bakiyeniz oluştuğunda ödeme adımında “Hesap kredimi kullan” seçeneği görünür."
            : "Krediyi faturada yalnızca ofis sahibi veya genel müdür kullanabilir."}
          {full ? " Kredi toplamı karşılıyorsa kart çekimi yapılmaz." : ""}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Kredi nakde çevrilmez; paket, ek kullanıcı ve kontör paketi faturalarında kullanılır. Fatura tutarı ve KDV değişmez, iade
          edilirse kullanılan kredi hesabınıza geri yazılır.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <Link href={TRY_WALLET_LINKS.plans} className="focus-ring rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-white">
            Paketler
          </Link>
          <Link href={TRY_WALLET_LINKS.seats} className="focus-ring rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-text">
            Ek kullanıcı
          </Link>
          <Link href={TRY_WALLET_LINKS.packs} className="focus-ring rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-text">
            Kontör paketleri
          </Link>
        </div>
      </section>

      <section id="hareketler" className="scroll-mt-24 rounded-[var(--radius-panel)] bg-surface p-5 shadow-[var(--elev-1)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display font-bold text-text">Hareketler</h2>
          <nav aria-label="Hareket süzgeci" className="flex flex-wrap gap-1.5">
            {DIRECTIONS.map((d) => (
              <Link
                key={d.id}
                href={hrefOf(d.id)}
                aria-current={direction === d.id ? "page" : undefined}
                className={`focus-ring rounded-full px-3 py-1 text-xs font-semibold ${
                  direction === d.id ? "bg-accent text-white" : "border border-line bg-surface text-text-muted hover:border-brand-300"
                }`}
              >
                {d.label}
              </Link>
            ))}
          </nav>
        </div>
        <TableFrame className="mt-4" minWidth={520}>
          <Table>
            <THead>
              <TR>
                <TH>Tarih</TH>
                <TH>Hareket</TH>
                <TH>Vade</TH>
                <TH align="right">Tutar</TH>
              </TR>
            </THead>
            <TBody>
              {rows.length === 0 ? (
                <TableEmptyRow colSpan={4}>
                  {direction === "hepsi"
                    ? "Henüz kredi hareketi yok. Tavsiye, kampanya veya iade kredisi eklendiğinde burada listelenir."
                    : "Bu süzgeçte hareket yok."}
                </TableEmptyRow>
              ) : (
                rows.map((m) => (
                  <TR key={m.id}>
                    <TD className="text-text-muted">{dt.format(new Date(m.at))}</TD>
                    <TD className="font-semibold text-text">
                      {m.kind === "out" ? (
                        <Link href={TRY_WALLET_LINKS.invoices} className="hover:text-accent-text hover:underline">
                          {m.label}
                        </Link>
                      ) : (
                        m.label
                      )}
                    </TD>
                    <TD className="text-text-muted">{m.expiresAt ? expiryText(m.expiresAt, nowMs) : "—"}</TD>
                    <TD align="right" className={`numeric font-display font-bold ${m.kind === "in" ? "text-success-strong" : "text-text"}`}>
                      {m.kind === "in" ? "+" : "−"}
                      {formatTry(Math.abs(m.amountTry))}
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableFrame>
      </section>
    </div>
  );
}
