"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UsersRound } from "lucide-react";
import { convertAllVisitors } from "@/app/actions/open-house";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatBulkConvertSummary } from "@/lib/open-house-bulk";

/**
 * Müşteriye dönüşmemiş tüm ziyaretçileri onayla birlikte toplu dönüştürür.
 * İsteğe bağlı olarak her müşteri için ertesi güne teşekkür + geri bildirim görevi açar.
 */
export function ConvertAllVisitorsButton({ openHouseId, pendingCount }: { openHouseId: string; pendingCount: number }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [withTasks, setWithTasks] = useState(true);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const res = await convertAllVisitors(openHouseId, { createThankYouTasks: withTasks });
      if (res.error || !res.counts) {
        push(res.error ?? "Ziyaretçiler dönüştürülemedi.", "err");
        return;
      }
      const summary = formatBulkConvertSummary(res.counts);
      const tasks = res.tasksCreated ? ` · ${res.tasksCreated} teşekkür görevi açıldı` : "";
      push(`${summary}${tasks}`, res.counts.failed ? "err" : "ok");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" icon={UsersRound} disabled={pendingCount === 0}>
          Tümünü müşteriye dönüştür
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader
          icon={<UsersRound />}
          title="Ziyaretçileri toplu dönüştür"
          description={`Müşteriye dönüşmemiş ${pendingCount} ziyaretçi müşteri kaydına çevrilecek. Aynı telefonla kayıtlı müşteri varsa yeni kayıt açılmaz, mevcut müşteriye bağlanır.`}
        />
        <DialogBody>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-text">
            <Checkbox
              checked={withTasks}
              onChange={(e) => setWithTasks(e.target.checked)}
              disabled={pending}
              className="mt-0.5"
            />
            <span>
              Her müşteri için yarına &quot;Teşekkür + geri bildirim&quot; görevi oluştur
              <span className="block text-xs text-text-muted">Müşteride aynı açık görev varsa yenisi açılmaz.</span>
            </span>
          </label>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={pending}>Vazgeç</Button>
          </DialogClose>
          <Button variant="primary" loading={pending} onClick={onConfirm}>
            Dönüştür
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
