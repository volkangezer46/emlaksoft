"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, LayoutGrid, Plus } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea, FormField } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addUnit, bulkAddUnits, type ProjectResult } from "@/app/actions/projects";

const init: ProjectResult = {};

/**
 * Daire ekleme — iki sekme:
 *  - Tekil: tek daire formu
 *  - Çoğalt: aynı bloka N kat × M daire hızlı üretim (daire no = kat×100+sıra)
 */
export function AddUnitsDialog({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (fn: (prev: ProjectResult, fd: FormData) => Promise<ProjectResult & { created?: number }>) =>
    (formData: FormData) => {
      startTransition(async () => {
        const res = await fn(init, formData);
        if (res.error) {
          setError(res.error);
          setInfo(null);
          return;
        }
        setError(null);
        if (res.created) {
          // Çoğaltmada dialog açık kalır — art arda blok üretimi yaygın senaryo.
          setInfo(`${res.created} daire eklendi.`);
        } else {
          setInfo(null);
          setOpen(false);
        }
        router.refresh();
      });
    };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setError(null);
          setInfo(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" /> Daire ekle
        </Button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<LayoutGrid />}
          title="Daire ekle"
          description="Tek daire girin ya da Çoğalt ile aynı bloka kat kat stok üretin."
        />
        <div className="p-6">
          <Tabs defaultValue="tekil">
            <TabsList className="w-full">
              <TabsTrigger value="tekil" className="flex-1 justify-center">
                <Plus /> Tekil
              </TabsTrigger>
              <TabsTrigger value="cogalt" className="flex-1 justify-center">
                <Copy /> Çoğalt
              </TabsTrigger>
            </TabsList>

            <TabsContent value="tekil" className="mt-4">
              <form action={submit(addUnit)} className="space-y-4">
                <input type="hidden" name="project_id" value={projectId} />
                <div className="grid gap-4 sm:grid-cols-3">
                  <FormField label="Blok" htmlFor="u-block" hint="Örn. A">
                    <Input id="u-block" name="block" placeholder="A" />
                  </FormField>
                  <FormField label="Kat" htmlFor="u-floor">
                    <Input id="u-floor" name="floor" type="number" placeholder="3" />
                  </FormField>
                  <FormField label="Daire no" htmlFor="u-no" required>
                    <Input id="u-no" name="unit_no" required placeholder="12" />
                  </FormField>
                  <FormField label="Oda" htmlFor="u-rooms">
                    <Input id="u-rooms" name="rooms" placeholder="2+1" />
                  </FormField>
                  <FormField label="Brüt m²" htmlFor="u-m2">
                    <Input id="u-m2" name="gross_m2" type="number" min={1} step="0.1" placeholder="95" />
                  </FormField>
                  <FormField label="Liste fiyatı (₺)" htmlFor="u-price">
                    <Input id="u-price" name="list_price" type="number" min={0} step={1000} placeholder="4500000" />
                  </FormField>
                </div>
                <FormField label="Not" htmlFor="u-notes">
                  <Textarea id="u-notes" name="notes" rows={2} placeholder="Cephe, manzara, özel durum…" />
                </FormField>

                {error ? (
                  <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
                    {error}
                  </p>
                ) : null}

                <div className="hairline-t flex justify-end gap-2 pt-4">
                  <DialogClose asChild>
                    <Button type="button" variant="secondary">Kapat</Button>
                  </DialogClose>
                  <Button type="submit" loading={pending}>
                    <Plus className="h-4 w-4" /> Daire ekle
                  </Button>
                </div>
              </form>
            </TabsContent>

            <TabsContent value="cogalt" className="mt-4">
              <form action={submit(bulkAddUnits)} className="space-y-4">
                <input type="hidden" name="project_id" value={projectId} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Blok" htmlFor="b-block" hint="Boş bırakılırsa bloksuz üretilir.">
                    <Input id="b-block" name="block" placeholder="A" />
                  </FormField>
                  <FormField label="Başlangıç katı" htmlFor="b-start">
                    <Input id="b-start" name="start_floor" type="number" defaultValue={1} />
                  </FormField>
                  <FormField label="Kat sayısı" htmlFor="b-floors" required>
                    <Input id="b-floors" name="floor_count" type="number" min={1} max={50} required placeholder="8" />
                  </FormField>
                  <FormField label="Kat başına daire" htmlFor="b-per" required>
                    <Input id="b-per" name="units_per_floor" type="number" min={1} max={20} required placeholder="4" />
                  </FormField>
                  <FormField label="Oda (hepsine)" htmlFor="b-rooms">
                    <Input id="b-rooms" name="rooms" placeholder="2+1" />
                  </FormField>
                  <FormField label="Brüt m² (hepsine)" htmlFor="b-m2">
                    <Input id="b-m2" name="gross_m2" type="number" min={1} step="0.1" placeholder="95" />
                  </FormField>
                  <FormField label="Liste fiyatı ₺ (hepsine)" htmlFor="b-price" className="sm:col-span-2">
                    <Input id="b-price" name="list_price" type="number" min={0} step={1000} placeholder="4500000" />
                  </FormField>
                </div>
                <p className="text-xs text-text-muted">
                  Daire numaraları kat×100+sıra olarak üretilir (örn. 3. kat 2. daire → 302). Tek seferde en fazla 200 daire.
                </p>

                {error ? (
                  <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
                    {error}
                  </p>
                ) : null}
                {info ? (
                  <p className="rounded-[8px] bg-mint-500/10 px-3 py-2 text-sm font-medium text-mint-700" role="status">
                    {info}
                  </p>
                ) : null}

                <div className="hairline-t flex justify-end gap-2 pt-4">
                  <DialogClose asChild>
                    <Button type="button" variant="secondary">Kapat</Button>
                  </DialogClose>
                  <Button type="submit" loading={pending}>
                    <Copy className="h-4 w-4" /> Daireleri üret
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
