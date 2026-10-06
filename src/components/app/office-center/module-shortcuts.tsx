"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Lock } from "lucide-react";
import { toggleModuleFromOfficeCenter } from "@/app/actions/office-center";
import { useToast } from "@/components/app/toast-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export type ModuleShortcut = { key: string; label: string; desc: string; enabled: boolean; locked: boolean; lockReason: string | null; href: string | null };

/**
 * Modül kısa yolu: tenant_modules aç/kapa (karar ve kurallar `setModuleEnabled` içinde). Bağımlı modül
 * kapanacaksa sunucu onay ister; burada onay satırı açılır ve `cascade` ile yeniden gönderilir.
 */
export function ModuleShortcuts({ modules, canEdit }: { modules: ModuleShortcut[]; canEdit: boolean }) {
  const [confirm, setConfirm] = useState<{ key: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { push } = useToast();

  function toggle(key: string, enabled: boolean, cascade = false) {
    setError(null);
    start(async () => {
      const res = await toggleModuleFromOfficeCenter({ moduleKey: key, enabled, cascade });
      if (res.error) {
        if (!cascade && !enabled && /Onaylayın/.test(res.error)) {
          setConfirm({ key, text: res.error });
          return;
        }
        setError(res.error);
        return;
      }
      push(res.message ?? "Kaydedildi.", "ok");
      setConfirm(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert tone="danger" title="Modül değiştirilemedi">
          {error}
        </Alert>
      ) : null}
      {confirm ? (
        <Alert
          tone="warning"
          title="Bağlı modüller de kapanacak"
          action={
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="danger" loading={pending} onClick={() => toggle(confirm.key, false, true)}>
                Onayla ve kapat
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                Vazgeç
              </Button>
            </div>
          }
        >
          {confirm.text}
        </Alert>
      ) : null}
      <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
        {modules.map((m) => (
          <li key={m.key} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
                {m.label}
                {m.locked ? <Lock className="h-3.5 w-3.5 text-text-faint" aria-hidden="true" /> : null}
              </p>
              <p className="truncate text-xs text-text-muted" title={m.desc}>
                {m.lockReason ?? m.desc}
              </p>
            </div>
            {m.href && m.enabled ? (
              <Link href={m.href} className="focus-ring hidden items-center gap-0.5 text-xs font-semibold text-brand-600 hover:underline sm:inline-flex">
                Aç <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            ) : null}
            <Switch aria-label={`${m.label} modülü`} checked={m.enabled} disabled={!canEdit || m.locked || pending} onCheckedChange={(next) => toggle(m.key, next)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
