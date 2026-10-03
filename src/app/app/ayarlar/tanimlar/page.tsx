import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_DEFINITIONS, DEFINITION_CATEGORIES } from "@/lib/definition-defaults";
import { DefinitionsManager, type DefRow } from "./definitions-manager";

import { PageHeader } from "@/components/ui/page-header";
export const metadata = { title: "Tanımlar" };

export default async function DefinitionsPage() {
  const { tenantId } = await requireModulePage("settings");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("definitions")
    .select("id, tenant_id, category, value, label, color, sort_order, is_active")
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("definitions page load failed", { code: error.code || "unknown" });
    throw new Error("Tanımlar güvenli şekilde yüklenemedi.");
  }

  const rows = (data ?? []) as DefRow[];
  const byCat = new Map<string, DefRow[]>();
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, []);
    byCat.get(r.category)!.push(r);
  }

  const categories = DEFINITION_CATEGORIES.map((c) => {
    const items = byCat.get(c.key) ?? [];
    // Global seed migration'ı uygulanmamışsa varsayılanlar ekranda da görünsün (okuma tarafı zaten
    // definition-defaults.ts'e düşer); sanal satırlar id'siz olduğundan hiçbir eyleme bağlanmaz.
    const needsDefaults = c.key === "loss_reason" && !items.some((r) => r.tenant_id == null);
    const virtual: DefRow[] = needsDefaults
      ? DEFAULT_DEFINITIONS.loss_reason.map((d, i) => ({
          id: `default:${d.value}`,
          tenant_id: null,
          category: c.key,
          value: d.value,
          label: d.label,
          color: null,
          sort_order: i + 1,
          is_active: true,
        }))
      : [];
    return { key: c.key, label: c.label, items: [...virtual, ...items] };
  });

  return (
    <div className="space-y-6">
      <Link href="/app/ayarlar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ayarlar
      </Link>

      <PageHeader title="Seçim listeleri & tanımlar" eyebrow="Tanımlar" description="Müşteri tipi, kaynak, portföy tipi, kayıp nedeni gibi tüm dropdown seçenekleri ve anlaşma aşama adları buradan yönetilir. Sistem varsayılanları korunur; ofisinize özel seçenekler ekleyebilir, kendi eklediklerinizi düzenleyebilirsiniz." />

      <DefinitionsManager categories={categories} tenantId={tenantId} />
    </div>
  );
}
