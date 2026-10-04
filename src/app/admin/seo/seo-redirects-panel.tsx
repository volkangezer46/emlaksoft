"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import {
  addSeoRedirect,
  deleteAllSeoRedirects,
  deleteSeoRedirect,
  toggleSeoRedirect,
  type SeoActionResult,
} from "@/app/actions/seo-admin";
import type { SeoRedirectRule } from "@/lib/seo/schema";
import { LockedNote, ResultNote, SeoForm, SubmitButton } from "./seo-ui";

export type RuleIssues = Record<string, string[]>;

function RuleRow({ rule, issues }: { rule: SeoRedirectRule; issues: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [res, setRes] = useState<SeoActionResult | null>(null);
  const run = (fn: (fd: FormData) => Promise<SeoActionResult>) =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", rule.id);
      const r = await fn(fd);
      setRes(r);
      setConfirming(false);
      if (r.ok) router.refresh();
    });
  return (
    <li className="space-y-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <code className="rounded bg-canvas px-1.5 py-0.5 text-xs text-ink-950">{rule.from}</code>
        <span aria-hidden className="text-text-faint">→</span>
        <code className="max-w-full break-all rounded bg-canvas px-1.5 py-0.5 text-xs text-ink-950">{rule.to}</code>
        <span className="text-xs font-semibold text-text-muted">{rule.status === 308 ? "Kalıcı (308)" : "Geçici (307)"}</span>
        {!rule.enabled ? <span className="rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-text-muted">Kapalı</span> : null}
        <span className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" loading={pending} onClick={() => run(toggleSeoRedirect)}>
            {rule.enabled ? "Kapat" : "Aç"}
          </Button>
          {confirming ? (
            <>
              <Button size="sm" variant="danger" loading={pending} onClick={() => run(deleteSeoRedirect)}>Evet, sil</Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>Vazgeç</Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>Sil</Button>
          )}
        </span>
      </div>
      {rule.note ? <p className="text-xs text-text-muted">{rule.note}</p> : null}
      {issues.map((m) => (
        <p key={m} className="flex items-start gap-1.5 text-xs font-medium text-warning-strong">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {m}
        </p>
      ))}
      <ResultNote res={res?.ok ? null : res} />
    </li>
  );
}

export function RedirectsPanel({
  rules,
  issues,
  canBulk,
  prefillFrom,
}: {
  rules: SeoRedirectRule[];
  issues: RuleIssues;
  canBulk: boolean;
  prefillFrom?: string;
}) {
  const router = useRouter();
  const [confirmAll, setConfirmAll] = useState(false);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<SeoActionResult | null>(null);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Yeni yönlendirme</CardTitle>
            <CardDescription>
              Eski yol bir sayfaya denk gelmiyorsa (404 olacaksa) çalışır; mevcut sayfaların hızı etkilenmez. Döngü, zincir ve yinelenen kaynak otomatik denetlenir.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <SeoForm action={addSeoRedirect}>
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_12rem]">
              <FormField label="Eski yol" htmlFor="rd-from" hint="Örn. /eski-sayfa">
                <FormInput id="rd-from" name="from" placeholder="/eski-sayfa" defaultValue={prefillFrom} required />
              </FormField>
              <FormField label="Yeni yol ya da adres" htmlFor="rd-to" hint="Örn. /fiyatlar">
                <FormInput id="rd-to" name="to" placeholder="/fiyatlar" required />
              </FormField>
              <FormField label="Tür" htmlFor="rd-status">
                <FormSelect id="rd-status" name="status" defaultValue="308">
                  <option value="308">Kalıcı (308)</option>
                  <option value="307">Geçici (307)</option>
                </FormSelect>
              </FormField>
            </div>
            <FormField label="Not (isteğe bağlı)" htmlFor="rd-note">
              <FormInput id="rd-note" name="note" maxLength={160} />
            </FormField>
            <SubmitButton>Yönlendirme ekle</SubmitButton>
          </SeoForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Kurallar ({rules.length})</CardTitle>
            <CardDescription>308 kalıcı, 307 geçici yönlendirmedir; Google 308’i 301 gibi işler.</CardDescription>
          </div>
        </CardHeader>
        {rules.length === 0 ? (
          <CardContent>
            <p className="text-sm text-text-muted">Henüz yönlendirme yok. 404 sekmesindeki en çok hata alan yollardan başlayabilirsiniz.</p>
          </CardContent>
        ) : (
          <ul className="divide-y divide-line">
            {rules.map((r) => (
              <RuleRow key={r.id} rule={r} issues={issues[r.id] ?? []} />
            ))}
          </ul>
        )}
        {rules.length > 0 ? (
          <CardContent className="border-t border-line">
            {!canBulk ? (
              <LockedNote>Tüm kuralları silmek yalnız süper admin içindir.</LockedNote>
            ) : confirmAll ? (
              <div role="alert" className="space-y-2 rounded-[var(--radius-control)] border border-danger-400 p-3">
                <p className="text-sm font-semibold text-danger-600">{rules.length} yönlendirmenin tamamı silinecek; eski bağlantılar 404 verir. Emin misiniz?</p>
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    loading={pending}
                    onClick={() =>
                      start(async () => {
                        const fd = new FormData();
                        fd.set("confirm", "evet");
                        const r = await deleteAllSeoRedirects(fd);
                        setRes(r);
                        setConfirmAll(false);
                        if (r.ok) router.refresh();
                      })
                    }
                  >
                    Evet, hepsini sil
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmAll(false)}>Vazgeç</Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmAll(true)}>Tüm yönlendirmeleri sil…</Button>
            )}
            <ResultNote res={res?.ok ? null : res} />
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
