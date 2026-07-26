"use client";

import { useEffect } from "react";
import Image from "next/image";
import { Building2, Check, X } from "lucide-react";

/**
 * Karşılaştırma tablosunda gösterilen ilan verisi — vitrin kartı ve
 * müşteri portalı eşleşmesi aynı şekle indirgenir (tek kopya tablo).
 */
export type CompareItem = {
  id: string;
  title: string;
  href?: string | null;
  coverId?: string | null;
  price?: number | null;
  /** transaction_type — kira ise fiyata "/ay" eklenir */
  tx?: string | null;
  rooms?: string | null;
  sqm?: number | null;
  floor?: number | string | null;
  buildingAge?: number | string | null;
  district?: string | null;
};

function money(n: number | null | undefined, tx?: string | null) {
  if (n == null) return null;
  const s = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
  const isRent = tx === "rent" || (tx ?? "").toLowerCase().includes("kira");
  return isRent ? `${s}/ay` : s;
}

/** "5", "5-10", 5 gibi girdilerden baştaki sayıyı çıkarır; yoksa null. */
function leadingNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).trim().match(/^\d+([.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

type Row = {
  label: string;
  values: (string | null)[];
  /** mint vurgulanacak kolon indeksleri ("en iyi değer") */
  best: Set<number>;
};

/**
 * Sayısal satır için en iyi değer kolonlarını bulur. En az iki dolu değer
 * yoksa ya da hepsi eşitse vurgulanmaz (herkes "en iyi" olamaz).
 */
function bestOf(nums: (number | null)[], dir: "min" | "max"): Set<number> {
  const filled = nums.filter((n): n is number => n != null);
  if (filled.length < 2) return new Set();
  const target = dir === "min" ? Math.min(...filled) : Math.max(...filled);
  if (filled.every((n) => n === target)) return new Set();
  const best = new Set<number>();
  nums.forEach((n, i) => {
    if (n != null && n === target) best.add(i);
  });
  return best;
}

function buildRows(items: CompareItem[]): Row[] {
  const prices = items.map((it) => (it.price != null && it.price > 0 ? it.price : null));
  const sqms = items.map((it) => (it.sqm != null && it.sqm > 0 ? it.sqm : null));
  const ppsqm = items.map((_, i) => {
    const p = prices[i];
    const s = sqms[i];
    return p != null && s != null ? Math.round(p / s) : null;
  });
  const ages = items.map((it) => leadingNumber(it.buildingAge));

  const rows: Row[] = [
    {
      label: "Fiyat",
      values: items.map((it, i) => money(prices[i], it.tx)),
      best: bestOf(prices, "min"),
    },
    {
      label: "₺/m²",
      values: ppsqm.map((n) => (n != null ? new Intl.NumberFormat("tr-TR").format(n) + " ₺" : null)),
      best: bestOf(ppsqm, "min"),
    },
    { label: "Oda", values: items.map((it) => it.rooms ?? null), best: new Set() },
    {
      label: "m²",
      values: sqms.map((n) => (n != null ? `${new Intl.NumberFormat("tr-TR").format(n)} m²` : null)),
      best: bestOf(sqms, "max"),
    },
    {
      label: "Kat",
      values: items.map((it) => (it.floor != null && String(it.floor).trim() !== "" ? String(it.floor) : null)),
      best: new Set(),
    },
    {
      label: "Bina yaşı",
      values: items.map((it) =>
        it.buildingAge != null && String(it.buildingAge).trim() !== "" ? String(it.buildingAge) : null,
      ),
      best: bestOf(ages, "min"),
    },
    { label: "İlçe", values: items.map((it) => it.district ?? null), best: new Set() },
  ];

  // features'tan yalnız dolu alanlar: tamamen boş satırlar tabloya girmez
  return rows.filter((r) => r.values.some((v) => v != null));
}

/**
 * Tam ekran karşılaştırma tablosu (tek kopya) — vitrin favorileri ve
 * müşteri portalı eşleşmeleri aynı komponenti kullanır. Yeni route yok:
 * bulunduğu sayfanın üstünde overlay olarak açılır. Mobilde tablo yatay
 * kayar, ilk kolon (özellik adları) sticky kalır; "en iyi değer" hücresi
 * mint vurguludur.
 */
export function CompareTable({
  items,
  onClose,
  onRemove,
}: {
  items: CompareItem[];
  onClose: () => void;
  onRemove?: (id: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Arkadaki sayfa kaymasın
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const rows = buildRows(items);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="İlan karşılaştırma"
      className="fixed inset-0 z-[80] flex flex-col bg-ink-950/60 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-[20px] border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="font-display text-base font-extrabold text-ink-950 sm:text-lg">
              Karşılaştırma ({items.length})
            </h2>
            <p className="text-[11px] text-text-muted">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-mint-500 align-middle" />
              Mint hücre o satırdaki en avantajlı değeri gösterir.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Karşılaştırmayı kapat"
            className="focus-ring press grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mobilde yatay kaydırma; ilk kolon sticky */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 w-28 min-w-28 border-b border-line bg-surface p-3 text-left text-[11px] font-bold uppercase tracking-wide text-text-faint">
                  Özellik
                </th>
                {items.map((it) => (
                  <th
                    key={it.id}
                    className="sticky top-0 z-20 min-w-[160px] border-b border-l border-line bg-surface p-3 text-left align-top"
                  >
                    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[10px] bg-ink-950/5">
                      {it.coverId ? (
                        <Image
                          src={`/api/property-media/${it.coverId}`}
                          alt={it.title}
                          fill
                          sizes="200px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-text-faint">
                          <Building2 className="h-6 w-6" />
                        </div>
                      )}
                    </div>
                    <p className="mt-2 line-clamp-2 font-display text-xs font-bold leading-snug text-ink-950">
                      {it.title}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      {it.href ? (
                        <a
                          href={it.href}
                          className="text-[11px] font-semibold text-brand-600 underline-offset-2 hover:underline"
                        >
                          İlanı aç
                        </a>
                      ) : null}
                      {onRemove ? (
                        <button
                          type="button"
                          onClick={() => onRemove(it.id)}
                          className="text-[11px] font-semibold text-text-faint transition hover:text-red-500"
                        >
                          Çıkar
                        </button>
                      ) : null}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-line last:border-b-0">
                  <th className="sticky left-0 z-10 w-28 min-w-28 bg-surface p-3 text-left text-xs font-bold text-text-muted">
                    {row.label}
                  </th>
                  {row.values.map((v, i) => (
                    <td
                      key={items[i].id}
                      className={`min-w-[160px] border-l border-line p-3 align-middle ${
                        row.best.has(i)
                          ? "bg-mint-500/12 font-bold text-mint-600"
                          : "font-medium text-ink-950"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {row.best.has(i) ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                        {v ?? <span className="font-normal text-text-faint">—</span>}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
