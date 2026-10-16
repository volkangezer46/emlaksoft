"use client";

import Link from "@/components/ui/smart-link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, UserMinus, UserCheck } from "lucide-react";
import { deactivateAdvisor, reactivateAdvisor, updateAdvisor } from "@/app/actions/office-center";
import { useToast } from "@/components/app/toast-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { ROLE_LABELS } from "@/lib/role-labels";
import { Combobox } from "@/components/ui/combobox";
import { PersonSelect } from "@/components/ui/person-select";

export type RowAdvisor = { id: string; fullName: string; role: string; isActive: boolean; branchId: string | null; teamId: string | null };
export type Option = { id: string; name: string };

/**
 * Danışman satırı aksiyonları: rol / şube / takım (anında kaydeder), pasife alma (devir seçeneğiyle, panel),
 * yeniden aktifleştirme. Ayrıcalıklı iş sunucuda mevcut ekip eylemlerine delege edilir.
 */
export function AdvisorRowActions({
  advisor,
  roles,
  branches,
  teams,
  teamsAvailable,
  handoffTargets,
}: {
  advisor: RowAdvisor;
  roles: readonly string[];
  branches: Option[];
  teams: Option[];
  teamsAvailable: boolean;
  /** Devralabilecek aktif danışmanlar (bu satır hariç). */
  handoffTargets: Option[];
}) {
  const [deact, setDeact] = useState(false);
  const [handoffTo, setHandoffTo] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { push } = useToast();

  function run(task: () => Promise<{ ok?: boolean; error?: string; message?: string }>) {
    setError(null);
    start(async () => {
      const res = await task();
      if (res.error) {
        setError(res.error);
        push(res.error, "err");
        return;
      }
      push(res.message ?? "Kaydedildi.", "ok");
      setDeact(false);
      router.refresh();
    });
  }

  const canAssignRole = roles.includes(advisor.role);
  const panelId = `oc-deact-${advisor.id}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="sr-only" htmlFor={`oc-role-${advisor.id}`}>
          Rol
        </label>
        <FormSelect
          id={`oc-role-${advisor.id}`}
          className="h-8 touch:h-11 w-auto px-2 py-1 text-xs"
          value={advisor.role}
          disabled={pending || !canAssignRole}
          title={canAssignRole ? "Rolü değiştir" : "Bu rolü yönetme yetkiniz yok"}
          onChange={(e) => run(() => updateAdvisor({ advisorId: advisor.id, role: e.target.value }))}
        >
          {(canAssignRole ? roles : [advisor.role]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r] ?? r}
            </option>
          ))}
        </FormSelect>
        {branches.length ? (
          <>
            <label className="sr-only" htmlFor={`oc-branch-${advisor.id}`}>
              Şube
            </label>
            <Combobox
              id={`oc-branch-${advisor.id}`}
              className="w-auto min-w-[9rem] px-2 py-1 text-xs"
              value={advisor.branchId ?? ""}
              disabled={pending}
              onValueChange={(v) => run(() => updateAdvisor({ advisorId: advisor.id, branchId: v }))}
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
              placeholder="Şubesiz"
              searchPlaceholder="Şube ara…"
              emptyText="Eşleşen şube yok"
            />
          </>
        ) : null}
        {teamsAvailable && teams.length ? (
          <>
            <label className="sr-only" htmlFor={`oc-team-${advisor.id}`}>
              Takım
            </label>
            <Combobox
              id={`oc-team-${advisor.id}`}
              className="w-auto min-w-[9rem] px-2 py-1 text-xs"
              value={advisor.teamId ?? ""}
              disabled={pending}
              onValueChange={(v) => run(() => updateAdvisor({ advisorId: advisor.id, teamId: v }))}
              options={teams.map((t) => ({ value: t.id, label: t.name }))}
              placeholder="Takımsız"
              searchPlaceholder="Takım ara…"
              emptyText="Eşleşen takım yok"
            />
          </>
        ) : null}
        {advisor.isActive ? (
          <Button type="button" variant="ghost" size="xs" icon={UserMinus} aria-expanded={deact} aria-controls={panelId} onClick={() => setDeact((v) => !v)}>
            Devret ve pasife al
          </Button>
        ) : (
          <Button type="button" variant="secondary" size="xs" icon={UserCheck} loading={pending} onClick={() => run(() => reactivateAdvisor(advisor.id))}>
            Aktifleştir
          </Button>
        )}
      </div>
      {error && !deact ? <p className="text-xs font-medium text-danger-600">{error}</p> : null}
      {deact ? (
        <div id={panelId} className="grid gap-3 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/8 p-3 sm:grid-cols-2">
          {/* C25: pasife alma DEVİR akışıyla açılır — önce işler kime geçecek, sonra pasife alma. */}
          <p className="text-sm text-ink-950 sm:col-span-2">
            <span className="font-semibold">{advisor.fullName}</span> pasife alınacak: giriş yapamaz, veriler silinmez. Önce müşteri, portföy, açık anlaşma,
            görev ve randevularını kime devredeceğinizi seçin.{" "}
            <Link href={`/app/ekip/devir?from=${advisor.id}`} className="font-semibold text-brand-600 hover:underline">
              Kalem kalem devret
            </Link>
          </p>
          <FormField label="İşleri devralacak kişi" htmlFor={`${panelId}-to`}>
            <PersonSelect
              id={`${panelId}-to`}
              value={handoffTo}
              onValueChange={setHandoffTo}
              people={handoffTargets}
              emptyLabel="Devir yapma"
            />
          </FormField>
          <FormField label="Gerekçe" htmlFor={`${panelId}-reason`} required={Boolean(handoffTo)} hint="Devir seçildiyse zorunlu (en az 5 karakter); denetim kaydına yazılır.">
            <FormTextarea id={`${panelId}-reason`} rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          {error ? (
            <div className="sm:col-span-2">
              <Alert tone="danger" title="İşlem yapılamadı">
                {error}
              </Alert>
            </div>
          ) : null}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="button" variant="danger" size="sm" icon={handoffTo ? ArrowLeftRight : UserMinus} loading={pending} onClick={() => run(() => deactivateAdvisor({ advisorId: advisor.id, handoffTo, reason }))}>
              {handoffTo ? "Devret ve pasife al" : "Pasife al"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDeact(false)}>
              Vazgeç
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
