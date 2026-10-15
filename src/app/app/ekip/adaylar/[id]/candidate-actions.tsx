"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarPlus, Link2, Pencil, RotateCcw, Save, Send, Trash2, UserPlus, XCircle } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FilterChip } from "@/components/ui/filter-chip";
import { useToast } from "@/components/app/toast-provider";
import { PersonSelect } from "@/components/ui/person-select";
import {
  addCandidateNote,
  deleteCandidate,
  deleteCandidateNote,
  linkCandidateMember,
  moveCandidateStage,
  scheduleInterview,
  updateCandidate,
  type RecruitResult,
} from "@/app/actions/recruiting";
import { RECRUIT_NEXT_STAGE, RECRUIT_REJECT_REASONS, RECRUIT_STAGES, RECRUIT_STAGE_LABEL, type RecruitStage } from "@/lib/recruiting/logic";
import { CandidateFields, type CandidateDefaults, type MemberOption } from "../candidate-fields";

const init: RecruitResult = {};

/** Sabit alanları gönderimde FormData'ya ekler (ham gizli alan yerine; dokunma hedefi sözleşmesi). */
function withFields(action: (fd: FormData) => void, fields: Record<string, string>) {
  return (fd: FormData) => {
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    action(fd);
  };
}

function useResult(state: RecruitResult, onOk?: () => void) {
  const { push } = useToast();
  const okRef = useRef(onOk);
  useEffect(() => {
    okRef.current = onOk;
  });
  useEffect(() => {
    if (state.ok) {
      if (state.info) push(state.info, "ok");
      okRef.current?.();
    } else if (state.error) push(state.error, "err");
  }, [state, push]);
}

/** Aşama düğmeleri: birincil "sonraki aşama", "Olumsuz sonuç" (neden zorunlu) ve elle aşama seçimi. */
export function StageActions({ id, stage }: { id: string; stage: RecruitStage }) {
  const [state, action, pending] = useActionState(moveCandidateStage, init);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  useResult(state, () => setRejectOpen(false));
  const next = RECRUIT_NEXT_STAGE[stage];

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {next && next !== "katildi" ? (
        <form action={withFields(action, { id: id, stage: next })}>
          <Button type="submit" icon={ArrowRight} loading={pending} className="w-full sm:w-auto">
            {RECRUIT_STAGE_LABEL[next]} aşamasına al
          </Button>
        </form>
      ) : null}
      {stage === "red" ? (
        <form action={withFields(action, { id: id, stage: "basvuru" })}>
          <Button type="submit" variant="secondary" icon={RotateCcw} loading={pending} className="w-full sm:w-auto">
            Yeniden değerlendir
          </Button>
        </form>
      ) : null}
      {stage !== "red" && stage !== "katildi" ? (
        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" icon={XCircle} className="w-full sm:w-auto">
              Olumsuz sonuçlandır
            </Button>
          </DialogTrigger>
          <DialogContent size="md">
            <DialogHeader icon={<XCircle />} tone="danger" title="Aday olumsuz sonuçlansın mı?" description="Neden, raporlarda ve aday geçmişinde görünür." />
            <form action={withFields(action, { id: id, stage: "red" })}>
              <DialogBody className="space-y-3">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Hazır nedenler">
                  {RECRUIT_REJECT_REASONS.map((r) => (
                    <FilterChip key={r} active={reason === r} onClick={() => setReason(r)}>
                      {r}
                    </FilterChip>
                  ))}
                </div>
                <FormField label="Neden" htmlFor={`reject-${id}`} required>
                  <FormTextarea id={`reject-${id}`} name="reason" rows={2} maxLength={300} required value={reason} onChange={(e) => setReason(e.target.value)} />
                </FormField>
              </DialogBody>
              <DialogFooter>
                <Button type="submit" variant="danger" loading={pending} className="w-full sm:w-auto">
                  Olumsuz olarak kaydet
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
      <form action={withFields(action, { id: id })} className="flex items-center gap-2">
        <label htmlFor={`stage-${id}`} className="sr-only">
          Aşamayı değiştir
        </label>
        <FormSelect id={`stage-${id}`} name="stage" defaultValue={stage} className="min-w-0 flex-1 sm:w-40 sm:flex-none">
          {RECRUIT_STAGES.filter((s) => s !== "red").map((s) => (
            <option key={s} value={s}>
              {RECRUIT_STAGE_LABEL[s]}
            </option>
          ))}
        </FormSelect>
        <Button type="submit" variant="secondary" loading={pending}>
          Uygula
        </Button>
      </form>
    </div>
  );
}

/** Görüşme planla: görüşmeyi yapacak kişiye görev açılır (takvim ve hatırlatma görev altyapısından). */
export function InterviewForm({ id, members, defaultInterviewer, minLocal }: { id: string; members: MemberOption[]; defaultInterviewer: string; minLocal: string }) {
  const [state, action, pending] = useActionState(scheduleInterview, init);
  const formRef = useRef<HTMLFormElement>(null);
  useResult(state, () => formRef.current?.reset());
  return (
    <form ref={formRef} action={withFields(action, { id: id })} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Tarih ve saat" htmlFor={`int-at-${id}`} required>
          <FormInput id={`int-at-${id}`} name="at" type="datetime-local" min={minLocal} required />
        </FormField>
        <FormField label="Görüşmeyi yapacak" htmlFor={`int-who-${id}`}>
          <PersonSelect id={`int-who-${id}`} name="interviewer_id" defaultValue={defaultInterviewer} people={members} emptyLabel="Ben" />
        </FormField>
        <FormField label="Yer / bağlantı" htmlFor={`int-place-${id}`} className="sm:col-span-2">
          <FormInput id={`int-place-${id}`} name="place" maxLength={200} placeholder="Ofis, kafe ya da görüntülü görüşme bağlantısı" />
        </FormField>
      </div>
      <div className="flex sm:justify-end">
        <Button type="submit" icon={CalendarPlus} loading={pending} className="w-full sm:w-auto">
          Görüşmeyi planla
        </Button>
      </div>
    </form>
  );
}

export function NoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(addCandidateNote, init);
  const formRef = useRef<HTMLFormElement>(null);
  useResult(state, () => formRef.current?.reset());
  return (
    <form ref={formRef} action={withFields(action, { id: id })} className="space-y-2">
      <label htmlFor={`note-${id}`} className="sr-only">
        Not ekle
      </label>
      <FormTextarea id={`note-${id}`} name="body" rows={3} maxLength={2000} required placeholder="Görüşme izlenimi, beklentiler, sonraki adım…" />
      <div className="flex justify-end">
        <Button type="submit" size="sm" icon={Send} loading={pending}>
          Notu ekle
        </Button>
      </div>
    </form>
  );
}

export function DeleteNoteButton({ id, candidateId }: { id: string; candidateId: string }) {
  const [state, action, pending] = useActionState(deleteCandidateNote, init);
  const formRef = useRef<HTMLFormElement>(null);
  useResult(state);
  return (
    <form ref={formRef} action={withFields(action, { id: id, candidate_id: candidateId })}>
      <ConfirmDialog
        title="Not silinsin mi?"
        confirmLabel="Sil"
        onConfirm={() => formRef.current?.requestSubmit()}
        trigger={<Button type="button" size="icon" variant="ghost" icon={Trash2} aria-label="Notu sil" loading={pending} />}
      />
    </form>
  );
}

/**
 * "Katıldı" adımı: hesabı Danışman ekle sihirbazıyla açtıktan sonra adayı ekip üyesine bağlayın; işaretliyse
 * oryantasyon listesi üyeye görev olarak atanır.
 */
export function LinkMemberForm({ id, members, linkedName }: { id: string; members: MemberOption[]; linkedName: string | null }) {
  const [state, action, pending] = useActionState(linkCandidateMember, init);
  useResult(state);
  return (
    <div className="space-y-3">
      {linkedName ? (
        <p className="text-sm text-ink-950">
          Bağlı ekip üyesi: <span className="font-semibold">{linkedName}</span>
        </p>
      ) : (
        <ol className="list-decimal space-y-1 pl-5 text-xs text-text-muted">
          <li>Danışman hesabını açın (davet, rol ve şube sihirbazda).</li>
          <li>Açılan üyeyi aşağıdan seçip adayı bağlayın; oryantasyon kendiliğinden başlar.</li>
        </ol>
      )}
      {!linkedName ? (
        <ButtonLink href="/app/ekip/yeni" variant="secondary" icon={UserPlus} className="w-full sm:w-auto">
          Danışman hesabını aç
        </ButtonLink>
      ) : null}
      <form action={withFields(action, { id: id })} className="space-y-3">
        <FormField label={linkedName ? "Başka bir üyeye bağla" : "Ekip üyesi"} htmlFor={`link-${id}`}>
          <PersonSelect id={`link-${id}`} name="profile_id" required clearable={false} defaultValue="" people={members} featuredIds={members.slice(0, 3).map((m) => m.id)} emptyLabel="Üye seçin" />
        </FormField>
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink-950">
          <input type="checkbox" name="start_orientation" defaultChecked={!linkedName} className="h-4 w-4 accent-brand-600 touch:h-5 touch:w-5" />
          Oryantasyon listesini başlat (adımlar üyeye görev olarak atanır)
        </label>
        <Button type="submit" icon={Link2} loading={pending} className="w-full sm:w-auto">
          Ekip üyesine bağla
        </Button>
      </form>
    </div>
  );
}

export function EditCandidateDialog({ id, defaults, members }: { id: string; defaults: CandidateDefaults; members: MemberOption[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateCandidate, init);
  useResult(state, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" icon={Pencil}>
          Düzenle
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader icon={<Pencil />} title="Aday bilgileri" />
        <form action={withFields(action, { id: id })}>
          <DialogBody>
            <CandidateFields prefix={`edit-${id}`} defaults={defaults} members={members} />
          </DialogBody>
          <DialogFooter>
            <Button type="submit" icon={Save} loading={pending} className="w-full sm:w-auto">
              Kaydet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** KVKK: adayın talebiyle ya da gereksiz kalınca kaydı kalıcı sil. */
export function DeleteCandidateButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(deleteCandidate, init);
  const formRef = useRef<HTMLFormElement>(null);
  useResult(state, () => router.push("/app/ekip/adaylar"));
  return (
    <form ref={formRef} action={withFields(action, { id: id })}>
      <ConfirmDialog
        title="Aday kaydı kalıcı silinsin mi?"
        description="Aday bilgileri, notlar ve geçmiş geri alınamaz şekilde silinir (KVKK silme talebi). Açılmış görüşme görevi görevlerde kalır."
        confirmLabel="Kalıcı sil"
        onConfirm={() => formRef.current?.requestSubmit()}
        trigger={
          <Button type="button" variant="ghost" size="sm" icon={Trash2} loading={pending}>
            Kaydı sil
          </Button>
        }
      />
    </form>
  );
}
