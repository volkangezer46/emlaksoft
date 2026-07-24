import Link from "next/link";
import { ArrowLeft, ListTree } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { DefinitionsManager, type DefRow } from "./definitions-manager";

export const metadata = { title: "Tanımlar" };

const CATEGORY_LABELS: Record<string, string> = {
  customer_type: "Müşteri tipi",
  customer_source: "Müşteri kaynağı",
  property_type: "Portföy tipi",
  transaction_type: "İşlem tipi",
  contract_type: "Sözleşme tipi",
  expense_category: "Gider kategorisi",
  appointment_type: "Randevu tipi",
};
const ORDER = ["customer_type", "customer_source", "property_type", "transaction_type", "contract_type", "expense_category", "appointment_type"];

export default async function DefinitionsPage() {
  const { tenantId } = await requireModulePage("settings");
  const supabase = await createClient();

  const { data } = await supabase
    .from("definitions")
    .select("id, tenant_id, category, value, label, color, sort_order, is_active")
    .order("sort_order", { ascending: true });

  const rows = (data ?? []) as DefRow[];
  const byCat = new Map<string, DefRow[]>();
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category)!.push(r);
  }

  const categories = ORDER.filter((c) => byCat.has(c) || true).map((c) => ({
    key: c,
    label: CATEGORY_LABELS[c] ?? c,
    items: byCat.get(c) ?? [],
  }));

  return (
    <div className="space-y-6">
      <Link href="/app/ayarlar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ayarlar
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-cyan-400"><ListTree className="h-4 w-4" /> Tanımlar</span>
          <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Seçim listeleri & tanımlar</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/70">
            Müşteri tipi, kaynak, portföy tipi gibi tüm dropdown seçenekleri buradan yönetilir. Sistem
            varsayılanları korunur; ofisinize özel seçenekler ekleyebilir, kendi eklediklerinizi düzenleyebilirsiniz.
          </p>
        </div>
      </section>

      <DefinitionsManager categories={categories} tenantId={tenantId} />
    </div>
  );
}
