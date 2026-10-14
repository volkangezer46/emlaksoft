import Link from "@/components/ui/smart-link";
import { efCreditsLine } from "@/lib/ef-credits/plan-credits";

type Row = { id: string; name: string; units: number; perExtraSeat?: number };

/**
 * "Analiz bakiyesi hakları" SALT OKUNUR özeti: paket başına aylık hak (canlı yaklaşık değerleme) ve hoş geldin analiz
 * bakiyesinin güncel değeri. Hoş geldin bakiyesi ve toptan maliyet Kullanım ve krediler > Analiz tarifesi'nde düzenlenir.
 */
export function EfCreditsSection({
  rows,
  valuationCost,
  welcomeUnits,
  wholesaleKnown,
}: {
  rows: Row[];
  valuationCost: number;
  welcomeUnits: number;
  /** ef.wholesale tanımlı mı (iki tarife de 0 değilse). */
  wholesaleKnown: boolean;
}) {
  return (
    <section aria-label="Analiz bakiyesi hakları" className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div>
        <h2 className="font-display font-bold text-ink-950">Analiz bakiyesi hakları</h2>
        <p className="text-xs text-text-muted">
          Paket başına aylık EmlakFiyati analiz bakiyesi plan düzenleyicisinden girilir; günlük çalışma, trialing/active aboneliği olan ofislere ayı için tek sefer verir.
          Aylık hak o ayın sonunda yanar, devretmez (süreli analiz bakiyesi, 2026-10-10 kararı). Plan yükseltmede ara hak verilmez; yeni paketin hakkı sonraki ay başlar.
          Ek kullanıcı başı analiz bakiyesi, plan düzenleyicisindeki &quot;ek kullanıcı başı analiz bakiyesi&quot; alanından girilir ve satırlarda hakka eklenir.
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Toptan maliyet (EmlakFiyatı işlem başı tarifesi): {wholesaleKnown ? "tanımlı" : "BİLİNMİYOR, varsayılan 0 kullanılıyor; marj gerçek değildir"}.{" "}
          <Link href="/admin/analiz-tarifesi#ekonomi" className="font-semibold text-brand-600 hover:underline">
            Analiz bakiyesi ekonomisi ve maliyet girişi
          </Link>
        </p>
      </div>
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-1.5 last:border-0">
            <span className="font-semibold text-ink-950">{r.name}</span>
            <span className="tabular-nums text-text-muted">{efCreditsLine(r.units, valuationCost, r.perExtraSeat) ?? "Aylık hak yok"}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-line pt-3 text-sm text-text-muted">
        Hoş geldin analiz bakiyesi (yalnız deneme/yeni ofis, tek sefer):{" "}
        <strong className="text-ink-950">{welcomeUnits === 0 ? "kapalı" : `${welcomeUnits} birim`}</strong>.{" "}
        <Link href="/admin/analiz-tarifesi#hos-geldin" className="font-semibold text-brand-600 hover:underline">
          Analiz tarifesinde düzenle →
        </Link>
      </p>
    </section>
  );
}
