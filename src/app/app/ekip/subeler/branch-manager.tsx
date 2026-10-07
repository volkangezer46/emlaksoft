"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { Building2, Check, Pencil, Phone, Plus, Power, Trash2, UserRound, X } from "lucide-react";
import { createBranch, deleteBranch, updateBranch } from "@/app/actions/team";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { formatTurkishPhone } from "@/lib/phone";
import { ROLE_LABELS } from "@/lib/role-labels";

export type BranchRow = {
  id: string;
  name: string;
  is_active: boolean;
  province_id: string | null;
  province_name: string | null;
  manager_user_id: string | null;
  phone: string | null;
  member_count: number;
  active_member_count: number;
};
export type ManagerOption = { id: string; name: string; roleLabel: string };
type Province = { id: string; name: string };

function Fields({
  idPrefix,
  branch,
  managers,
  provinces,
  phoneSupported,
}: {
  idPrefix: string;
  branch?: BranchRow;
  managers: ManagerOption[];
  provinces: Province[];
  phoneSupported: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Şube adı" htmlFor={`${idPrefix}-name`} required>
        <FormInput id={`${idPrefix}-name`} name="name" required maxLength={120} defaultValue={branch?.name ?? ""} placeholder="Örn. Merkez Şube" />
      </FormField>
      <FormField label="İl" htmlFor={`${idPrefix}-il`}>
        <FormSelect id={`${idPrefix}-il`} name="province_id" defaultValue={branch?.province_id ?? ""}>
          <option value="">İl seçilmedi</option>
          {provinces.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label={ROLE_LABELS.branch_manager} htmlFor={`${idPrefix}-mgr`} hint="Ofisin aktif üyelerinden seçilir.">
        <FormSelect id={`${idPrefix}-mgr`} name="manager_user_id" defaultValue={branch?.manager_user_id ?? ""}>
          <option value="">Atanmadı</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>{m.name} · {m.roleLabel}</option>
          ))}
        </FormSelect>
      </FormField>
      {phoneSupported ? (
        <FormField label="Şube telefonu" htmlFor={`${idPrefix}-tel`}>
          <PhoneInput id={`${idPrefix}-tel`} name="phone" defaultValue={branch?.phone ?? ""} />
        </FormField>
      ) : null}
    </div>
  );
}

/** Şubeler: ekle, düzenle, aktif/pasif, müdür ataması, sil — hepsi sayfa içinde (popup yok). */
export function BranchManager({
  branches,
  managers,
  provinces,
  phoneSupported,
  canManage,
}: {
  branches: BranchRow[];
  managers: ManagerOption[];
  provinces: Province[];
  phoneSupported: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: "delete" | "toggle" } | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const managerName = new Map(managers.map((m) => [m.id, m.name]));

  function run(action: () => Promise<{ error?: string }>, okText: string, after?: () => void) {
    startTransition(async () => {
      const res = await action();
      if (res.error) setMessage({ tone: "danger", text: res.error });
      else {
        setMessage({ tone: "success", text: okText });
        after?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      {canManage ? (
        adding ? (
          <form
            action={(fd) =>
              run(() => createBranch({}, fd), "Şube eklendi.", () => setAdding(false))
            }
            className="space-y-3 rounded-[var(--radius-card)] border border-brand-300 bg-canvas/60 p-4"
          >
            <p className="flex items-center gap-2 text-sm font-bold text-ink-950"><Building2 className="h-4 w-4 text-brand-600" /> Yeni şube</p>
            <Fields idPrefix="new" managers={managers} provinces={provinces} phoneSupported={phoneSupported} />
            <div className="flex gap-2">
              <Button type="submit" icon={Check} loading={pending}>Şubeyi ekle</Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>Vazgeç</Button>
            </div>
          </form>
        ) : (
          <Button type="button" icon={Plus} onClick={() => setAdding(true)}>Şube ekle</Button>
        )
      ) : null}

      {branches.length === 0 ? (
        <EmptyState
          variant="compact"
          icon={Building2}
          title="Henüz şube tanımlanmadı"
          description="Tek ofis olarak da çalışabilirsiniz. Şube tanımlayınca üyeler şubeye bağlanır, şube müdürü atanır ve raporlar şube bazında ayrışır."
          action={canManage && !adding ? { node: <Button type="button" icon={Plus} onClick={() => setAdding(true)}>İlk şubeyi ekle</Button> } : undefined}
          secondary={{ href: "/app/ekip", label: "Ekip üyeleri" }}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {branches.map((b) =>
            editingId === b.id ? (
              <form
                key={b.id}
                action={(fd) => {
                  fd.set("id", b.id);
                  run(() => updateBranch(fd), "Şube güncellendi.", () => setEditingId(null));
                }}
                className="space-y-3 rounded-[var(--radius-card)] border border-brand-300 bg-canvas/60 p-4 md:col-span-2 xl:col-span-3"
              >
                <Fields idPrefix={`e-${b.id}`} branch={b} managers={managers} provinces={provinces} phoneSupported={phoneSupported} />
                <div className="flex gap-2">
                  <Button type="submit" icon={Check} loading={pending}>Kaydet</Button>
                  <Button type="button" variant="secondary" onClick={() => setEditingId(null)}>Vazgeç</Button>
                </div>
              </form>
            ) : (
              <article key={b.id} className={`rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4 ${b.is_active ? "" : "opacity-70"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600"><Building2 className="h-4 w-4" /></span>
                  <span className="flex items-center gap-1.5">
                    {!b.is_active ? <span className="rounded-full bg-ink-950/8 px-2 py-0.5 text-xs font-semibold text-text-muted">Pasif</span> : null}
                    <Link href="/app/ekip#uyeler" className="rounded-full bg-mint-500/10 px-2 py-0.5 text-xs font-bold text-mint-600 hover:bg-mint-500/20">
                      {b.active_member_count}/{b.member_count} aktif üye
                    </Link>
                  </span>
                </div>
                <p className="mt-3 font-display font-bold text-ink-950">{b.name}</p>
                <p className="text-xs text-text-muted">{b.province_name ?? "Konum belirtilmedi"}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
                  <UserRound className="h-3.5 w-3.5" />
                  {b.manager_user_id ? (managerName.get(b.manager_user_id) ?? "Müdür (pasif veya silinmiş)") : "Müdür atanmadı"}
                </p>
                {phoneSupported && b.phone ? (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
                    <Phone className="h-3.5 w-3.5" />
                    <a href={`tel:${b.phone}`} className="hover:text-brand-600">{formatTurkishPhone(b.phone)}</a>
                  </p>
                ) : null}

                {canManage ? (
                  confirm?.id === b.id ? (
                    <div className="mt-3 space-y-2 rounded-[var(--radius-control)] border border-danger-500/30 bg-danger-500/5 p-2.5">
                      <p className="text-xs text-text">
                        {confirm.kind === "delete"
                          ? "Şube kalıcı silinir. Bağlı üye varsa silinemez."
                          : b.is_active
                            ? `Şube pasife alınır${b.member_count > 0 ? `; ${b.member_count} üye şubede kalır` : ""}.`
                            : "Şube yeniden aktif olur."}
                      </p>
                      <div className="flex gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant={confirm.kind === "delete" || b.is_active ? "danger" : "primary"}
                          loading={pending}
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("id", b.id);
                            if (confirm.kind === "delete") {
                              run(() => deleteBranch(fd), "Şube silindi.", () => setConfirm(null));
                            } else {
                              fd.set("name", b.name);
                              fd.set("is_active", String(!b.is_active));
                              run(() => updateBranch(fd), b.is_active ? "Şube pasife alındı." : "Şube aktifleştirildi.", () => setConfirm(null));
                            }
                          }}
                        >
                          Onayla
                        </Button>
                        <Button type="button" size="sm" variant="secondary" icon={X} onClick={() => setConfirm(null)}>Vazgeç</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <Button type="button" size="sm" variant="secondary" icon={Pencil} onClick={() => { setEditingId(b.id); setMessage(null); }}>Düzenle</Button>
                      <Button type="button" size="sm" variant="secondary" icon={Power} onClick={() => setConfirm({ id: b.id, kind: "toggle" })}>
                        {b.is_active ? "Pasife al" : "Aktifleştir"}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirm({ id: b.id, kind: "delete" })}>Sil</Button>
                    </div>
                  )
                ) : null}
              </article>
            ),
          )}
        </div>
      )}
    </div>
  );
}
