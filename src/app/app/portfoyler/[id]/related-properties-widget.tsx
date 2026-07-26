import Link from "next/link";
import { ArrowUpRight, Building2, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

type RelatedProperty = {
  id: string;
  property_code: string;
  title: string | null;
  transaction_type: string;
  property_type: string | null;
  list_price: number | null;
  status: string;
  province: { name: string } | { name: string }[] | null;
};

function formatPrice(value: number | null, transaction: string) {
  if (value === null) return "Fiyat yok";
  const price = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(value);
  return `${price} ₺${transaction === "rent" || transaction === "Kiralık" ? "/ay" : ""}`;
}

function provinceName(value: RelatedProperty["province"]) {
  if (!value) return null;
  return Array.isArray(value) ? value[0]?.name : value.name;
}

const statusCls: Record<string, string> = {
  live: "bg-mint-500/12 text-mint-600",
  draft: "bg-zinc-100 text-zinc-500",
  reserved: "bg-amber-400/15 text-amber-600",
  sold: "bg-brand-600/10 text-brand-600",
};

const statusLabel: Record<string, string> = {
  live: "Yayında",
  draft: "Taslak",
  reserved: "Rezerve",
  sold: "Satıldı",
  rented: "Kiralandı",
};

/**
 * Aynı ofise ait, benzer transaction_type + property_type veya aynı il'deki
 * (mevcut portföy hariç) en fazla 6 portföyü gösterir.
 *
 * Algoritma (skor tabanlı):
 * 1. Aynı transaction_type + property_type = 2 puan
 * 2. Aynı province_id = 1 puan
 * Toplam skora göre azalan sıra, maks 6 sonuç.
 */
export async function RelatedPropertiesWidget({
  currentId,
  transactionType,
  propertyType,
  provinceId,
}: {
  currentId: string;
  transactionType: string;
  propertyType: string | null;
  provinceId: string | null;
}) {
  const supabase = await createClient();

  // Önce aynı transaction + type'tan al
  const [{ data: sameType }, { data: sameProv }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, property_code, title, transaction_type, property_type, list_price, status, province:geo_provinces(name)")
      .is("deleted_at", null)
      .neq("id", currentId)
      .eq("transaction_type", transactionType)
      .eq("property_type", propertyType ?? "")
      .in("status", ["live", "draft", "reserved"])
      .order("created_at", { ascending: false })
      .limit(10),
    provinceId
      ? supabase
          .from("properties")
          .select("id, property_code, title, transaction_type, property_type, list_price, status, province:geo_provinces(name)")
          .is("deleted_at", null)
          .neq("id", currentId)
          .eq("province_id", provinceId)
          .in("status", ["live", "draft", "reserved"])
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
  ]);

  // Skor tabanlı birleştirme — duplicate'leri kaldır
  const scoreMap = new Map<string, { prop: RelatedProperty; score: number }>();

  for (const p of (sameType ?? []) as RelatedProperty[]) {
    scoreMap.set(p.id, { prop: p, score: 2 });
  }
  for (const p of (sameProv ?? []) as RelatedProperty[]) {
    if (scoreMap.has(p.id)) {
      scoreMap.get(p.id)!.score += 1;
    } else {
      scoreMap.set(p.id, { prop: p, score: 1 });
    }
  }

  const related = [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((v) => v.prop);

  if (related.length === 0) return null;

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <Building2 className="h-4 w-4 text-brand-600" /> Benzer portföyler
        </h2>
        <Link
          href="/app/portfoyler"
          className="text-xs font-semibold text-brand-600 hover:underline"
        >
          Tümü
        </Link>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {related.map((p) => (
          <Link
            key={p.id}
            href={`/app/portfoyler/${p.id}`}
            className="group flex flex-col gap-2 rounded-[14px] border border-line bg-canvas/60 p-3 transition hover:border-brand-300 hover:bg-surface"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-brand-600">
                {p.transaction_type}{p.property_type ? ` · ${p.property_type}` : ""}
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${statusCls[p.status] ?? "bg-zinc-100 text-zinc-500"}`}>
                {statusLabel[p.status] ?? p.status}
              </span>
            </div>

            <p className="text-sm font-semibold text-ink-950 line-clamp-1">
              {p.title ?? p.property_code}
            </p>

            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-base font-extrabold text-ink-950">
                {formatPrice(p.list_price, p.transaction_type)}
              </p>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-brand-600" aria-hidden />
            </div>

            {provinceName(p.province) && (
              <p className="flex items-center gap-1 text-[11px] text-text-faint">
                <MapPin className="h-3 w-3" />
                {provinceName(p.province)}
              </p>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
