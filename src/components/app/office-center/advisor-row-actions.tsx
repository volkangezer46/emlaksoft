"use client";

import Link from "@/components/ui/smart-link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ShieldCheck, UserMinus, UserCheck } from "lucide-react";
import { deactivateAdvisor, reactivateAdvisor, updateAdvisor } from "@/app/actions/office-center";
import { useToast } from "@/components/app/toast-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FormField, FormTextarea } from "@/components/ui/form-controls";
import { ROLE_LABELS } from "@/lib/role-labels";
import { Combobox } from "@/components/ui/combobox";
import { PersonSelect } from "@/components/ui/person-select";

export type RowAdvisor = { id: string; fullName: string; role: string; isActive: boolean; branchId: string | null; teamId: string | null };
export type Option = { id: string; name: string };

/**
 * Danışman satırı aksiyonları: rol (salt okunur + onaylı "Rolü değiştir"), şube / takım (anında kaydeder), pasife alma (devir seçeneğiyle, panel),
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
  const [nextRole, setNextRole] = useState<string | null>(null);
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
        {/* Rol salt okunur (WP3): tablo hücresinde açılır liste anında kaydetmiyor; "Rolü değiştir" seçimi onay ister. */}
        <span className="inline-flex h-8 items-center rounded-[var(--radius-control)] bg-surface-sunken px-2 text-xs font-semibold text-ink-950 touch:h-11">
          {ROLE_LABELS[advisor.role] ?? advisor.role}
        </span>
        {canAssignRole && roles.some((r) => r !== advisor.role) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="xs" icon={ShieldCheck} disabled={pending} aria-label={`${advisor.fullName}: rolü değiştir`}>
                Rolü değiştir
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Yeni rol</DropdownMenuLabel>
              {roles
                .filter((r) => r !== advisor.role)
                .map((r) => (
                  <DropdownMenuItem key={r} onSelect={() => setNextRole(r)}>
                    {ROLE_LABELS[r] ?? r}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <ConfirmDialog
          open={nextRole !== null}
          onOpenChange={(o) => {
            if (!o) setNextRole(null);
          }}
          tone="default"
          title="Rol değiştirilsin mi?"
          description={`${advisor.fullName}: ${ROLE_LABELS[advisor.role] ?? advisor.role} → ${nextRole ? (ROLE_LABELS[nextRole] ?? nextRole) : ""}. Görebildiği kayıtlar ve yapabildiği işlemler hemen bu role göre değişir.`}
          confirmLabel="Rolü değiştir"
          successMessage="Rol güncellendi."
          onConfirm={async () => {
            if (!nextRole) return;
            const res = await updateAdvisor({ advisorId: advisor.id, role: nextRole });
            if (!res.error) {
              setNextRole(null);
              router.refresh();
            }
            return res;
          }}
        />
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
          <Button type="button" variant="ghost" size="xs" icon={UserMinus} aria-expanded={deact} aria-controls={panelId} title="İşlerini devret ve pasife al" onClick={() => setDeact((v) => !v)}>
            Pasife al
          </Button>
        ) : (
          <Button type="button" variant="secondary" size="xs" icon={UserCheck} loading={pending} onClick={() => run(() => reactivateAdvisor(advisor.id))}>
            Aktifleştir
          </Button>
        )}
      </div>
      {error && !deact ? <p className="text-xs font-medium text-danger-600">{error}</p> : null}
      {deact ? (
        <div id={panelId} className="grid min-w-[18rem] gap-3 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/8 p-3">
          {/* C25: pasife alma DEVİR akışıyla açılır — önce işler kime geçecek, sonra pasife alma. */}
          <p className="text-sm text-ink-950">
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
            <div>
              <Alert tone="danger" title="İşlem yapılamadı">
                {error}
              </Alert>
            </div>
          ) : null}
          <div className="flex gap-2">
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
