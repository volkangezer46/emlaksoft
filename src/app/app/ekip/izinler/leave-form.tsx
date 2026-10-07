"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { InlinePanel, InlinePanelTrigger } from "@/components/ui/inline-panel";
import { createLeave, type LeaveResult } from "@/app/actions/staff-leaves";
import { LEAVE_KIND_LABELS, type LeaveKind } from "@/lib/leave-utils";

const initial: LeaveResult = {};

export const LEAVE_PANEL_ID = "izin-ekle";

const KIND_OPTIONS = (Object.keys(LEAVE_KIND_LABELS) as LeaveKind[]).map((k) => ({
  value: k,
  label: LEAVE_KIND_LABELS[k],
}));

type PanelProps = {
  members: { id: string; full_name: string }[];
  canManage: boolean;
  selfId: string;
  selfName: string;
  today: string;
};

/** Hero'daki "İzin ekle" düğmesi: sayfa içi paneli açar/kapatır. */
export function AddLeaveTrigger({
  className = "btn-shine bg-white px-4 py-2.5 font-semibold text-ink-950 hover:bg-white/90",
}: { className?: string } = {}) {
  return (
    <InlinePanelTrigger panelId={LEAVE_PANEL_ID} className={className}>
      <CalendarPlus className="h-4 w-4" /> İzin ekle
    </InlinePanelTrigger>
  );
}

/**
 * "İzin ekle" sayfa içi paneli.
 *
 * YETKİ: `canManage` (team:edit) olan personel seçici görür ve kaydı doğrudan
 * ONAYLI açar; yetkisi olmayan yalnız kendi adına TALEP oluşturur (seçici
 * yerine sabit ad gösterilir). Bu ayrım sunucuda da uygulanır — buradaki
 * gizleme sadece arayüz kolaylığıdır, güvenlik sınırı `createLeave` içindedir.
 *
 * Tarih varsayılanı sunucudan `today` olarak gelir (render'da `new Date()` YASAK,
 * bkz. src/lib/clock.ts).
 */
export function AddLeavePanel(props: PanelProps) {
  return (
    <InlinePanel
      id={LEAVE_PANEL_ID}
      title={props.canManage ? "İzin ekle" : "İzin talebi oluştur"}
      description={
        props.canManage
          ? "Kayıt doğrudan onaylı olarak eklenir; bu tarihlerde online randevu linki kapanır."
          : "Talebiniz yöneticinizin onayına düşer. Onaylanınca o günlerde randevu alınamaz."
      }
      icon={<CalendarPlus />}
    >
      {(close) => <AddLeaveForm {...props} onDone={close} />}
    </InlinePanel>
  );
}

function AddLeaveForm({
  members,
  canManage,
  selfId,
  selfName,
  today,
  onDone,
}: PanelProps & { onDone: () => void }) {
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState(async (prev: LeaveResult, formData: FormData) => {
    const result = await createLeave(formData);
    if (result.ok) {
      startTransition(() => {
        formRef.current?.reset();
        router.refresh();
        onDone();
      });
    }
    return result;
  }, initial);

  return (
    <form ref={formRef} action={action} className="grid gap-4 p-4 md:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm text-text-muted" htmlFor="leave_staff">
            Personel
          </label>
          {canManage ? (
            <select
              id="leave_staff"
              name="staff_id"
              defaultValue={selfId}
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                  {m.id === selfId ? " (siz)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input type="hidden" name="staff_id" value={selfId} />
              <p
                id="leave_staff"
                className="rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold text-ink-950"
              >
                {selfName}
              </p>
              <p className="mt-1.5 text-xs text-text-faint">
                Başkası adına izin girmek için ekip düzenleme yetkisi gerekir.
              </p>
            </>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-text-muted" htmlFor="kind">
            Tür
          </label>
          <select
            id="kind"
            name="kind"
            defaultValue="izin"
            className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm text-text-muted" htmlFor="starts_on">
            Başlangıç *
          </label>
          <input
            id="starts_on"
            name="starts_on"
            type="date"
            required
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              // Bitiş geride kalmasın — DB'deki ends_on >= starts_on kısıtı
              // kullanıcıyı hata mesajıyla karşılamadan burada düzeltilir.
              if (e.target.value > end) setEnd(e.target.value);
            }}
            className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-text-muted" htmlFor="ends_on">
            Bitiş * <span className="text-text-faint">(gün dahil)</span>
          </label>
          <input
            id="ends_on"
            name="ends_on"
            type="date"
            required
            min={start}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="note">
          Not
        </label>
        <textarea
          id="note"
          name="note"
          rows={2}
          maxLength={500}
          placeholder="Örn. Yıllık izin — acil durumda telefonla ulaşılabilir"
          className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
        />
      </div>

      {state.error ? (
        <p className="text-sm font-medium text-danger-600" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="hairline-t flex justify-end gap-2 pt-4">
        <button
          type="button"
          onClick={onDone}
          className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas"
        >
          Vazgeç
        </button>
        <button
          type="submit"
          disabled={pending}
          className="btn-shine focus-ring press rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? "Kaydediliyor…" : canManage ? "İzni kaydet" : "Talebi gönder"}
        </button>
      </div>
    </form>
  );
}
