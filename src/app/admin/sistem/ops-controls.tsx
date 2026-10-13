"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BellOff, Bell, Loader2, Pause, Play, Plus, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmailInput } from "@/components/ui/email-input";
import {
  createAlertChannel,
  deleteAlertChannel,
  muteAlertRule,
  setAlertChannelEnabled,
  setCronPaused,
  testAlertChannel,
  updateAlertRule,
  type OpsResult,
} from "@/app/actions/platform-ops";

/**
 * Operasyon merkezi istemci denetimleri: cron duraklatma, uyarı kanalı ekleme/deneme/kapatma/silme, kural düzenleme
 * ve sessize alma. Onaylar satır içidir (popup yok); sonuç mesajı denetimin yanında kalır, ardından sayfa tazelenir.
 */

const field =
  "focus-ring h-10 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 text-sm text-ink-950 outline-none focus:border-brand-300";

function Msg({ res }: { res: { ok: boolean; text: string } | null }) {
  if (!res) return null;
  return (
    <span role={res.ok ? "status" : "alert"} className={`text-xs font-semibold ${res.ok ? "text-mint-700" : "text-danger-600"}`}>
      {res.text}
    </span>
  );
}

function useOps() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  function run(fn: () => Promise<OpsResult>, okText: string) {
    setRes(null);
    start(async () => {
      const r = await fn();
      setRes(r.error ? { ok: false, text: r.error } : { ok: true, text: r.detail ?? okText });
      router.refresh();
    });
  }
  return { pending, res, run };
}

/** Cron satırında "Duraklat / Sürdür" (yalnız süper admin görür). */
export function CronPauseButton({ job, label, paused }: { job: string; label: string; paused: boolean }) {
  const { pending, res, run } = useOps();
  const [confirming, setConfirming] = useState(false);
  const submit = (next: boolean) => {
    setConfirming(false);
    const fd = new FormData();
    fd.set("job", job);
    fd.set("paused", next ? "1" : "0");
    run(() => setCronPaused(fd), next ? "Duraklatıldı." : "Sürdürüldü.");
  };
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {confirming ? (
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5 text-xs font-semibold text-amber-800">
          “{label}” duraklatılsın mı?
          <Button variant="navy" size="xs" type="button" onClick={() => submit(true)}>
            Evet
          </Button>
          <Button variant="outline" size="xs" type="button" onClick={() => setConfirming(false)}>
            Vazgeç
          </Button>
        </span>
      ) : (
        <Button
          variant="outline"
          size="xs"
          type="button"
          disabled={pending}
          onClick={() => (paused ? submit(false) : setConfirming(true))}
          aria-label={`${label} işini ${paused ? "sürdür" : "duraklat"}`}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {paused ? "Sürdür" : "Duraklat"}
        </Button>
      )}
      <Msg res={res} />
    </span>
  );
}

/** Yeni uyarı kanalı formu: türe göre alanlar. Sırlar yalnız sunucuda şifrelenip saklanır. */
export function AlertChannelForm() {
  const router = useRouter();
  const [kind, setKind] = useState<"telegram" | "email" | "webhook">("telegram");
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setRes(null);
    start(async () => {
      const r = await createAlertChannel(fd);
      if (r.error) {
        setRes({ ok: false, text: r.error });
        return;
      }
      form.reset();
      setRes({ ok: true, text: "Kanal eklendi. Şimdi “Dene” ile bir deneme mesajı gönderin." });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-canvas p-4 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-semibold text-text-muted">
        Tür
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className={field}
        >
          <option value="telegram">Telegram bot</option>
          <option value="email">E-posta</option>
          <option value="webhook">Genel webhook</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-text-muted">
        Kanal adı
        <input name="name" required maxLength={80} placeholder="ör. Operasyon grubu" className={field} />
      </label>
      {kind === "telegram" ? (
        <>
          <label className="grid gap-1 text-xs font-semibold text-text-muted">
            Bot belirteci (BotFather)
            <input name="botToken" required autoComplete="off" spellCheck={false} placeholder="123456789:AA…" className={`${field} font-mono`} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-text-muted">
            Sohbet kimliği
            <input name="chatId" required autoComplete="off" spellCheck={false} placeholder="-100… veya @kanaladi" className={`${field} font-mono`} />
          </label>
        </>
      ) : kind === "email" ? (
        <label className="grid gap-1 text-xs font-semibold text-text-muted sm:col-span-2">
          Alıcı e-posta
          <EmailInput name="email" required placeholder="operasyon@ornek.com" className={field} />
        </label>
      ) : (
        <>
          <label className="grid gap-1 text-xs font-semibold text-text-muted">
            Adres (https)
            <input name="url" type="url" required spellCheck={false} placeholder="https://hooks.ornek.com/…" className={`${field} font-mono`} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-text-muted">
            İmza sırrı (isteğe bağlı)
            <input name="secret" autoComplete="off" spellCheck={false} placeholder="en az 16 karakter" className={`${field} font-mono`} />
          </label>
        </>
      )}
      <p className="text-xs text-text-faint sm:col-span-2">
        {kind === "email"
          ? "E-posta, Resend anahtarı ve gönderen tanımlıysa gider; değilse teslim günlüğüne “kanal kapalı” düşer."
          : kind === "webhook"
            ? "JSON gövde POST edilir; sır verilirse X-EmlakSoft-Signature: sha256=<HMAC> başlığı eklenir. İç ağ adresleri reddedilir."
            : "Botu gruba ekleyin; grup kimliği -100 ile başlar. Belirteç şifreli saklanır, ekranda bir daha gösterilmez."}
      </p>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button variant="navy" size="sm" type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Kanal ekle
        </Button>
        <Msg res={res} />
      </div>
    </form>
  );
}

/** Kanal satırı eylemleri: Dene, Aç/Kapat, Sil (satır içi onay). */
export function AlertChannelActions({ id, name, enabled }: { id: string; name: string; enabled: boolean }) {
  const { pending, res, run } = useOps();
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
        <Button variant="outline" size="xs" type="button" disabled={pending || !enabled} onClick={() => run(() => testAlertChannel(id), "Deneme iletildi.")}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Dene
        </Button>
        <Button variant="outline" size="xs" type="button" disabled={pending} onClick={() => run(() => setAlertChannelEnabled(id, !enabled), enabled ? "Kapatıldı." : "Açıldı.")}>
          {enabled ? "Kapat" : "Aç"}
        </Button>
        {confirmDelete ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800">
            “{name}” silinsin mi?
            <Button variant="navy" size="xs" type="button" onClick={() => { setConfirmDelete(false); run(() => deleteAlertChannel(id), "Silindi."); }}>
              Evet
            </Button>
            <Button variant="outline" size="xs" type="button" onClick={() => setConfirmDelete(false)}>
              Vazgeç
            </Button>
          </span>
        ) : (
          <Button variant="outline" size="xs" type="button" disabled={pending} onClick={() => setConfirmDelete(true)} aria-label={`${name} kanalını sil`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </span>
      <Msg res={res} />
    </span>
  );
}

/** Kural satırı: açık/kapalı, eşik, tekrar aralığı + sessize alma. */
export function AlertRuleEditor({
  ruleKey,
  enabled,
  threshold,
  thresholdMeta,
  repeatMinutes,
  muted,
}: {
  ruleKey: string;
  enabled: boolean;
  threshold: number | null;
  thresholdMeta: { label: string; unit: string; min: number; max: number } | null;
  repeatMinutes: number;
  muted: boolean;
}) {
  const { pending, res, run } = useOps();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("key", ruleKey);
    run(() => updateAlertRule(fd), "Kaydedildi.");
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <label className="inline-flex h-10 items-center gap-2 text-sm font-semibold text-ink-950">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="h-4 w-4 accent-[var(--color-brand-600)]" />
        Açık
      </label>
      {thresholdMeta ? (
        <label className="grid gap-1 text-xs font-semibold text-text-muted">
          {thresholdMeta.label} ({thresholdMeta.unit})
          <input
            name="threshold"
            type="number"
            inputMode="decimal"
            min={thresholdMeta.min}
            max={thresholdMeta.max}
            step="any"
            defaultValue={threshold ?? ""}
            className={`${field} w-28 tabular-nums`}
          />
        </label>
      ) : null}
      <label className="grid gap-1 text-xs font-semibold text-text-muted">
        Tekrar (dk)
        <input name="repeat" type="number" inputMode="numeric" min={5} max={10080} defaultValue={repeatMinutes} className={`${field} w-24 tabular-nums`} />
      </label>
      <Button variant="outline" size="sm" type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Kaydet
      </Button>
      {muted ? (
        <Button variant="outline" size="sm" type="button" disabled={pending} onClick={() => run(() => muteAlertRule(ruleKey, 0), "Sessizlik kaldırıldı.")}>
          <Bell className="h-3.5 w-3.5" /> Sessizliği kaldır
        </Button>
      ) : (
        <span className="inline-flex gap-1.5">
          <Button variant="outline" size="sm" type="button" disabled={pending} onClick={() => run(() => muteAlertRule(ruleKey, 60), "1 saat sessiz.")}>
            <BellOff className="h-3.5 w-3.5" /> 1 sa
          </Button>
          <Button variant="outline" size="sm" type="button" disabled={pending} onClick={() => run(() => muteAlertRule(ruleKey, 1440), "24 saat sessiz.")}>
            24 sa
          </Button>
        </span>
      )}
      <Msg res={res} />
    </form>
  );
}
