import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { EmptyStateV3 } from "@/components/ui/empty-state-v3";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { createClient } from "@/lib/supabase/server";
import { loadCustomFieldDefs } from "@/lib/custom-fields/load";
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  CUSTOM_FIELD_TYPE_LABELS,
  MAX_DEFS_PER_ENTITY,
} from "@/lib/custom-fields/core";
import { CreateCustomFieldForm, CustomFieldRow } from "./custom-field-forms";

export const metadata = { title: "Özel alanlar" };

/**
 * Özel alanlar: ofisin kendi tanımladığı ek alanlar (müşteri, portföy, talep, anlaşma). Tanım yazma ayarlar:edit;
 * değerler kayıt detayındaki "Özel alanlar" bölümünden girilir ve ilgili listenin CSV'sine `ozel: <ad>` sütunu olarak eklenir.
 */
export default async function CustomFieldsPage() {
  const { perms, tenantId } = await requireModulePage("settings", "/app/ayarlar/ozel-alanlar");
  const canEdit = effectiveHasPermission(perms, "settings", "edit");
  const crumbs = [{ label: "Ayarlar", href: "/app/ayarlar" }, { label: "Özel alanlar" }];
  if (!tenantId) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <PageHeader title="Özel alanlar" breadcrumbs={crumbs} />
        <Alert tone="info">Bu ekran bir ofis hesabı içinde kullanılır.</Alert>
      </div>
    );
  }
  const supabase = await createClient();
  const { available, defs } = await loadCustomFieldDefs(supabase, tenantId, null, { includeInactive: true });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <PageHeader
        eyebrow="Ayarlar"
        title="Özel alanlar"
        description="Ofisinize özgü bilgileri (ör. ısınma tipi, kredi onayı, referans kodu) müşteri, portföy, talep ve anlaşma kayıtlarına ekleyin."
        breadcrumbs={crumbs}
      />
      {!available ? (
        <Alert tone="warning">Özel alanlar henüz etkin değil (veritabanı güncellemesi bekleniyor).</Alert>
      ) : (
        <>
          {canEdit ? <CreateCustomFieldForm /> : <Alert tone="info">Alan tanımlamak için Ayarlar düzenleme yetkisi gerekir.</Alert>}
          {CUSTOM_FIELD_ENTITIES.map((entity) => {
            const list = defs.filter((d) => d.entity === entity);
            return (
              <section key={entity} aria-labelledby={`cf-${entity}`} className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id={`cf-${entity}`} className="font-display font-bold text-ink-950">
                    {CUSTOM_FIELD_ENTITY_LABELS[entity]} alanları
                  </h2>
                  <span className="text-xs text-text-muted">
                    {list.length} / {MAX_DEFS_PER_ENTITY}
                  </span>
                </div>
                {list.length === 0 ? (
                  <EmptyStateV3 variant="compact" title="Henüz alan yok." description="Yukarıdaki formdan bu kayıt türü için alan ekleyebilirsiniz." />
                ) : (
                  <ul className="mt-3 divide-y divide-line rounded-[var(--radius-card)] border border-line">
                    {list.map((d) => (
                      <CustomFieldRow
                        key={d.id}
                        def={{ id: d.id, label: d.label, typeLabel: CUSTOM_FIELD_TYPE_LABELS[d.fieldType], fieldType: d.fieldType, options: d.options, required: d.required, active: d.active }}
                        canEdit={canEdit}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          <p className="text-xs text-text-faint">
            TC kimlik no, IBAN, kart numarası gibi hassas kişisel verileri özel alanlara yazmayın. Gizlenen alan kayıtlarda görünmez
            ama değerleri saklanır; silinen alanın tüm değerleri kalıcı olarak silinir.
          </p>
        </>
      )}
    </div>
  );
}
