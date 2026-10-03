"use client";

import { useActionState, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { InlinePanel, InlinePanelTrigger } from "@/components/ui/inline-panel";
import { createBranch, type TeamResult } from "@/app/actions/team";

type Province = { id: string; name: string };

const initial: TeamResult = {};

export const BRANCH_PANEL_ID = "ekip-sube-ekle";

/** Şubeler başlığındaki "Şube ekle" düğmesi. */
export function AddBranchTrigger() {
  return (
    <InlinePanelTrigger panelId={BRANCH_PANEL_ID} variant="secondary" size="sm" icon={Building2}>
      Şube ekle
    </InlinePanelTrigger>
  );
}

export function AddBranchPanel({ provinces }: { provinces: Province[] }) {
  return (
    <InlinePanel
      id={BRANCH_PANEL_ID}
      title="Şube ekle"
      description="Ofisinize yeni bir şube tanımlayın."
      icon={<Building2 />}
      className="mt-4"
    >
      {(close) => <AddBranchForm provinces={provinces} onDone={close} />}
    </InlinePanel>
  );
}

function AddBranchForm({ provinces, onDone }: { provinces: Province[]; onDone: () => void }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState(async (prev: TeamResult, formData: FormData) => {
    const result = await createBranch(prev, formData);
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
    <form ref={formRef} action={action} className="grid gap-4 p-4 sm:grid-cols-2 md:p-6">
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="branch_name">Şube adı *</label>
        <input id="branch_name" name="name" required className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" placeholder="Örn. Merkez Şube" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="province_id">İl</label>
        <select id="province_id" name="province_id" defaultValue="" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
          <option value="">Seçiniz</option>
          {provinces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {state.error ? <p className="text-sm font-medium text-danger-600 sm:col-span-2" role="alert">{state.error}</p> : null}
      <div className="hairline-t flex justify-end gap-2 pt-4 sm:col-span-2">
        <button type="button" onClick={onDone} className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">Vazgeç</button>
        <button type="submit" disabled={pending} className="btn-shine focus-ring press rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">{pending ? "Ekleniyor…" : "Şubeyi ekle"}</button>
      </div>
    </form>
  );
}
