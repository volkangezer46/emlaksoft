"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { setFeatureFlagFromAdmin, setMaintenanceScope } from "@/app/actions/platform-security";
import { ReasonDialog } from "@/app/admin/personel/guvenlik/reason-dialog";
import {
  MAINTENANCE_SCOPE_LABELS,
  MAINTENANCE_SCOPES,
  maintenanceImpactPreview,
  type MaintenanceScope,
} from "@/lib/platform-security/maintenance-scope";

/** Satır içi bayrak anahtarı: onay penceresi + gerekçe; yazım mevcut ayar yolundan (settings_history + denetim). */
export function FlagSwitch({ flagKey, label, on }: { flagKey: string; label: string; on: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const next = !on;
  return (
    <>
      <Switch checked={on} onCheckedChange={() => setOpen(true)} aria-label={`${label}: ${on ? "kapat" : "aç"}`} />
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        tone={next ? "default" : "danger"}
        title={`${label} ${next ? "açılsın" : "kapatılsın"} mı?`}
        description="Değişiklik hemen geçerli olur, ayar geçmişine ve denetim izine gerekçesiyle yazılır."
        confirmLabel={next ? "Aç" : "Kapat"}
        onConfirm={async (reason) => {
          const res = await setFeatureFlagFromAdmin({ flagKey, on: next, reason });
          if (res.error) return { error: res.error };
          router.refresh();
        }}
      />
    </>
  );
}

/** Bakım modu kapsamı: nereyi, ne zaman ve hangi mesajla. Aç/kapa ayrı satırdaki "Bakım modu" anahtarıdır. */
export function MaintenanceCard({
  maintenanceOn,
  scope: initialScope,
  startsAt: initialStart,
  endsAt: initialEnd,
  message: initialMessage,
  canEdit,
}: {
  maintenanceOn: boolean;
  scope: MaintenanceScope;
  startsAt: string;
  endsAt: string;
  message: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<MaintenanceScope>(initialScope);
  const [startsAt, setStartsAt] = useState(initialStart);
  const [endsAt, setEndsAt] = useState(initialEnd);
  const [message, setMessage] = useState(initialMessage);
  const preview = maintenanceImpactPreview(scope);

  return (
    <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-bold text-ink-950">Bakım modu</h2>
          <p className="text-xs text-text-muted">
            Şu an <strong className="text-ink-950">{maintenanceOn ? "açık" : "kapalı"}</strong>. Açıp kapatmak için aşağıdaki
            &quot;Bakım modu&quot; satırındaki anahtarı kullanın; burada kapsamı, zaman penceresini ve mesajı belirlersiniz.
          </p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-semibold text-ink-900">Kapsam</span>
          <select
            value={scope}
            disabled={!canEdit}
            onChange={(e) => setScope(e.target.value as MaintenanceScope)}
            className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-2 text-sm"
          >
            {MAINTENANCE_SCOPES.map((s) => (
              <option key={s} value={s}>
                {MAINTENANCE_SCOPE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-ink-900">Başlangıç (isteğe bağlı)</span>
            <Input type="datetime-local" value={startsAt} disabled={!canEdit} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-ink-900">Bitiş (isteğe bağlı)</span>
            <Input type="datetime-local" value={endsAt} disabled={!canEdit} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
        </div>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-semibold text-ink-900">Bakım sayfası mesajı (düz metin, en çok 280 karakter)</span>
        <Textarea value={message} disabled={!canEdit} maxLength={280} rows={2} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-3">
        <p className="text-xs font-semibold text-ink-950">Bugünkü etkisi (bakım açıldığında)</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-text-muted">
          {preview.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {endsAt ? <p className="mt-1 text-xs text-text-muted">Bitişte bakım kendiliğinden kalkar; tarayıcılara bitişe kalan süre bildirilir.</p> : null}
      </div>
      {canEdit ? (
        <ReasonDialog
          tone={scope === "site" ? "danger" : "default"}
          title="Bakım kapsamı kaydedilsin mi?"
          description={scope === "site" ? "Tüm site kapsamında ana sayfa da bakım sayfasını gösterir." : "Ana sayfa açık kalır."}
          confirmLabel="Kaydet"
          trigger={<Button size="sm">Kapsamı kaydet</Button>}
          onConfirm={async (reason) => {
            const res = await setMaintenanceScope({ scope, startsAt, endsAt, message, reason });
            if (res.error) return { error: res.error };
            router.refresh();
          }}
        />
      ) : (
        <p className="text-xs text-text-muted">Değiştirmek için süper admin yetkisi gerekir.</p>
      )}
    </section>
  );
}
