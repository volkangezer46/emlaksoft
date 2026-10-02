"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormActions, FormPage, FormSection } from "@/components/ui/form-page";
import { Input, Textarea, FormField } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useToast } from "@/components/app/toast-provider";
import { createProject, type ProjectResult } from "@/app/actions/projects";

const init: ProjectResult = {};

export function NewProjectForm() {
  const router = useRouter();
  const { push } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const action = (formData: FormData) => {
    startTransition(async () => {
      const res = await createProject(init, formData);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      push("Proje oluşturuldu", "ok");
      router.push(res.id ? `/app/projeler/${res.id}` : "/app/projeler");
    });
  };

  return (
    <form action={action}>
      <FormPage
        title="Yeni proje"
        description="Projeyi oluşturduktan sonra detay ekranından blok ve daireleri ekleyebilirsiniz."
        breadcrumbs={[{ label: "Projeler", href: "/app/projeler" }, { label: "Yeni proje" }]}
      >
        <FormSection title="Proje bilgileri">
          <FormField label="Proje adı" htmlFor="pr-name" required className="sm:col-span-2">
            <Input id="pr-name" name="name" required placeholder="Örn. Vadi Konakları" />
          </FormField>
          <FormField label="Müteahhit / geliştirici" htmlFor="pr-dev">
            <Input id="pr-dev" name="developer_name" placeholder="Örn. Aksoy İnşaat" />
          </FormField>
          <FormField label="Konum" htmlFor="pr-loc">
            <Input id="pr-loc" name="location" placeholder="Örn. Çankaya, Ankara" />
          </FormField>
          <FormField label="Teslim tarihi" htmlFor="pr-delivery">
            <Input id="pr-delivery" name="delivery_date" type="date" />
          </FormField>
          <FormField label="Satış durumu" htmlFor="pr-status">
            <Select name="status" defaultValue="selling">
              <SelectTrigger id="pr-status" placeholder="Seçiniz" />
              <SelectContent>
                <SelectItem value="planning">Planlama</SelectItem>
                <SelectItem value="selling">Satışta</SelectItem>
                <SelectItem value="delivered">Teslim edildi</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Açıklama" htmlFor="pr-desc" className="sm:col-span-2">
            <Textarea id="pr-desc" name="description" rows={3} placeholder="Proje hakkında kısa not…" />
          </FormField>
        </FormSection>

        {error ? (
          <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
            {error}
          </p>
        ) : null}

        <FormActions>
          <ButtonLink href="/app/projeler" variant="secondary">İptal</ButtonLink>
          <Button type="submit" loading={pending}>
            <Plus className="h-4 w-4" /> Proje oluştur
          </Button>
        </FormActions>
      </FormPage>
    </form>
  );
}
