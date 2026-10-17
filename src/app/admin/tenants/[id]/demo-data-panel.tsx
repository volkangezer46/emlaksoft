"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { Database, Lock, RefreshCw, Trash2, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { StepUpCodeField } from "@/components/admin/step-up";
import { adminForcePurgeSampleData, adminReseedSampleData, type AdminDemoResult } from "@/app/actions/admin-demo-data";

export type DemoPanelView = {
  mode: "demo" | "real" | "public" | "empty";
  seededLabel: string | null;
  clearedLabel: string | null;
  pack: string | null;
  locked: boolean;
  canReseed: boolean;
  realRecords: number;
  total: number;
  rows: { label: string; count: number | null }[];
};

const MODE: Record<DemoPanelView["mode"], { label: string; cls: string }> = {
  demo: { label: "Demo modunda", cls: "bg-brand-600/10 text-brand-700" },
  real: { label: "Gerçek kullanımda", cls: "bg-mint-500/12 text-mint-700" },
  public: { label: "Genel demo ofisi", cls: "bg-amber-400/15 text-amber-700" },
  empty: { label: "Örnek veri yok", cls: "bg-ink-950/5 text-text-muted" },
};

/**
 * Ofis 360 > Yönetim: "Demo verisi" paneli. Mod, varlık başına örnek sayıları, son yükleme ve kilit durumu; süper admin
 * için iki işlem (yeniden yükle / zorla temizle), her biri gerekçe + doğrulayıcı kodu ister (sunucu ayrıca doğrular).
 */
export function DemoDataPanel({ tenantId, view, canAct }: { tenantId: string; view: DemoPanelView; canAct: boolean }) {
  const m = MODE[view.mode];
  const visible = view.rows.filter((r) => (r.count ?? 0) > 0);
  return (
    <section className="dashboard-panel space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5" aria-label="Demo verisi">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Database className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
          <div>
            <h2 className="font-display font-bold text-ink-950">Demo verisi</h2>
            <p className="text-xs text-text-muted">Örnek kayıtlar is_sample işaretlidir; ofis gerçek kullanıma geçince tek seferde silinir ve ofis kilitlenir.</p>
          </div>
        </div>
        <span className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${m.cls}`}>{m.label}</span>
          <Link href="/admin/tenants/demo" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
            Demo verisi merkezi
          </Link>
        </span>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Örnek kayıt" value={view.total.toLocaleString("tr-TR")} />
        <Fact label="Gerçek kayıt (müşteri + portföy)" value={view.realRecords >= 1000 ? "1.000+" : view.realRecords.toLocaleString("tr-TR")} />
        <Fact label="Son yükleme" value={view.seededLabel ? `${view.seededLabel}${view.pack ? ` · ${view.pack}` : ""}` : "—"} />
        <Fact
          label="Kilit"
          value={
            <span className="inline-flex items-center gap-1">
              {view.locked ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <Unlock className="h-3.5 w-3.5" aria-hidden />}
              {view.locked ? (view.realRecords > 0 ? "Kilitli (gerçek kayıt var)" : `Kilitli (geçiş: ${view.clearedLabel ?? "—"})`) : "Açık"}
            </span>
          }
        />
      </dl>
      {visible.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Örnek kayıt sayıları">
          {visible.map((r) => (
            <li key={r.label} className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-text shadow-[inset_0_0_0_1px_var(--line)]">
              {r.count} {r.label.toLocaleLowerCase("tr-TR")}
            </li>
          ))}
        </ul>
      ) : null}
      {canAct && view.mode !== "public" ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {view.canReseed ? (
            <ActionForm
              tenantId={tenantId}
              title="Örnek veriyi yeniden yükle"
              hint="Yalnız gerçek kaydı olmayan ofiste. Varsa eski örnekler silinir, güncel zengin set yüklenir ve kilit kaldırılır."
              button="Yeniden yükle"
              icon={RefreshCw}
              variant="secondary"
              withPack
              run={adminReseedSampleData}
            />
          ) : (
            <p className="rounded-[var(--radius-card)] border border-line px-4 py-3 text-xs text-text-muted">
              Yeniden yükleme kapalı: ofiste gerçek kayıt var (kilit istisnasız).
            </p>
          )}
          {view.total > 0 ? (
            <ActionForm
              tenantId={tenantId}
              title="Zorla temizle"
              hint="Tüm örnek kayıtlar ve demo ekip silinir, ofis gerçek kullanıma kilitlenir. Geri alınamaz."
              button="Örnekleri sil"
              icon={Trash2}
              variant="danger"
              run={adminForcePurgeSampleData}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line px-3 py-2">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="font-semibold text-ink-950">{value}</dd>
    </div>
  );
}

function ActionForm(props: {
  tenantId: string;
  title: string;
  hint: string;
  button: string;
  icon: typeof Trash2;
  variant: "danger" | "secondary";
  withPack?: boolean;
  run: (fd: FormData) => Promise<AdminDemoResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<AdminDemoResult | null>(null);
  const id = `${props.button.replace(/\W+/g, "-")}-${props.tenantId.slice(0, 6)}`;
  return (
    <details className="rounded-[var(--radius-card)] border border-line px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink-900">{props.title}</summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("id", props.tenantId);
          start(async () => {
            const r = await props.run(fd);
            setRes(r);
            if (r.ok) router.refresh();
          });
        }}
      >
        <p className="text-xs text-text-muted">{props.hint}</p>
        {props.withPack ? (
          <FormField label="Paket" htmlFor={`${id}-pack`}>
            <FormSelect id={`${id}-pack`} name="pack" defaultValue="konut">
              <option value="konut">Konut ağırlıklı</option>
              <option value="ticari">Ticari ağırlıklı</option>
              <option value="arsa">Arsa ağırlıklı</option>
            </FormSelect>
          </FormField>
        ) : null}
        <FormField label="Gerekçe" htmlFor={`${id}-reason`} hint="En az 10 karakter; denetim izine yazılır.">
          <FormTextarea id={`${id}-reason`} name="reason" rows={2} required minLength={10} />
        </FormField>
        <StepUpCodeField id={`${id}-step-up`} />
        {res?.error ? (
          <p role="alert" className="text-xs font-semibold text-danger-600">
            {res.error}
          </p>
        ) : null}
        {res?.ok ? <p className="text-xs font-semibold text-mint-600">{res.message}</p> : null}
        <Button type="submit" variant={props.variant} icon={props.icon} loading={pending}>
          {props.button}
        </Button>
      </form>
    </details>
  );
}
