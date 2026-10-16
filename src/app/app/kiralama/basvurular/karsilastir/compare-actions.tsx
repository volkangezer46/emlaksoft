"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListPlus, Send } from "lucide-react";
import { bulkSetApplicationStatus } from "@/app/actions/rental-applications";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** Karşılaştırılan adayların hepsini kısa listeye al / malike öner. Geçişi uymayan aday atlanır ve söylenir. */
export function CompareBulkActions({ ids }: { ids: string[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const run = (status: "shortlisted" | "owner_review") =>
    new Promise<void>((resolve) =>
      start(async () => {
        const res = await bulkSetApplicationStatus(ids, status);
        if (!res.ok) push(res.error ?? "Adaylar güncellenemedi.", "err");
        else push(`${res.updated} aday güncellendi${res.skipped ? `, ${res.skipped} aday bu duruma uygun değildi` : ""}.`, "ok");
        router.refresh();
        resolve();
      }),
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" icon={ListPlus} loading={pending} onClick={() => void run("shortlisted")}>
        Hepsini kısa listeye al
      </Button>
      <ConfirmDialog
        trigger={<Button size="sm" icon={Send} disabled={pending}>Hepsini malike öner</Button>}
        title="Adayları malike öner"
        description="Seçilen adaylar malik portalında “Önerilen kiracı adayları” bölümünde yan yana görünür; malik birini onaylar ya da reddeder. Telefon ve e-posta malike gösterilmez."
        confirmLabel="Malike öner"
        tone="default"
        onConfirm={() => run("owner_review")}
      />
    </div>
  );
}
