"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Save } from "lucide-react";
import {
  saveAlertThresholds,
  saveAssignWeights,
  saveCommissionDefinition,
  saveNotificationChannels,
  saveSLADefinition,
} from "@/app/actions/office-center";
import { useToast } from "@/components/app/toast-provider";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { Switch } from "@/components/ui/switch";
import type { DefinitionsSnapshot } from "@/lib/office-center/definitions";
import { SLA_OPTIONS_MIN } from "@/lib/response-time/core";

/**
 * Tanımlamalar: SLA · komisyon · uyarı eşikleri · akıllı atama ağırlıkları · bildirim kanalları.
 * Her grup kendi kaydet düğmesiyle (zod sunucuda); hepsi Ayar Kayıt Defteri anahtarlarına yazılır
 * (geçmiş/geri alma Ayarlar sekmesinde). Düzenleme `settings:edit` ister (ayar modülü tek kapı).
 */
type Result = { ok?: boolean; error?: string; message?: string };

function Group({ title, description, usedIn, onSave, pending, children }: { title: string; description: string; usedIn: { label: string; href: string }[]; onSave: () => void; pending: boolean; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display font-bold text-ink-950">{title}</h3>
          <p className="text-xs text-text-muted">{description}</p>
        </div>
        <Button type="button" size="sm" icon={Save} loading={pending} onClick={onSave}>
          Kaydet
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      <p className="mt-3 text-xs text-text-faint">
        Etkilediği ekranlar:{" "}
        {usedIn.map((u, i) => (
          <span key={u.href}>
            {i > 0 ? " · " : ""}
            <Link href={u.href} className="inline-flex items-center gap-0.5 font-semibold text-brand-600 hover:underline">
              {u.label} <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </span>
        ))}
      </p>
    </section>
  );
}

function Num({ id, label, value, onChange, min, max, step = 1, unit }: { id: string; label: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number; unit: string }) {
  return (
    <FormField label={label} htmlFor={id} hint={`${min}–${max} ${unit}`}>
      <FormInput id={id} type="number" inputMode="decimal" min={min} max={max} step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value.replace(",", ".")))} />
    </FormField>
  );
}

export function DefinitionsForm({ initial, canEdit, notifyLabels }: { initial: DefinitionsSnapshot; canEdit: boolean; notifyLabels: { id: string; label: string; description: string }[] }) {
  const [sla, setSla] = useState(initial.sla);
  const [com, setCom] = useState(initial.commission);
  const [thr, setThr] = useState(initial.thresholds);
  const [w, setW] = useState(initial.weights);
  const [notify, setNotify] = useState(initial.notify);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { push } = useToast();

  function run(group: string, task: () => Promise<Result>) {
    setError(null);
    setBusy(group);
    start(async () => {
      const res = await task();
      setBusy(null);
      if (res.error) {
        setError(res.error);
        push(res.error, "err");
        return;
      }
      push(res.message ?? "Kaydedildi.", "ok");
      router.refresh();
    });
  }
  const weightSum = Object.values(w).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

  return (
    <fieldset disabled={!canEdit} className="space-y-4 disabled:opacity-80">
      {!canEdit ? (
        <Alert tone="info" title="Görüntüleme modu">
          Tanımları değiştirmek için ayar düzenleme yetkisi (ofis sahibi / genel müdür) gerekir.
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Kaydedilemedi">
          {error}
        </Alert>
      ) : null}

      <Group
        title="Yanıt süreleri"
        description="Müşteriye dönüş ve danışmansız ilan için süre sınırları."
        usedIn={[
          { label: "Yanıt hızı raporu", href: "/app/raporlar/lead-hizi" },
          { label: "İlan Havuzu > Gecikenler", href: "/app/ilan-havuzu?atama=gecikmis" },
        ]}
        pending={pending && busy === "sla"}
        onSave={() => run("sla", () => saveSLADefinition(sla))}
      >
        <FormField label="İlk yanıt süresi" htmlFor="oc-sla-lead" hint="Yeni talebe ilk dönüş için süre.">
          <FormSelect id="oc-sla-lead" value={String(sla.leadFirstResponseMin)} onChange={(e) => setSla({ ...sla, leadFirstResponseMin: Number(e.target.value) })}>
            {SLA_OPTIONS_MIN.map((m) => (
              <option key={m} value={m}>
                {m >= 60 ? `${m / 60} saat` : `${m} dakika`}
              </option>
            ))}
          </FormSelect>
        </FormField>
        <Num id="oc-sla-unassigned" label="Atanmamış ilan süre sınırı" value={sla.unassignedSlaHours} min={1} max={168} unit="saat" onChange={(n) => setSla({ ...sla, unassignedSlaHours: n })} />
      </Group>

      <Group
        title="Komisyon oranları"
        description="Yedek oran ve bölüşüm/simülatör başlangıç değerleri. Kayıtlı komisyonlar ve portföy oranları değişmez."
        usedIn={[
          { label: "Komisyon hesaplayıcı", href: "/app/komisyon" },
          { label: "Anlaşmalar (kapanış bölüşümü)", href: "/app/anlasmalar?gorunum=liste&asama=won" },
        ]}
        pending={pending && busy === "com"}
        onSave={() => run("com", () => saveCommissionDefinition(com))}
      >
        <Num id="oc-com-default" label="Portföyde oran yoksa varsayılan komisyon" value={com.defaultRate} min={0.1} max={20} step={0.1} unit="%" onChange={(n) => setCom({ ...com, defaultRate: n })} />
        <Num id="oc-com-split" label="Kapanış bölüşümünde danışman payı" value={com.splitAdvisorShare} min={0} max={100} unit="%" onChange={(n) => setCom({ ...com, splitAdvisorShare: n })} />
        <Num id="oc-com-sim-rate" label="Hesaplayıcı başlangıç oranı" value={com.simulatorRate} min={0.1} max={20} step={0.1} unit="%" onChange={(n) => setCom({ ...com, simulatorRate: n })} />
        <Num id="oc-com-sim-share" label="Hesaplayıcı danışman payı" value={com.simulatorAdvisorShare} min={0} max={100} unit="%" onChange={(n) => setCom({ ...com, simulatorAdvisorShare: n })} />
      </Group>

      <Group
        title="Uyarı eşikleri"
        description="Hareketsiz anlaşma, bekleyen talep, danışmansız ilan ve müşteri sessizliği eşikleri."
        usedIn={[
          { label: "Hareketsiz anlaşmalar", href: "/app/anlasmalar?gorunum=liste&bayat=1" },
          { label: "Bekleyen talepler", href: "/app/talepler" },
          { label: "Uykuda müşteriler", href: "/app/musteriler?segment=uykuda" },
          { label: "Ofis Merkezi > İstatistikler", href: "/app/ekip?sekme=istatistikler" },
        ]}
        pending={pending && busy === "thr"}
        onSave={() => run("thr", () => saveAlertThresholds(thr))}
      >
        <Num id="oc-thr-deal" label="Hareketsiz anlaşma eşiği" value={thr.dealStaleDays} min={3} max={180} unit="gün" onChange={(n) => setThr({ ...thr, dealStaleDays: n })} />
        <Num id="oc-thr-demand" label="Bekleyen talep eşiği" value={thr.demandAgingDays} min={7} max={365} unit="gün" onChange={(n) => setThr({ ...thr, demandAgingDays: n })} />
        <Num id="oc-thr-unassigned" label="Atanmamış ilan uyarı eşiği" value={thr.unassignedPoolCount} min={1} max={500} unit="ilan" onChange={(n) => setThr({ ...thr, unassignedPoolCount: n })} />
        <Num id="oc-thr-quiet" label="Sessiz değerli müşteri eşiği" value={thr.customerQuietDays} min={7} max={90} unit="gün" onChange={(n) => setThr({ ...thr, customerQuietDays: n })} />
        <Num id="oc-thr-listing" label="Eskiyen ilan eşiği" value={thr.listingStaleDays} min={14} max={180} unit="gün" onChange={(n) => setThr({ ...thr, listingStaleDays: n })} />
        <Num id="oc-thr-dormant" label="Uykuda müşteri eşiği" value={thr.dormantDays} min={30} max={365} unit="gün" onChange={(n) => setThr({ ...thr, dormantDays: n })} />
      </Group>

      <Group
        title="Akıllı atama ağırlıkları"
        description={`"Akıllı öner" ölçütlerinin ağırlığı. Toplam ${weightSum} puan; motor oransal olarak 100'e çevirir, 0 = sayılmaz.`}
        usedIn={[{ label: "İlan Havuzu > Danışmansız ilanlar", href: "/app/ilan-havuzu?atama=bekleyen" }]}
        pending={pending && busy === "w"}
        onSave={() => run("w", () => saveAssignWeights(w))}
      >
        <Num id="oc-w-workload" label="İş yükü" value={w.workload} min={0} max={100} unit="puan" onChange={(n) => setW({ ...w, workload: n })} />
        <Num id="oc-w-specialty" label="Uzmanlık (tür + işlem)" value={w.specialty} min={0} max={100} unit="puan" onChange={(n) => setW({ ...w, specialty: n })} />
        <Num id="oc-w-region" label="Bölge (il/ilçe/mahalle)" value={w.region} min={0} max={100} unit="puan" onChange={(n) => setW({ ...w, region: n })} />
        <Num id="oc-w-performance" label="Son 90 gün performansı" value={w.performance} min={0} max={100} unit="puan" onChange={(n) => setW({ ...w, performance: n })} />
        <Num id="oc-w-availability" label="Müsaitlik" value={w.availability} min={0} max={100} unit="puan" onChange={(n) => setW({ ...w, availability: n })} />
      </Group>

      <Group
        title="Bildirim kanalları (ofis varsayılanı)"
        description="Kendi tercihini hiç kaydetmemiş kullanıcılar için bildirim türü açık mı başlasın. Kaydedilmiş kişisel tercihler korunur."
        usedIn={[{ label: "Bildirim tercihleri", href: "/app/ayarlar" }]}
        pending={pending && busy === "notify"}
        onSave={() => run("notify", () => saveNotificationChannels(notify))}
      >
        {notifyLabels.map((n) => (
          <div key={n.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-950">{n.label}</p>
              <p className="truncate text-xs text-text-muted" title={n.description}>
                {n.description}
              </p>
            </div>
            <Switch aria-label={n.label} checked={notify[n.id] ?? false} onCheckedChange={(v) => setNotify({ ...notify, [n.id]: v })} />
          </div>
        ))}
      </Group>
    </fieldset>
  );
}
