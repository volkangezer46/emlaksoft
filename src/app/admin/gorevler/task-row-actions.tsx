"use client";

import { useState, useTransition } from "react";
import { CalendarClock, CheckCircle2, ChevronDown, Hand, RotateCcw, UserMinus, UserPlus } from "lucide-react";
import { assignPlatformTask, setPlatformTaskDone, snoozePlatformTask } from "@/app/actions/platform-crm";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PersonSelect, type PersonOption } from "@/components/ui/person-select";
import { useToast } from "@/components/app/toast-provider";

/**
 * Görev satırı eylemleri (PA-2): Tamamla / Yeniden aç, Ertele (1 gün · 3 gün · 1 hafta), Üstlen, Başkasına ata,
 * Atamayı kaldır. Tazeleme tek seferdir (eylemler `revalidatePath` yapar). Mobilde düğmeler tam genişlikte ve ≥44 px
 * (Button `touch:` boyları); hover'a bağlı eylem yok.
 */
export function TaskRowActions({
  taskId,
  title,
  done,
  assigneeId,
  meId,
  people,
  canEdit,
}: {
  taskId: string;
  title: string;
  done: boolean;
  assigneeId: string | null;
  meId: string;
  people: PersonOption[];
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const toast = useToast();

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.push(r.message ?? "Kaydedildi.", "ok");
      else toast.push(r.error ?? "İşlem yapılamadı.", "err");
    });

  if (!canEdit) return null;

  if (done) {
    return (
      <Button size="sm" variant="outline" icon={RotateCcw} loading={pending} onClick={() => run(() => setPlatformTaskDone(taskId, false))} aria-label={`Yeniden aç: ${title}`} className="w-full sm:w-auto">
        Yeniden aç
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:justify-end">
        <Button size="sm" variant="primary" icon={CheckCircle2} loading={pending} onClick={() => run(() => setPlatformTaskDone(taskId, true))} aria-label={`Tamamla: ${title}`}>
          Tamamla
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" iconRight={ChevronDown} disabled={pending} aria-label={`Diğer eylemler: ${title}`}>
              Ertele / ata
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem onSelect={() => run(() => snoozePlatformTask(taskId, 1))}>
              <CalendarClock aria-hidden="true" /> Yarına ertele
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run(() => snoozePlatformTask(taskId, 3))}>
              <CalendarClock aria-hidden="true" /> 3 gün ertele
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run(() => snoozePlatformTask(taskId, 7))}>
              <CalendarClock aria-hidden="true" /> 1 hafta ertele
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {assigneeId !== meId ? (
              <DropdownMenuItem onSelect={() => run(() => assignPlatformTask(taskId, meId))}>
                <Hand aria-hidden="true" /> Üstlen
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => setPicking(true)}>
              <UserPlus aria-hidden="true" /> Başkasına ata…
            </DropdownMenuItem>
            {assigneeId ? (
              <DropdownMenuItem onSelect={() => run(() => assignPlatformTask(taskId, null))}>
                <UserMinus aria-hidden="true" /> Atamayı kaldır
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {picking ? (
        <div className="flex w-full items-center gap-2 sm:w-72">
          <PersonSelect
            people={people}
            featuredIds={[meId]}
            value={assigneeId ?? ""}
            onValueChange={(v) => {
              setPicking(false);
              if (v && v !== assigneeId) run(() => assignPlatformTask(taskId, v));
            }}
            emptyLabel="Personel seçin"
            aria-label={`Sorumlu seçin: ${title}`}
            className="min-w-0 flex-1"
          />
          <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
            Vazgeç
          </Button>
        </div>
      ) : null}
    </div>
  );
}
