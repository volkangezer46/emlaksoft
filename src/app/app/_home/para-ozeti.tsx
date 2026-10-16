import Link from "@/components/ui/smart-link";
import { Landmark, Wallet, ArrowDownCircle, Coins, type LucideIcon } from "lucide-react";
import type { PremiumTone } from "@/components/ui/premium";
import { loadAging } from "@/lib/finance/ledger/load";
import { AGING_LABEL, type AgingBucketKey } from "@/lib/finance/party/aging";
import { Skeleton } from "@/components/ui/skeleton";
import { financeHref, financePath } from "@/lib/finance/routes";
import { moneyTry } from "@/lib/leak-shield";
import { RECEIVABLE_LABEL } from "@/lib/finance/receivable-definition";
import { loadMoneySummary, type HomeCtx } from "./data";

type Kalem = { key: string; label: string; value: number; href: string; hint: string; Icon: LucideIcon; tone: PremiumTone };

export function ParaOzetiIskelet() {
  return (
    <div role="status" aria-busy="true" className="ds-card ds-pad flex min-h-[18rem] flex-col gap-3">
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-5 w-20" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

/**
 * PATRON PANOSU (2) "PARA" (sadeleştirme planı 2.4 / C08): bu ay komisyon, kasa ve alacak — rakamlar varsayılan AÇIK,
 * her biri filtreli finans sayfasına gider. Altında (gerçek veri varsa) bu ayın nakit giriş/çıkış çubukları ve alacak
 * yaşlandırma şeridi: kart, yanındaki "Senden bekleyenler" ile aynı boyda dolu biter (boş alan yok). Kaynaklar Ofis özeti KPI'sı ve Finans genel bakışla aynıdır
 * (`loadMoneySummary`). Yetkisi olmayan kalem çizilmez; hiçbiri yoksa kart hiç çizilmez.
 */
export async function ParaOzeti({ ctx }: { ctx: HomeCtx }) {
  const m = await loadMoneySummary(ctx);
  // Yaşlandırma yalnız açık alacak varsa okunur (ek tek RPC; hata/boşta şerit çizilmez).
  const aging = m.receivable !== null && m.receivable > 0 ? await loadAging("receivable").catch(() => null) : null;
  const kalemler: Kalem[] = [];
  if (m.commissionMonth !== null) {
    kalemler.push({
      key: "komisyon",
      label: "Bu ay komisyon",
      value: m.commissionMonth,
      href: `${financePath("komisyon")}?from=${m.monthFrom}&to=${m.today}`,
      hint: ctx.seeAllEarnings && !ctx.scopeMine ? "Ofisin bu ayki komisyonu" : "Sizin bu ayki komisyonunuz",
      Icon: Wallet,
      tone: "gold",
    });
  }
  if (m.cash !== null) {
    kalemler.push({ key: "kasa", label: "Kasa", value: m.cash, href: financeHref("kasa-banka"), hint: "Kasa ve banka toplamı", Icon: Landmark, tone: "brand" });
  }
  if (m.receivable !== null) {
    kalemler.push({
      key: "alacak",
      // Tek tanım (`@/lib/finance/receivable-definition`): Finans genel bakış kartıyla aynı rakam ve aynı hedef.
      label: RECEIVABLE_LABEL,
      value: m.receivable,
      href: financeHref("cari", { gorunum: "acik", yon: "alacak" }),
      hint: "Tahsil edilecek açık kalemler",
      Icon: ArrowDownCircle,
      tone: "success",
    });
  }
  if (kalemler.length === 0) return null;
  const flow = m.monthIn !== null && m.monthOut !== null && (m.monthIn > 0 || m.monthOut > 0) ? { inn: m.monthIn, out: m.monthOut } : null;
  const agingRows = aging ? aging.filter((b) => b.amount > 0 && b.bucket !== "vadesiz") : [];
  const agingTotal = agingRows.reduce((t, b) => t + b.amount, 0);
  return (
    <section aria-labelledby="para-baslik" className="ds-card ds-pad flex h-full flex-col gap-3">
      <header className="flex items-center gap-2.5">
        <span className="pm-ico pm-t-gold" aria-hidden="true">
          <Coins />
        </span>
        <span className="min-w-0">
          <h2 id="para-baslik" className="ds-title">
            Para
          </h2>
          <p className="text-xs text-text-muted">Bu ayın komisyonu, kasa ve açık alacak</p>
        </span>
      </header>
      <ul className="flex flex-col gap-2">
        {kalemler.map((k) => (
          <li key={k.key}>
            <Link
              href={k.href}
              data-para={k.key}
              className="ds-lift focus-ring press group flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border border-hairline bg-surface-raised px-3.5 py-3 transition hover:bg-surface-hover"
            >
              <span className={`pm-ico pm-t-${k.tone}`} aria-hidden="true">
                <k.Icon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text">{k.label}</span>
                <span className="block truncate text-sm text-text-muted">{k.hint}</span>
              </span>
              <span className="pm-money shrink-0 font-display text-xl font-bold tabular-nums text-ink-950">{moneyTry(k.value)}</span>
            </Link>
          </li>
        ))}
      </ul>

      {flow ? <NakitAkisi inn={flow.inn} out={flow.out} from={m.monthFrom} to={m.today} /> : null}

      {agingRows.length > 0 && agingTotal > 0 ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-hairline bg-[var(--surface-sunken)] p-3" data-para="yaslandirma">
          <p className="flex items-center justify-between gap-2 text-sm">
            <span className="font-semibold text-text">Alacak yaşlandırması</span>
            <span className="tabular-nums text-text-muted">{moneyTry(agingTotal)}</span>
          </p>
          {/* Yığılmış şerit: her dilim o kovaya süzülmüş açık kalem listesine gider (sıfır çıkmaz metrik). */}
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface)]" role="img" aria-label={agingRows.map((b) => `${AGING_LABEL[b.bucket]} ${moneyTry(b.amount)}`).join(", ")}>
            {agingRows.map((b) => (
              <span
                key={b.bucket}
                className="viz-grow-x h-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${Math.max(2, (b.amount / agingTotal) * 100)}%`, background: AGING_COLOR[b.bucket] }}
              />
            ))}
          </div>
          <ul className="flex flex-col text-xs">
            {agingRows.map((b) => (
              <li key={b.bucket}>
                <Link
                  href={financeHref("cari", { gorunum: "acik", yon: "alacak", kova: b.bucket })}
                  className="focus-ring grid min-h-8 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-[var(--radius-control)] px-1 hover:bg-surface-hover touch:min-h-11"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: AGING_COLOR[b.bucket] }} aria-hidden="true" />
                  <span className="truncate text-text-muted">{AGING_LABEL[b.bucket]}</span>
                  <span className="tabular-nums text-text-faint">{b.count} kalem</span>
                  <span className="min-w-[5.5rem] text-right font-semibold tabular-nums text-text">{moneyTry(b.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** Yaşlandırma rengi: vadesi gelmemiş nötr mavi → gecikme büyüdükçe sarıdan kırmızıya (metin her zaman yanında). */
const AGING_COLOR: Record<AgingBucketKey, string> = {
  vadesi_gelmedi: "var(--viz-1)",
  "0-30": "var(--viz-gold)",
  "31-60": "color-mix(in srgb, var(--viz-gold) 55%, var(--danger-500))",
  "61-90": "color-mix(in srgb, var(--viz-gold) 25%, var(--danger-500))",
  "90+": "var(--danger-500)",
  vadesiz: "var(--text-faint)",
};

/** Bu ay nakit akışı: giriş ve çıkış aynı ölçekte iki ince çubuk + net; her satır ay aralığıyla süzülmüş hareketlere gider. */
function NakitAkisi({ inn, out, from, to }: { inn: number; out: number; from: string; to: string }) {
  const max = Math.max(inn, out, 1);
  const net = inn - out;
  const rows = [
    { key: "giris", label: "Giriş", value: inn, color: "var(--viz-2)" },
    { key: "cikis", label: "Çıkış", value: out, color: "var(--viz-gold)" },
  ];
  return (
    <Link
      href={financeHref("hareketler", { from, to })}
      data-para="nakit"
      className="ds-lift focus-ring flex flex-col gap-2 rounded-[var(--radius-card)] border border-hairline bg-surface-raised p-3 transition hover:bg-surface-hover"
    >
      <span className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-text">Bu ay nakit akışı</span>
        <span className={`pm-t-${net >= 0 ? "success" : "danger"} font-semibold tabular-nums text-[color:var(--t-text)]`}>
          Net {net >= 0 ? "+" : "−"}
          {moneyTry(Math.abs(net))}
        </span>
      </span>
      {rows.map((r) => (
        <span key={r.key} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
          <span className="text-text-muted">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
            <span className="viz-grow-x block h-full rounded-full" style={{ width: `${Math.max(r.value > 0 ? 3 : 0, (r.value / max) * 100)}%`, background: r.color }} />
          </span>
          <span className="font-semibold tabular-nums text-text">{moneyTry(r.value)}</span>
        </span>
      ))}
    </Link>
  );
}
