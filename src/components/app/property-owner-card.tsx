import Link from "next/link";
import { AlertTriangle, CheckCircle2, ShieldCheck, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { loadOwnerInfo } from "@/lib/property-owner/server";
import {
  AUTHORIZATION_TYPES,
  COMMISSION_KINDS,
  DEED_STATUSES,
  OWNER_RELATIONS,
} from "@/lib/property-owner/info";
import { formatPhoneDisplay } from "@/lib/phone";
import { formatTry } from "@/lib/utils";
import { PropertyOwnerEditor } from "@/components/app/property-owner-editor";

const label = (list: readonly { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? "—";

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">{k}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-sm font-semibold text-ink-950">{v && v.trim() ? v : "—"}</dd>
    </div>
  );
}

/**
 * İlan sahibi kartı (portföy detayı, "İlan sahibi" sekmesi). Veri RLS ile okunur: ofis yönetimi (owner/gm/şube müdürü)
 * her ilanın TÜM bilgisini, diğer danışmanlar yalnız kendi ilanlarında görür. Kayıt yoksa (eski ilan veya veritabanı
 * güncellemesi bekliyor) bilgi verir ve tamamlama formunu önermez.
 */
export async function PropertyOwnerCard({ tenantId, propertyId }: { tenantId: string; propertyId: string }) {
  const db = await createClient();
  const view = await loadOwnerInfo(db, tenantId, propertyId);

  if (!view) {
    return (
      <section id="ilan-sahibi" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <UserRound className="h-4 w-4 text-brand-600" /> İlan sahibi
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Bu ilan için yapılandırılmış ilan sahibi kaydı yok. Yeni ilanlarda sahip, tapu ve yetki bilgileri ilan oluşturulurken alınır; eski ilanlar bu
          nedenle yayın kapısına takılmaz.
        </p>
      </section>
    );
  }

  const { input, evaluation, customer } = view;
  const complete = evaluation.complete;
  return (
    <section id="ilan-sahibi" className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <ShieldCheck className="h-4 w-4" /> İlan sahibi bilgileri
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">
            {customer ? (
              <Link href={`/app/musteriler/${customer.id}`} className="hover:text-brand-600">{customer.fullName}</Link>
            ) : (
              "İlan sahibi bağlı değil"
            )}
          </h2>
          {view.customerHidden ? <p className="text-xs text-text-muted">Müşteri kaydı kapsamınız dışında olduğu için ayrıntıları gösterilemiyor.</p> : null}
        </div>
        <div className="min-w-[10rem] text-right">
          <p className="numeric text-2xl font-bold text-ink-950">%{evaluation.score}</p>
          <p className="text-xs text-text-muted">bilgi tamamlama</p>
        </div>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={evaluation.score} aria-valuemin={0} aria-valuemax={100} aria-label="Bilgi tamamlama">
        <div className={`h-full rounded-full ${complete ? "bg-mint-500" : "bg-amber-500"}`} style={{ width: `${evaluation.score}%` }} />
      </div>

      {complete ? (
        <p className="flex items-center gap-2 rounded-[var(--radius-control)] bg-mint-500/10 px-3 py-2 text-sm font-semibold text-mint-700">
          <CheckCircle2 className="h-4 w-4" /> Zorunlu bilgiler tamam: ilan yayına alınabilir.
        </p>
      ) : (
        <div className="rounded-[var(--radius-control)] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" /> Yayına alınamaz: {evaluation.missing.length} zorunlu bilgi eksik
          </p>
          <ul className="mt-1 list-disc pl-6 text-xs">
            {evaluation.missing.map((m) => <li key={m.key}>{m.label}</li>)}
          </ul>
        </div>
      )}

      <dl className="grid gap-3 sm:grid-cols-2">
        <Row k="Telefon" v={customer?.phone ? formatPhoneDisplay(customer.phone) : null} />
        <Row k="E-posta" v={customer?.email} />
        <Row k="Sahiple ilişki" v={input.relation ? label(OWNER_RELATIONS, input.relation) : null} />
        <Row k="İlan kaynağı" v={input.listingSource} />
        <Row k="Tapu durumu" v={input.deedStatus ? label(DEED_STATUSES, input.deedStatus) : null} />
        <Row k="Tapu notu" v={input.deedNote} />
        <Row k="Yetki türü" v={input.authorizationType ? label(AUTHORIZATION_TYPES, input.authorizationType) : null} />
        <Row k="Yetki dönemi" v={input.authorizationStart || input.authorizationEnd ? `${input.authorizationStart || "?"} → ${input.authorizationEnd || "?"}` : null} />
        <Row k="Komisyon türü" v={label(COMMISSION_KINDS, input.commissionKind)} />
        <Row k="Minimum fiyat" v={input.minPrice != null ? formatTry(input.minPrice) : null} />
        <Row k="Pazarlık payı" v={input.negotiationMarginPct != null ? `%${input.negotiationMarginPct}` : null} />
        <Row k="KVKK / iletişim izni" v={`KVKK onayı: ${input.kvkkConsent ? "var" : "yok"} · Ticari ileti: ${input.contactPermission ? "var" : "yok"}`} />
        <div className="sm:col-span-2"><Row k="Müşteri notları" v={input.customerNotes} /></div>
        <div className="sm:col-span-2"><Row k="Görüşme geçmişi" v={input.contactHistory} /></div>
      </dl>

      <PropertyOwnerEditor propertyId={propertyId} initial={input} hasCustomer={Boolean(view.input.ownerCustomerId)} startOpen={!complete} />
    </section>
  );
}
