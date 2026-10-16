"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/app/toast-provider";
import { createCandidate, type RecruitResult } from "@/app/actions/recruiting";
import { CandidateFields, type MemberOption } from "./candidate-fields";

const init: RecruitResult = {};

/** "Yeni aday" penceresi: kayıt sonrası aday kartı açılır (görüşme planlama oradan). */
export function NewCandidateDialog({ members }: { members: MemberOption[] }) {
  const [open, setOpen] = useState(false);
  const { push } = useToast();
  const router = useRouter();
  const [state, action, pending] = useActionState(createCandidate, init);

  useEffect(() => {
    if (state.ok && state.id) {
      push(state.info ?? "Aday eklendi.", "ok");
      // Aday kartına geçiş pencereyi de kapatır (sayfa değişir).
      router.push(`/app/ekip/adaylar/${state.id}`);
    } else if (state.error) {
      push(state.error, "err");
      if (state.id) router.push(`/app/ekip/adaylar/${state.id}`);
    }
  }, [state, push, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button icon={UserPlus}>Yeni aday</Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader icon={<UserPlus />} title="Yeni danışman adayı" description="Adayı hatta ekleyin; görüşmeyi kart üzerinden planlayın." />
        <form action={action}>
          <DialogBody className="space-y-4">
            <CandidateFields prefix="new-cand" members={members} />
            <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3.5 py-3 text-xs leading-relaxed text-text-muted">
              <input type="checkbox" name="kvkk" required className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600 touch:h-5 touch:w-5" />
              <span>
                Adaya kişisel verilerinin işe alım değerlendirmesi amacıyla işleneceğini bildirdim (KVKK aydınlatma). Sonuçlanan aday
                kaydı, kariyer formu ayarındaki saklama süresi dolunca otomatik silinir.
              </span>
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" icon={Save} loading={pending} className="w-full sm:w-auto">
              Adayı kaydet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
