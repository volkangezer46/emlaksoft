"use client";

import { formatTry } from "@/lib/format";
import { financePath } from "@/lib/finance/routes";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Celebrate } from "@/components/ui/celebrate";
import { FormInput } from "@/components/ui/form-controls";
import { updateCommissionSplits } from "@/app/actions/commissions";
import { createTask } from "@/app/actions/tasks";
import { CopySurveyLinkButton, CreateSurveyButton } from "../../anketler/survey-actions";
import type { PostCloseSummary } from "@/lib/post-close-model";
import { PostClosePanel } from "./post-close-panel";
import { COLLECTION_TASK_PREFIX, advisorShareOf, splitsError, splitsTotal, type SplitRow } from "./kapanis-model";
import type { KapanisProps } from "./kapanis-sihirbazi";

/**
 * Kapanış SONRASI (anlaşma kazanıldı / kaybedildi): kapanış sihirbazı tek onayla bitti; burada kalan işler bölüm
 * bölüm durur — paylar (WP2 onayı `updateCommissionSplits`), tahsilat vadesi görevi, evrak, memnuniyet anketi, özet.
 * Kayıpta: özet + geri kazanım takibi. Her işlem MEVCUT action'dır.
 */
const postCloseKey = (dealId: string) => `emlaksoft:kapanis-ozeti:${dealId}`;

/** Kazanma anındaki temizlik özetini sekme yenilenene kadar saklar (oturumluk; erişilemezse sessiz). */
export function rememberPostClose(dealId: string, summary: PostCloseSummary): void {
  try {
    window.sessionStorage.setItem(postCloseKey(dealId), JSON.stringify(summary));
  } catch {
    /* depolama kapalı — özet gösterilmez, işlem etkilenmez */
  }
}

function usePostClose(dealId: string): PostCloseSummary | null {
  const [summary, setSummary] = useState<PostCloseSummary | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const raw = window.sessionStorage.getItem(postCloseKey(dealId));
        if (!raw) return;
        window.sessionStorage.removeItem(postCloseKey(dealId));
        setSummary(JSON.parse(raw) as PostCloseSummary);
      } catch {
        /* sessiz */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [dealId]);
  return summary;
}

export function KapanisSonrasi(p: KapanisProps) {
  const postClose = usePostClose(p.dealId);
  if (p.stage === "lost") {
    return (
      <section className="surface-card space-y-5 rounded-[var(--radius-panel)] p-5">
        <LostFinish {...p} />
        <FollowUpStep {...p} />
      </section>
    );
  }
  return (
    <div className="space-y-4">
      {postClose ? <PostClosePanel summary={postClose} /> : null}
      <section className="surface-card rounded-[var(--radius-panel)] p-5">
        <WonFinish {...p} />
      </section>
      <Section title="Komisyon payları">
        <SplitsStep {...p} />
      </Section>
      <Section title="Tahsilat vadesi">
        <DueStep {...p} />
      </Section>
      <Section title="Evrak ve sözleşme">
        <DocsStep {...p} />
      </Section>
      <Section title="Memnuniyet anketi">
        <SurveyStep {...p} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5">
      <h3 className="mb-3 font-display text-sm font-bold text-ink-950">{title}</h3>
      {children}
    </section>
  );
}

type BodyProps = KapanisProps;

const COMMISSION_STATUS_LABELS: Record<string, string> = {
  pending: "Bekliyor",
  calculated: "Hesaplandı",
  approved: "Onaylandı",
  paid: "Ödendi",
  collected: "Tahsil edildi",
  cancelled: "İptal edildi",
  canceled: "İptal edildi",
};

function commissionStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return COMMISSION_STATUS_LABELS[status.toLowerCase()] ?? status;
}

const money = (n: number) => formatTry(n);

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  return { router, pending, startTransition, error, setError, info, setInfo };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-2.5">
      <dt className="text-xs text-text-faint">{label}</dt>
      <dd className="numeric text-sm font-bold text-ink-950">{value}</dd>
    </div>
  );
}

function SplitsStep(p: BodyProps) {
  const r = useRun();
  const initial: SplitRow[] =
    p.commission && p.commission.splits.length > 0
      ? p.commission.splits.map((s) => ({ label: s.label, rate: String(s.rate) }))
      : [
          { label: "Danışman", rate: String(p.defaultAdvisorShare ?? 50) },
          { label: "Ofis", rate: String(Math.round((100 - (p.defaultAdvisorShare ?? 50)) * 100) / 100) },
        ];
  const [rows, setRows] = useState<SplitRow[]>(initial);

  if (!p.showMoney) {
    return <Alert tone="info">Komisyon payları yalnız ilgili danışman ve kazanç görme yetkisi olanlara görünür.</Alert>;
  }
  if (!p.commission) {
    return <Alert tone="warning">Komisyon kaydı bulunamadı. Önce anlaşmayı kazanıldı olarak kapatın.</Alert>;
  }
  const commission = p.commission;
  const total = splitsTotal(rows);
  const err = splitsError(rows);
  const set = (i: number, patch: Partial<SplitRow>) => setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  function save() {
    r.setError(null);
    r.setInfo(null);
    r.startTransition(async () => {
      const res = await updateCommissionSplits(
        commission.id,
        rows.map((x) => ({ label: x.label, rate: Number(x.rate) || 0 })),
      );
      if (res.error) return r.setError(res.error);
      r.setInfo("Paylar kaydedildi.");
      r.router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <dl className="grid gap-2 sm:grid-cols-3">
        <Stat label="Komisyon (KDV hariç)" value={money(commission.gross)} />
        <Stat label="KDV" value={money(commission.vat)} />
        <Stat label="Durum" value={commissionStatusLabel(commission.status)} />
      </dl>
      <p className="text-sm text-text-muted">Komisyonu taraflar arasında oranla bölüştürün (danışman payı dahil).</p>
      <div className="space-y-2">
        {rows.map((x, i) => (
          <div key={i} className="flex items-center gap-2">
            <FormInput
              aria-label={`Pay ${i + 1} taraf`}
              value={x.label}
              onChange={(e) => set(i, { label: e.target.value })}
              placeholder="Taraf (Danışman, Ofis, Referans)"
              className="min-w-0 flex-1"
            />
            <div className="relative w-24 shrink-0">
              <FormInput
                aria-label={`Pay ${i + 1} oran`}
                type="number"
                min="0"
                max="100"
                step="1"
                value={x.rate}
                onChange={(e) => set(i, { rate: e.target.value })}
                className="pr-6"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-faint">%</span>
            </div>
            <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-ink-950">
              {money(Math.round(commission.gross * ((Number(x.rate) || 0) / 100)))}
            </span>
            <Button
              variant="ghost"
              size="icon"
              icon={Trash2}
              aria-label="Satırı sil"
              onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
              disabled={rows.length <= 1}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" icon={Plus} onClick={() => setRows((rs) => [...rs, { label: "", rate: "" }])}>
          Pay ekle
        </Button>
        <p className={"text-xs font-semibold " + (total > 100.01 ? "text-danger-500" : total === 100 ? "text-mint-600" : "text-text-muted")}>
          Toplam %{total} {total < 100 ? `(kalan %${Math.round((100 - total) * 100) / 100})` : ""}
        </p>
      </div>
      {r.error ? <Alert tone="danger">{r.error}</Alert> : null}
      {r.info ? <Alert tone="success">{r.info}</Alert> : null}
      <Button type="button" loading={r.pending} disabled={Boolean(err) || !p.canEdit} onClick={save}>
        Payları kaydet
      </Button>
      {err && rows.some((x) => x.label || x.rate) ? <p className="text-xs text-danger-500">{err}</p> : null}
    </div>
  );
}

function DueStep(p: BodyProps) {
  const r = useRun();
  const [due, setDue] = useState(p.defaultDue ?? "");
  const [created, setCreated] = useState(Boolean(p.hasCollectionTask));
  const name = p.customerName ?? "müşteri";

  function create() {
    r.setError(null);
    const fd = new FormData();
    fd.set("title", `${COLLECTION_TASK_PREFIX}: ${p.propertyTitle ?? "anlaşma"} (${name})`);
    fd.set("kind", "followup");
    fd.set("priority", "high");
    fd.set("due_at", due);
    fd.set("deal_id", p.dealId);
    if (p.customerId) fd.set("customer_id", p.customerId);
    if (p.propertyId) fd.set("property_id", p.propertyId);
    r.startTransition(async () => {
      const res = await createTask({}, fd);
      if (res.error) return r.setError(res.error);
      setCreated(true);
      r.router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Komisyonun tahsil edileceği <strong className="text-text">vadeyi</strong> belirleyin; bu tarihte sizi hatırlatacak bir görev açılır.
        Tahsilatı işaretlemek için Komisyon merkezini kullanın.
      </p>
      {created ? (
        <Alert tone="success">Tahsilat görevi açık. Görevler sekmesinden izleyebilirsiniz.</Alert>
      ) : p.canCreateTask ? (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="kap-vade" className="mb-1 block text-xs font-semibold text-text-muted">
              Vade
            </label>
            <FormInput id="kap-vade" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Button type="button" loading={r.pending} disabled={!due} onClick={create}>
            Tahsilat görevi oluştur
          </Button>
        </div>
      ) : (
        <p className="text-xs text-text-muted">Görev oluşturma yetkiniz yok; bu adımı atlayabilirsiniz.</p>
      )}
      {r.error ? <Alert tone="danger">{r.error}</Alert> : null}
    </div>
  );
}

function DocsStep(p: BodyProps) {
  const c = p.checklist ?? { done: 0, total: 0 };
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Tapu, vekaletname, kimlik ve sözleşme gibi kapanış evrakları anlaşmanın evrak dosyasında takip edilir.
      </p>
      <p className="text-sm text-text">
        {c.total > 0 ? (
          <>
            Evrak dosyası: <strong>{c.done}</strong> / {c.total} tamam
          </>
        ) : (
          "Evrak listesi henüz oluşturulmadı."
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/app/anlasmalar/${p.dealId}?sekme=belgeler`} variant="secondary" iconRight={ArrowRight}>
          Evrak dosyasını aç
        </ButtonLink>
        <ButtonLink href="/app/sozlesmeler" variant="ghost">
          Sözleşmeler
        </ButtonLink>
      </div>
    </div>
  );
}

function SurveyStep(p: BodyProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        Müşteriye tek soruluk memnuniyet anketi gönderin. SMS gönderilmez; linki siz iletirsiniz.
      </p>
      {p.survey ? (
        p.survey.answered ? (
          <p className="text-sm text-text">
            Müşteri yanıtladı: <strong className="numeric">{p.survey.score}</strong> / 10
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-brand-600/10 px-2.5 py-0.5 text-xs font-bold text-brand-600">Yanıt bekliyor</span>
            <CopySurveyLinkButton url={p.survey.url} />
          </div>
        )
      ) : !p.customerId ? (
        <Alert tone="warning">Anlaşmaya müşteri bağlı değil; anket gönderilecek kişi belirsiz.</Alert>
      ) : p.canSurvey ? (
        <CreateSurveyButton dealId={p.dealId} />
      ) : (
        <p className="text-xs text-text-muted">Anket üretmek için rapor yetkisi gerekiyor.</p>
      )}
    </div>
  );
}

function WonFinish(p: BodyProps) {
  const c = p.commission;
  const share = advisorShareOf(c?.splits);
  const c2 = p.checklist ?? { done: 0, total: 0 };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {p.stage === "won" ? <Celebrate label="Anlaşma kazanıldı" /> : null}
        <div>
          <h3 className="font-display text-lg font-bold text-text">
            {p.stage === "won" ? "Tebrikler, anlaşma kapandı" : "Anlaşma henüz kapanmadı"}
          </h3>
          <p className="text-sm text-text-muted">
            {p.stage === "won"
              ? `${p.propertyTitle ?? "Portföy"} · ${p.customerName ?? "Müşteri"}`
              : "Kazanıldı adımını tamamlayınca özet burada görünür."}
          </p>
        </div>
      </div>
      {p.stage === "won" ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          <Stat label="Nihai tutar" value={p.dealValue != null ? money(p.dealValue) : "—"} />
          {p.showMoney && c ? <Stat label="Komisyon (KDV hariç)" value={money(c.gross)} /> : null}
          {p.showMoney && c && share != null ? <Stat label={`Danışman payı (%${share})`} value={money((c.gross * share) / 100)} /> : null}
          <Stat label="Evrak dosyası" value={c2.total ? `${c2.done} / ${c2.total}` : "—"} />
          <Stat label="Memnuniyet anketi" value={p.survey ? (p.survey.answered ? `${p.survey.score} / 10` : "Yanıt bekliyor") : "Gönderilmedi"} />
        </dl>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {p.showMoney ? (
          <ButtonLink href={financePath("komisyon")} variant="secondary">
            Komisyon merkezi
          </ButtonLink>
        ) : null}
        <ButtonLink href="/app/anlasmalar">Anlaşmalara dön</ButtonLink>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Kaybedildi

function FollowUpStep(p: BodyProps) {
  const [taskCreated, setTaskCreated] = useState(false);
  const r = useRun();
  const [title, setTitle] = useState(`Geri kazanım: ${p.customerName ?? "müşteri"} ile yeniden görüş`);
  const [due, setDue] = useState(p.defaultDue ?? "");

  function create() {
    r.setError(null);
    const fd = new FormData();
    fd.set("title", title);
    fd.set("kind", "followup");
    fd.set("due_at", due);
    fd.set("deal_id", p.dealId);
    if (p.customerId) fd.set("customer_id", p.customerId);
    if (p.propertyId) fd.set("property_id", p.propertyId);
    r.startTransition(async () => {
      const res = await createTask({}, fd);
      if (res.error) return r.setError(res.error);
      setTaskCreated(true);
      r.router.refresh();
    });
  }

  if (taskCreated) return <Alert tone="success">Takip görevi oluşturuldu.</Alert>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">Kayıp müşteriyi unutmayın: ileri bir tarihe geri kazanım görevi ekleyin.</p>
      {p.canCreateTask ? (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label htmlFor="kap-gorev" className="mb-1 block text-xs font-semibold text-text-muted">
                Görev
              </label>
              <FormInput id="kap-gorev" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label htmlFor="kap-gorev-tarih" className="mb-1 block text-xs font-semibold text-text-muted">
                Tarih
              </label>
              <FormInput id="kap-gorev-tarih" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
          {r.error ? <Alert tone="danger">{r.error}</Alert> : null}
          <Button type="button" loading={r.pending} disabled={!title.trim()} onClick={create}>
            Takip görevi oluştur
          </Button>
        </>
      ) : (
        <p className="text-xs text-text-muted">Görev oluşturma yetkiniz yok; bu adımı atlayabilirsiniz.</p>
      )}
    </div>
  );
}

function LostFinish(p: BodyProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {p.stage === "lost" ? <Celebrate tone="neutral" label="Kayıt tamamlandı" /> : null}
        <div>
          <h3 className="font-display text-lg font-bold text-text">
            {p.stage === "lost" ? "Kayıp kaydedildi" : "Anlaşma henüz kapanmadı"}
          </h3>
          <p className="text-sm text-text-muted">
            {p.stage === "lost"
              ? `${p.lossReasonText ?? "Kayıp nedeni kayıtlı değil"}`
              : "Kayıp nedenini kaydedince özet burada görünür."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/app/musteriler?segment=risk" variant="secondary">
          Riskli müşteriler
        </ButtonLink>
        <ButtonLink href="/app/anlasmalar">Anlaşmalara dön</ButtonLink>
      </div>
    </div>
  );
}
