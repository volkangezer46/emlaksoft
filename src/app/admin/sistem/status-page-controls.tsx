"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { addStatusUpdate, createStatusIncident, deleteStatusIncident, type StatusResult } from "@/app/actions/status-page";

/**
 * Durum sayfası istemci denetimleri: yeni olay / planlı bakım, durum güncellemesi (kamuya açık metin) ve silme
 * (yalnız süper admin; satır içi onay). Seçenek etiketleri sunucudan gelir (istemci modeli yüklemez).
 */

type Opt = { value: string; label: string };

function Msg({ res }: { res: { ok: boolean; text: string } | null }) {
  if (!res) return null;
  return (
    <span role={res.ok ? "status" : "alert"} className={`text-xs font-semibold ${res.ok ? "text-mint-700" : "text-danger-600"}`}>
      {res.text}
    </span>
  );
}

function useSubmit(fn: (fd: FormData) => Promise<StatusResult>, okText: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setRes(null);
    start(async () => {
      const r = await fn(fd);
      if (r.error) {
        setRes({ ok: false, text: r.error });
        return;
      }
      form.reset();
      setRes({ ok: true, text: okText });
      router.refresh();
    });
  }
  return { pending, res, onSubmit };
}

export function IncidentCreateForm({ impacts, incidentStatuses, disabled }: { impacts: Opt[]; incidentStatuses: Opt[]; disabled?: boolean }) {
  const [kind, setKind] = useState<"incident" | "maintenance">("incident");
  const { pending, res, onSubmit } = useSubmit(createStatusIncident, "Yayınlandı: /durum sayfasında görünür.");
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      <FormField label="Tür" htmlFor="inc-kind" required>
        <FormSelect name="kind" value={kind} onChange={(e) => setKind(e.target.value === "maintenance" ? "maintenance" : "incident")} disabled={disabled}>
          <option value="incident">Olay (kesinti / sorun)</option>
          <option value="maintenance">Planlı bakım</option>
        </FormSelect>
      </FormField>
      <FormField label="Başlık" htmlFor="inc-title" required hint="Kamuya açık; kısa ve anlaşılır yazın.">
        <FormInput name="title" minLength={3} maxLength={140} required disabled={disabled} placeholder={kind === "incident" ? "ör. Panel yavaş açılıyor" : "ör. Veritabanı bakımı"} autoComplete="off" />
      </FormField>
      {kind === "incident" ? (
        <>
          <FormField label="Etki" htmlFor="inc-impact" required>
            <FormSelect name="impact" defaultValue="minor" disabled={disabled}>
              {impacts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </FormSelect>
          </FormField>
          <FormField label="Durum" htmlFor="inc-status" required>
            <FormSelect name="status" defaultValue="investigating" disabled={disabled}>
              {incidentStatuses.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </FormSelect>
          </FormField>
        </>
      ) : (
        <>
          <FormField label="Başlangıç (İstanbul saati)" htmlFor="inc-start" required>
            <FormInput type="datetime-local" name="scheduledStart" required disabled={disabled} />
          </FormField>
          <FormField label="Bitiş (İstanbul saati)" htmlFor="inc-end" required>
            <FormInput type="datetime-local" name="scheduledEnd" required disabled={disabled} />
          </FormField>
        </>
      )}
      <FormField label="İlk bilgilendirme" htmlFor="inc-message" required hint="Kamuya açık: ne etkileniyor, ne yapılıyor. İç ayrıntı yazmayın." className="sm:col-span-2">
        <FormTextarea name="message" rows={3} maxLength={2000} required disabled={disabled} />
      </FormField>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button variant="navy" type="submit" disabled={pending || disabled}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Yayınla
        </Button>
        <Msg res={res} />
      </div>
    </form>
  );
}

export function IncidentUpdateForm({ incidentId, statuses, current, impacts, impact }: { incidentId: string; statuses: Opt[]; current: string; impacts?: Opt[]; impact?: string }) {
  const { pending, res, onSubmit } = useSubmit(addStatusUpdate, "Güncelleme yayınlandı.");
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="incidentId" value={incidentId} />
      <FormField label="Yeni durum" htmlFor={`upd-status-${incidentId}`} required>
        <FormSelect name="status" defaultValue={current}>
          {statuses.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </FormSelect>
      </FormField>
      {impacts ? (
        <FormField label="Etki" htmlFor={`upd-impact-${incidentId}`}>
          <FormSelect name="impact" defaultValue={impact}>
            {impacts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FormSelect>
        </FormField>
      ) : null}
      <FormField label="Bilgilendirme" htmlFor={`upd-message-${incidentId}`} required hint="Kamuya açık görünür." className="sm:col-span-2">
        <FormTextarea name="message" rows={2} maxLength={2000} required />
      </FormField>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button variant="navy" size="sm" type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Güncellemeyi yayınla
        </Button>
        <Msg res={res} />
      </div>
    </form>
  );
}

export function IncidentDeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const run = () => {
    setConfirming(false);
    setRes(null);
    start(async () => {
      const r = await deleteStatusIncident(id);
      if (r.error) setRes({ ok: false, text: r.error });
      router.refresh();
    });
  };
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {confirming ? (
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5 text-xs font-semibold text-amber-700">
          Kamu geçmişinden de silinsin mi?
          <Button variant="danger" size="xs" type="button" onClick={run}>
            Sil
          </Button>
          <Button variant="outline" size="xs" type="button" onClick={() => setConfirming(false)}>
            Vazgeç
          </Button>
        </span>
      ) : (
        <Button variant="outline" size="xs" type="button" disabled={pending} onClick={() => setConfirming(true)} aria-label={`${title} kaydını sil`}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Sil
        </Button>
      )}
      <Msg res={res} />
    </span>
  );
}
