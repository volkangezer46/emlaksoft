"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { relativeTimeTR } from "@/lib/admin-format";
import { publishSeed, rollbackTo } from "@/app/actions/admin-portal-rules";
import type { TransferPortal } from "@/lib/portal-transfer/rules";
import { PORTAL_LABELS, RULE_SET_KIND_LABELS, RULE_SET_STATUS_LABELS, changeSummaryLines } from "@/lib/portal-rules/admin-model";

export type VersionRow = {
  id: string;
  version: number;
  status: string;
  kind: string;
  changeSummary: unknown;
  /** "Siz" | "Personel" | "Sistem" (personel adı listelenmez; platform_staff yalnız kendi satırını okur). */
  by: string;
  at: string | null;
  rollsBackTo: number | null;
};

/**
 * Sürüm geçmişi: tür, tarih, kim/sistem, change_summary farkı ve "Bu sürüme geri dön" (onay diyaloğu; eski içerikle
 * YENİ ve daha büyük sürüm). Hiç set yoksa "Tohumu yayınla (sürüm 1)". Yayın düğmeleri yalnız süper admin'de etkin.
 */
export function VersionsPanel({ portal, versions, canPublish }: { portal: TransferPortal; versions: VersionRow[]; canPublish: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; notice?: string }>) =>
    new Promise<void>((resolve) => {
      setMsg(null);
      start(async () => {
        const r = await fn();
        setMsg({ ok: !!r.ok, text: r.ok ? (r.notice ?? "Yayınlandı.") : (r.error ?? "İşlem yapılamadı.") });
        if (r.ok) router.refresh();
        resolve();
      });
    });

  return (
    <section id="surumler" aria-label="Sürüm geçmişi" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <p className="flex items-center gap-2 text-xs font-semibold text-text-muted">
        <History className="h-4 w-4" /> Sürüm geçmişi
      </p>
      <h2 className="mt-1 font-display font-bold text-ink-950">{PORTAL_LABELS[portal]} kural sürümleri</h2>
      {versions.length === 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-text-muted">
            Bu portalda henüz yayınlanmış kural seti yok. Tohum, eklenti paketindeki varsayılan kuralların aynısıdır; yayınlanınca
            sürüm 1 olur ve öğrenilen değişiklikler bunun üstüne eklenir.
          </p>
          {canPublish ? (
            <ConfirmDialog
              tone="default"
              trigger={
                <Button size="sm" icon={Rocket} loading={pending}>
                  Tohumu yayınla (sürüm 1)
                </Button>
              }
              title="Tohum sürüm 1 olarak yayınlansın mı?"
              description="Paket içindeki varsayılan kurallar imzalanıp eklentilere dağıtılacak. Davranış bugünkü eklentiyle aynıdır."
              confirmLabel="Yayınla"
              onConfirm={() => run(() => publishSeed(portal))}
            />
          ) : (
            <p className="text-xs text-text-faint">Tohum yayını yalnız süper admin tarafından yapılabilir.</p>
          )}
        </div>
      ) : (
        <ol className="mt-3 divide-y divide-line">
          {versions.map((v) => {
            const lines = changeSummaryLines(v.changeSummary, { rollsBackTo: v.rollsBackTo, kind: v.kind });
            const current = v.status === "published";
            return (
              <li key={v.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-950">
                    Sürüm <span className="tabular-nums">{v.version}</span>
                    <Badge variant={current ? "success" : "outline"} size="sm">{RULE_SET_STATUS_LABELS[v.status] ?? v.status}</Badge>
                    <span className="font-normal text-text-muted">
                      {RULE_SET_KIND_LABELS[v.kind] ?? v.kind} · {v.by}
                      {v.at ? ` · ${relativeTimeTR(v.at)}` : ""}
                    </span>
                  </p>
                  {lines.length ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-text-muted">
                      {lines.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-text-faint">Değişiklik özeti yok.</p>
                  )}
                </div>
                {!current && canPublish && v.status !== "rejected" ? (
                  <ConfirmDialog
                    trigger={
                      <Button size="xs" variant="outline" disabled={pending}>
                        Bu sürüme geri dön
                      </Button>
                    }
                    title={`Sürüm ${v.version} içeriğine geri dönülsün mü?`}
                    description="Eski içerik doğrulanıp YENİ bir sürüm numarasıyla yayınlanır; geçmiş silinmez. Eklentiler bir sonraki tazelemede bu sürüme geçer."
                    confirmLabel="Geri dön"
                    onConfirm={() => run(() => rollbackTo(portal, v.version))}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
