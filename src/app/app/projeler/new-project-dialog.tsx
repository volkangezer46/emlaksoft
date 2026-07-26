"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea, FormField } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { createProject, type ProjectResult } from "@/app/actions/projects";

const init: ProjectResult = {};

export function NewProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      if (res.id) router.push(`/app/projeler/${res.id}`);
      else router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" /> Yeni proje
        </Button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<Building2 />}
          title="Yeni proje"
          description="Projeyi oluşturduktan sonra detay ekranından blok ve daireleri ekleyebilirsiniz."
        />
        <form action={action} className="space-y-4 p-6">
          <FormField label="Proje adı" htmlFor="pr-name" required>
            <Input id="pr-name" name="name" required placeholder="Örn. Vadi Konakları" />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>

          <FormField label="Açıklama" htmlFor="pr-desc">
            <Textarea id="pr-desc" name="description" rows={3} placeholder="Proje hakkında kısa not…" />
          </FormField>

          {error ? (
            <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="hairline-t flex justify-end gap-2 pt-4">
            <DialogClose asChild>
              <Button type="button" variant="secondary">Vazgeç</Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              <Plus className="h-4 w-4" /> Proje oluştur
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
