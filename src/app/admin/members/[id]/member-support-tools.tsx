"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Loader2,
  ShieldOff,
  UserMinus,
  X,
} from "lucide-react";
import {
  getMemberHandoffSnapshot,
  handoffMemberWorkloadAsStaff,
  resetMemberTwoFactor,
} from "@/app/actions/platform-member-access";
import { setMemberActiveAsStaff } from "@/app/actions/platform-members";
import { Button } from "@/components/ui/button";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { PersonSelect } from "@/components/ui/person-select";
import {
  HANDOFF_SCOPES,
  HANDOFF_SCOPE_LABELS,
  type HandoffScope,
} from "@/lib/team/handoff";
import { ROLE_LABELS } from "@/lib/role-labels";

/**
 * Üye destek araçları (Admin > Üye > Erişim):
 *  - SMS 2FA sıfırlama: telefonu kaybeden danışman; gerekçe zorunlu, oturumlar kapanır, üyeye bildirim düşer.
 *  - Pasifleştirme sihirbazı: önce iş yükü (portföy, müşteri, görev ...) GERÇEK sayımla gösterilir, hedef danışman
 *    seçilir ve devredilir; devirden sonra kalan sayım yeniden okunur, ardından üye pasifleştirilir. Devredecek kayıt
 *    yoksa doğrudan pasifleştirme adımına geçilir.
 */

type Notice = { tone: "ok" | "error"; text: string } | null;

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={`rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${notice.tone === "error" ? "bg-danger-500/8 text-danger-600" : "bg-mint-500/10 text-mint-700"}`}
    >
      {notice.text}
    </p>
  );
}

export function TwoFactorResetPanel({
  id,
  enabled,
  canReset,
}: {
  id: string;
  enabled: boolean;
  canReset: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  function submit() {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("reason", reason);
    setNotice(null);
    setConfirming(false);
    start(async () => {
      const res = await resetMemberTwoFactor(fd);
      if (res.error) setNotice({ tone: "error", text: res.error });
      else {
        setNotice({
          tone: "ok",
          text: "SMS 2FA kapatıldı, açık oturumlar sonlandırıldı ve üyeye bildirim gönderildi.",
        });
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <h2 className="font-display font-bold text-ink-950">
        İki adımlı doğrulama (SMS)
      </h2>
      <p className="text-xs text-text-muted">
        Durum:{" "}
        <strong className="text-ink-950">{enabled ? "açık" : "kapalı"}</strong>.
        Telefonunu kaybeden üyede sıfırlama SMS doğrulamasını kapatır, eski
        doğrulamaları geçersiz kılar ve açık oturumları sonlandırır; üye
        parolasıyla girip 2FA’yı yeni telefonuyla yeniden açar.
      </p>
      {!canReset ? (
        <p className="mt-3 text-xs text-text-faint">
          2FA sıfırlama süper admin ve operasyon içindir.
        </p>
      ) : !enabled ? null : (
        <div className="mt-3 space-y-3">
          <FormField
            label="Gerekçe (zorunlu; ofis denetim kaydına yazılır)"
            htmlFor="tfa_reason"
          >
            <FormInput
              id="tfa_reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="Ör. telefon kaybı, kimlik destek hattında doğrulandı"
            />
          </FormField>
          {confirming ? (
            <span className="inline-flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-800">
              2FA kapatılsın ve tüm oturumlar sonlandırılsın mı?
              <Button type="button" size="sm" variant="navy" onClick={submit}>
                Evet, sıfırla
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirming(false)}
              >
                Vazgeç
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || reason.trim().length < 5}
              onClick={() => setConfirming(true)}
              className="border-danger-500/40 text-danger-600"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <ShieldOff className="h-3.5 w-3.5" aria-hidden />
              )}{" "}
              2FA’yı sıfırla
            </Button>
          )}
        </div>
      )}
      <div className="mt-3">
        <NoticeLine notice={notice} />
      </div>
    </section>
  );
}

export type HandoffSnapshot = {
  counts: Record<HandoffScope, number>;
  candidates: { id: string; name: string; role: string }[];
};

/** Sihirbazı açan düğme için: sayımları tıklamada çeker (efekt yok), sonucu sihirbaza verir. */
export async function loadHandoffSnapshot(
  id: string,
): Promise<{ snapshot?: HandoffSnapshot; error?: string }> {
  const res = await getMemberHandoffSnapshot(id);
  if (res.error || !res.counts)
    return { error: res.error ?? "İş yükü okunamadı." };
  return { snapshot: { counts: res.counts, candidates: res.candidates ?? [] } };
}

/** Pasifleştirme sihirbazı: Sayımlar → (varsa) devir → pasifleştir. */
export function DeactivateWizard({
  id,
  name,
  initial,
  onCancel,
}: {
  id: string;
  name: string;
  initial: HandoffSnapshot;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [snap, setSnap] = useState<HandoffSnapshot>(initial);
  const [notice, setNotice] = useState<Notice>(null);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [scopes, setScopes] = useState<HandoffScope[]>([...HANDOFF_SCOPES]);

  const total = HANDOFF_SCOPES.reduce((n, s) => n + snap.counts[s], 0);

  function handoff() {
    const fd = new FormData();
    fd.set("from", id);
    fd.set("to", to);
    fd.set("reason", reason);
    for (const s of HANDOFF_SCOPES)
      fd.set(`scope_${s}`, scopes.includes(s) ? "1" : "0");
    setNotice(null);
    start(async () => {
      const res = await handoffMemberWorkloadAsStaff(fd);
      if (res.error) {
        setNotice({ tone: "error", text: res.error });
        return;
      }
      const moved = HANDOFF_SCOPES.filter((s) => (res.counts?.[s] ?? 0) > 0)
        .map((s) => `${res.counts?.[s]} ${HANDOFF_SCOPE_LABELS[s]}`)
        .join(", ");
      const remaining = res.remaining;
      if (remaining) setSnap((prev) => ({ ...prev, counts: remaining }));
      setNotice({
        tone: "ok",
        text: moved
          ? `Devredildi: ${moved}. Şimdi üyeyi pasifleştirebilirsiniz.`
          : "Devredilecek kayıt kalmamış.",
      });
      router.refresh();
    });
  }

  function deactivate() {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("is_active", "false");
    fd.set("via", "handoff");
    setNotice(null);
    start(async () => {
      const res = await setMemberActiveAsStaff(fd);
      if (res.error) setNotice({ tone: "error", text: res.error });
      else {
        setNotice({
          tone: "ok",
          text: "Üye pasifleştirildi; açık oturumları kapatıldı.",
        });
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-3 space-y-4 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink-950">
            {name} pasifleştiriliyor
          </p>
          <p className="text-xs text-text-muted">
            Önce üzerindeki iş yükünü başka bir danışmana devredin; sahipsiz
            kayıt kalmasın.
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onCancel}
          aria-label="Sihirbazı kapat"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <ul className="grid gap-2 sm:grid-cols-5" aria-label="Üzerindeki iş yükü">
        {HANDOFF_SCOPES.map((s) => (
          <li
            key={s}
            className="rounded-[var(--radius-control)] border border-line bg-surface p-3"
          >
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={scopes.includes(s)}
                disabled={snap.counts[s] === 0}
                onChange={(e) =>
                  setScopes((prev) =>
                    e.target.checked
                      ? [...prev, s]
                      : prev.filter((x) => x !== s),
                  )
                }
              />
              <span>
                <span className="numeric block font-display text-xl font-extrabold text-ink-950">
                  {snap.counts[s]}
                </span>
                <span className="text-xs text-text-muted">
                  {HANDOFF_SCOPE_LABELS[s]}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {total > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Devralan danışman" htmlFor="handoff_to">
            <PersonSelect
              id="handoff_to"
              aria-label="Devralan danışman"
              emptyLabel="Seçin"
              value={to}
              onValueChange={setTo}
              people={snap.candidates.map((c) => ({
                id: c.id,
                name: c.name,
                hint: ROLE_LABELS[c.role] ?? c.role,
              }))}
            />
          </FormField>
          <FormField label="Devir gerekçesi (zorunlu)" htmlFor="handoff_reason">
            <FormInput
              id="handoff_reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="Ör. danışman ofisten ayrıldı"
            />
          </FormField>
          <div className="sm:col-span-2">
            <Button
              type="button"
              size="sm"
              variant="navy"
              disabled={
                busy ||
                !to ||
                reason.trim().length < 5 ||
                !scopes.some((s) => snap.counts[s] > 0)
              }
              onClick={handoff}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              )}{" "}
              Seçilenleri devret
            </Button>
            {snap.candidates.length === 0 ? (
              <p className="mt-2 text-xs text-danger-600">
                Ofiste devralabilecek başka aktif kullanıcı yok.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm font-semibold text-mint-700">
          <Check className="h-4 w-4" aria-hidden /> Üzerinde devredilecek kayıt
          yok.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button
          type="button"
          size="sm"
          variant={total > 0 ? "outline" : "navy"}
          disabled={busy}
          onClick={deactivate}
          className={
            total > 0 ? "border-danger-500/40 text-danger-600" : undefined
          }
        >
          <UserMinus className="h-3.5 w-3.5" aria-hidden />{" "}
          {total > 0 ? "Devretmeden pasifleştir" : "Pasifleştir"}
        </Button>
        {total > 0 ? (
          <span className="text-xs text-text-muted">
            Devredilmeyen kayıtlar pasif üyede kalır ve ofis yöneticisi sonradan
            devredebilir.
          </span>
        ) : null}
      </div>
      <NoticeLine notice={notice} />
    </div>
  );
}
