"use client";

import { Plus } from "lucide-react";
import { useCreateForm } from "@/components/app/use-create-form";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { FormSection, FormShell } from "@/components/ui/form-page";
import { createProject } from "@/app/actions/projects";
import { detailOrList } from "@/lib/form-logic";

export function NewProjectForm() {
  const { onSubmit, pending, error } = useCreateForm((fd) => createProject({}, fd), {
    successMessage: "Proje oluşturuldu",
    redirectTo: (r) => detailOrList("/app/projeler", r.id),
  });

  return (
    <FormShell
      title="Yeni proje"
      description="Projeyi oluşturduktan sonra detay ekranından blok ve daireleri ekleyebilirsiniz."
      breadcrumbs={[{ label: "Projeler", href: "/app/projeler" }, { label: "Yeni proje" }]}
      cancelHref="/app/projeler"
      submitLabel="Proje oluştur"
      submitIcon={Plus}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
    >
      <FormSection title="Proje bilgileri">
        <FormField label="Proje adı" htmlFor="pr-name" required className="sm:col-span-2">
          <FormInput name="name" required placeholder="Örn. Vadi Konakları" />
        </FormField>
        <FormField label="Müteahhit / geliştirici" htmlFor="pr-dev">
          <FormInput name="developer_name" placeholder="Örn. Aksoy İnşaat" />
        </FormField>
        <FormField label="Konum" htmlFor="pr-loc">
          <FormInput name="location" placeholder="Örn. Çankaya, Ankara" />
        </FormField>
        <FormField label="Teslim tarihi" htmlFor="pr-delivery">
          <FormInput name="delivery_date" type="date" />
        </FormField>
        <FormField label="Satış durumu" htmlFor="pr-status">
          <FormSelect name="status" defaultValue="selling">
            <option value="planning">Planlama</option>
            <option value="selling">Satışta</option>
            <option value="delivered">Teslim edildi</option>
          </FormSelect>
        </FormField>
        <FormField label="Açıklama" htmlFor="pr-desc" className="sm:col-span-2">
          <FormTextarea name="description" rows={3} placeholder="Proje hakkında kısa not…" />
        </FormField>
      </FormSection>
    </FormShell>
  );
}
