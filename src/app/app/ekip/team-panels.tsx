"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, RefreshCw, UserPlus } from "lucide-react";
import { InlinePanel, InlinePanelTrigger } from "@/components/ui/inline-panel";
import { createBranch, createTeamMember, type TeamResult } from "@/app/actions/team";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmailInput } from "@/components/ui/email-input";

type Branch = { id: string; name: string };
type Province = { id: string; name: string };

const initial: TeamResult = {};

export const MEMBER_PANEL_ID = "ekip-uye-ekle";
export const BRANCH_PANEL_ID = "ekip-sube-ekle";

const roleOptions: { value: string; label: string }[] = [
  { value: "advisor", label: "Danışman" },
  { value: "team_lead", label: "Takım lideri" },
  { value: "branch_manager", label: "Şube müdürü" },
  { value: "gm", label: "Genel müdür" },
  { value: "call_center", label: "Çağrı merkezi" },
  { value: "accounting", label: "Muhasebe" },
  { value: "readonly", label: "Salt okunur" },
];

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const values = globalThis.crypto.getRandomValues(new Uint32Array(16));
  return Array.from(values, (value) => chars[value % chars.length]).join("");
}

/** Hero'daki "Ekip üyesi ekle" düğmesi: sayfa içi paneli açar/kapatır. */
export function AddMemberTrigger() {
  return (
    <InlinePanelTrigger panelId={MEMBER_PANEL_ID}>
      <UserPlus className="h-4 w-4" /> Ekip üyesi ekle
    </InlinePanelTrigger>
  );
}

export function AddMemberPanel({ branches }: { branches: Branch[] }) {
  return (
    <InlinePanel
      id={MEMBER_PANEL_ID}
      title="Ekip üyesi ekle"
      description="Yeni danışman veya personel hesabı açın."
      icon={<UserPlus />}
    >
      {(close) => <AddMemberForm branches={branches} onDone={close} />}
    </InlinePanel>
  );
}

// Form yalnız panel açıkken bağlanır: her açılışta temiz alanlar + yeni geçici şifre.
function AddMemberForm({ branches, onDone }: { branches: Branch[]; onDone: () => void }) {
  const [pw, setPw] = useState(randomPassword);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState(async (prev: TeamResult, formData: FormData) => {
    const result = await createTeamMember(prev, formData);
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
      <div className="sm:col-span-2">
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="full_name">Ad soyad *</label>
        <input id="full_name" name="full_name" required className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" placeholder="Örn. Merve Akın" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="email">E-posta *</label>
        <EmailInput id="email" name="email" required className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" placeholder="danisman@ofis.com" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="phone">Telefon</label>
        <PhoneInput id="phone" name="phone" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="role">Rol</label>
        <select id="role" name="role" defaultValue="advisor" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
          {roleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="branch_id">Şube</label>
        <select id="branch_id" name="branch_id" defaultValue="" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
          <option value="">Şube atanmadı</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1.5 block text-sm text-text-muted" htmlFor="password">Geçici şifre *</label>
        <div className="flex gap-2">
          <input id="password" name="password" value={pw} onChange={(e) => setPw(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm tabular-nums outline-none focus:border-brand-400" />
          <button type="button" onClick={() => setPw(randomPassword())} className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 text-xs font-semibold text-text-muted hover:border-brand-300 hover:text-brand-600" aria-label="Yeni şifre üret"><RefreshCw className="h-3.5 w-3.5" /> Üret</button>
        </div>
        <p className="mt-1.5 text-xs text-text-faint">Bu şifreyi üyeye iletin; ilk girişte değiştirmesini önerin.</p>
      </div>

      {state.error ? <p className="text-sm font-medium text-danger-600 sm:col-span-2" role="alert">{state.error}</p> : null}

      <div className="hairline-t flex justify-end gap-2 pt-4 sm:col-span-2">
        <button type="button" onClick={onDone} className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">Vazgeç</button>
        <button type="submit" disabled={pending} className="btn-shine focus-ring press rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60">{pending ? "Ekleniyor…" : "Üyeyi ekle"}</button>
      </div>
    </form>
  );
}

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
