"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormInput, FormSelect } from "@/components/ui/form-controls";
import { setFeatureRequestStatus } from "@/app/actions/platform-feedback";

const VOTER_STATUSES = new Set(["planlandi", "yapiliyor", "yayinda"]);

/**
 * Öneri satırı: durum (planlandı / yapılıyor / yayında ...) + ofislere görünen kısa not. "Yayında" seçilince yayımlanmış
 * bir yenilik (changelog) girdisi bağlanabilir. Durum değişince önerene; Planlandı/Yapılıyor/Yayında'da oy veren tüm
 * ofislere bildirim gider (PA-10). Kayıttan sonra kaç ofise bildirim gittiği satırda yazılır.
 */
export function RequestStatusForm({
  id,
  status,
  note,
  options,
  voteCount,
  changelogId,
  changelogOptions,
}: {
  id: string;
  status: string;
  note: string;
  options: { value: string; label: string }[];
  voteCount: number;
  changelogId: string | null;
  changelogOptions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [current, setCurrent] = useState(status);
  const willNotify = current !== status && VOTER_STATUSES.has(current) && voteCount > 0;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        setDone(null);
        start(async () => {
          const r = await setFeatureRequestStatus(fd);
          if (r.error) setError(r.error);
          else {
            setDone(r.notified ? `Kaydedildi · ${r.notified} kişiye bildirim gitti` : "Kaydedildi");
            router.refresh();
          }
        });
      }}
    >
      <input type="hidden" name="id" value={id} />
      <FormSelect name="status" value={current} onChange={(e) => setCurrent(e.target.value)} aria-label="Öneri durumu" className="w-full sm:w-auto">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </FormSelect>
      {current === "yayinda" ? (
        <FormSelect name="changelog_entry_id" defaultValue={changelogId ?? ""} aria-label="Duyurulduğu yenilik" className="w-full min-w-0 sm:w-64">
          <option value="">Yenilik bağlantısı yok</option>
          {changelogOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </FormSelect>
      ) : null}
      <FormInput name="admin_note" defaultValue={note} maxLength={600} placeholder="Ofislere not (isteğe bağlı)" aria-label="Ofislere görünen not" className="w-full min-w-0 flex-1 sm:w-64" />
      <Button type="submit" variant="navy" size="sm" loading={pending} className="w-full sm:w-auto">
        Kaydet
      </Button>
      {willNotify ? (
        <span className="basis-full text-xs text-text-muted" role="status">
          Kaydedince oy veren {voteCount} ofise bildirim gider{current === "yayinda" ? "; yenilik seçerseniz bildirim ona götürür" : ""}.
        </span>
      ) : null}
      {done ? (
        <span role="status" className="basis-full text-xs font-semibold text-[color:var(--pm-success-text)]">
          {done}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="basis-full text-xs font-semibold text-danger-600">
          {error}
        </span>
      ) : null}
    </form>
  );
}
