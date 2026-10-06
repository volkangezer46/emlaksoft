import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { loadCustomFieldDefs, loadCustomFieldValues } from "@/lib/custom-fields/load";
import { formatValue, inputValue, type CustomFieldEntity } from "@/lib/custom-fields/core";
import { CustomFieldsForm } from "./custom-fields-form";

/**
 * Kayıt detayında "Özel alanlar" bölümü. Tanım yoksa (veya tablo yoksa) HİÇ çizilmez; yalnız ayar yetkilisine
 * tanımlama bağlantısı gösterilir. Değerler RLS'li istemciyle okunur (üst kayıt görünürlüğüne bağlı).
 */
export async function CustomFieldsPanel({
  entity,
  recordId,
  tenantId,
  canEdit,
  canManage = false,
}: {
  entity: CustomFieldEntity;
  recordId: string;
  tenantId: string;
  canEdit: boolean;
  /** Ayarlar:edit — tanım yoksa "alan tanımla" bağlantısı için. */
  canManage?: boolean;
}) {
  const supabase = await createClient();
  const { available, defs } = await loadCustomFieldDefs(supabase, tenantId, entity);
  if (!available) return null;
  if (defs.length === 0) {
    return canManage ? (
      <p className="text-xs text-text-faint">
        Bu kayıt türü için ofise özel alan tanımlanmamış.{" "}
        <Link href="/app/ayarlar/ozel-alanlar" className="font-semibold text-brand-600 hover:underline">
          Özel alan tanımla
        </Link>
      </p>
    ) : null;
  }
  const values = (await loadCustomFieldValues(supabase, tenantId, entity, [recordId])).get(recordId);
  const fields = defs.map((d) => ({
    id: d.id,
    label: d.label,
    fieldType: d.fieldType,
    options: d.options,
    required: d.required,
    display: formatValue(d, values?.get(d.id)),
    input: inputValue(d, values?.get(d.id)),
  }));

  return (
    <section aria-labelledby={`ozel-alanlar-${entity}`} className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`ozel-alanlar-${entity}`} className="flex items-center gap-2 font-display font-bold text-ink-950">
          <SlidersHorizontal className="h-4 w-4 text-brand-600" aria-hidden /> Özel alanlar
        </h2>
        {canManage ? (
          <Link href="/app/ayarlar/ozel-alanlar" className="text-xs font-semibold text-brand-600 hover:underline">
            Alanları yönet
          </Link>
        ) : null}
      </div>
      <CustomFieldsForm entity={entity} recordId={recordId} fields={fields} canEdit={canEdit} />
    </section>
  );
}
