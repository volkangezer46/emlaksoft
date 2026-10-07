import { formatTry } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  FileSignature,
  FileText,
  History,
  KeyRound,
  ShieldAlert,
  User,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireModulePage } from "@/lib/require-module-page";
import { listContractVersions } from "@/app/actions/contracts";
import { ContractSignPanel } from "./contract-sign-panel";
import { SignerEditPanel } from "./signer-edit-panel";
import { CancelContractButton } from "./cancel-contract-button";
import { CopySignLink } from "./copy-sign-link";
import { RemindSigner } from "./remind-signer";
import { isTenantSmsAvailable } from "@/lib/messaging/tenant-providers";
import { FillFieldsDialog } from "./fill-fields-dialog";
import { VersionHistory } from "./version-history";
import { riskSummary, scanContract } from "@/lib/contract-risk";
import { now } from "@/lib/clock";
import { ContactActions, DetailTabs, NextActionCard, resolveTab, type DetailTabDef } from "@/components/app/detail-tabs";
import { DuplicateRecordButton } from "@/components/app/record-ops-buttons";

const TYPE_LABELS: Record<string, string> = {
  satis:        "Satış",
  kira:         "Kira",
  sozlesme:     "Sözleşme",
  teklif:       "Teklif",
  yer_gosterme: "Yer gösterme",
  kapora:       "Kapora",
  diger:        "Diğer",
};

const STATUS_STYLES: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
  draft:    { cls: "bg-zinc-100 text-text-muted", icon: <Clock className="h-3.5 w-3.5" />, label: "Taslak" },
  sent:     { cls: "bg-brand-50 text-brand-700",  icon: <FileSignature className="h-3.5 w-3.5" />, label: "Gönderildi" },
  signed:   { cls: "bg-mint-50 text-mint-700", icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "İmzalandı" },
  rejected: { cls: "bg-red-50 text-red-700",    icon: <XCircle className="h-3.5 w-3.5" />, label: "Reddedildi" },
  cancelled:{ cls: "bg-zinc-50 text-text-muted",  icon: <XCircle className="h-3.5 w-3.5" />, label: "İptal" },
};

function relDate(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short" }).format(new Date(iso));
}

function entityName(v: { full_name?: string; title?: string; property_code?: string } | { full_name?: string; title?: string; property_code?: string }[] | null) {
  if (!v) return null;
  const item = Array.isArray(v) ? v[0] : v;
  return item?.full_name ?? item?.title ?? item?.property_code ?? null;
}

const CONTRACT_TAB_IDS = ["icerik", "imza", "surum"] as const;

export default async function ContractDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { perms, tenantId } = await requireModulePage("contracts", "/app/sozlesmeler");
  const canEdit = perms.contracts?.includes("edit") ?? false;
  // Sunucudan SMS hatırlatması yalnız ofiste SMS sağlayıcısı hazırsa (yoksa WhatsApp/kopyala).
  const smsReminder = canEdit && tenantId ? await isTenantSmsAvailable(tenantId) : false;
  const canCreate = perms.contracts?.includes("create") ?? false;
  const { id } = await params;
  // Seçili sekme sunucuda çözülür; sürüm geçmişi yalnız o sekmede sorgulanır
  const tab = resolveTab(await searchParams, CONTRACT_TAB_IDS, "icerik", { ozet: "icerik", imzalayanlar: "imza" });
  const supabase = await createClient();

  const { data } = await supabase
    .from("contracts")
    .select("id, title, contract_type, body, status, signed_at, expires_at, cancelled_at, created_at, updated_at, property:properties!contracts_property_id_fkey(id,property_code,title,commission_rate,address_line,list_price), customer:customers!contracts_customer_id_fkey(id,full_name,phone,email)")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  // Sign links are bearer credentials. Only an editor receives them, after
  // the page/module authorization above; ordinary contract viewers never get
  // direct table access to signer tokens or OTP state.
  const admin = createAdminClient();
  const signerQuery = canEdit
    ? admin
        .from("contract_signers")
        .select("id,full_name,email,phone,status,signed_at,token,verified_at,ip_address")
    : admin
        .from("contract_signers")
        .select("id,full_name,email,phone,status,signed_at,verified_at,ip_address");
  const { data: signerRows, error: signerError } = await signerQuery
    .eq("contract_id", id)
    .order("created_at", { ascending: true });
  if (signerError) throw new Error("Sözleşme imzalayanları okunamadı.");

  // Sürüm geçmişi — içerik düzenlendikçe önceki haller burada listelenir
  const versions = tab === "surum" ? await listContractVersions(id) : [];

  const contract = data;
  const statusInfo = STATUS_STYLES[contract.status] ?? STATUS_STYLES.draft;
  const signers = signerRows ?? [];
  const propertyName = entityName(contract.property as Parameters<typeof entityName>[0]);
  const customerName = entityName(contract.customer as Parameters<typeof entityName>[0]);

  // Bağlı kira kaydı (H6, iki yönlü bağ): ayrı ve hataya dayanıklı okunur; sütun yoksa (migration uygulanmamış) chip gizlenir.
  const rentalLinkRes = await supabase.from("contracts").select("rental_id, rent_increase_basis").eq("id", id).maybeSingle();
  const rentalLink = rentalLinkRes.error ? null : (rentalLinkRes.data as { rental_id?: string | null; rent_increase_basis?: string | null } | null);
  const linkedRentalId = rentalLink?.rental_id ?? null;
  const INCREASE_LABELS: Record<string, string> = { tufe: "TÜFE (TBK m.344)", sabit: "Sabit yüzde", yok: "Artış maddesi yok" };

  /*
   * Risk taramasi (X4). Onceden HICBIR kontrol yoktu: `createContract`
   * yalnizca baslik ve govdenin bos olmadigina bakiyordu. Sablonlar
   * `___` yer tutucularla geliyor ve doldurulmamis bir sablonu imzaya
   * gondermek sahada en sik yapilan hata.
   */
  const propertyRel = Array.isArray(contract.property) ? contract.property[0] : contract.property;
  // BUG düzeltmesi: müşteri linki yalnızca ilişki DİZİ döndüğünde üretiliyordu;
  // supabase tekil nesne döndürdüğünde ad düz metin kalıyordu. İki biçim de
  // tek yerden çözülüyor, link her iki durumda da çıkıyor.
  const customerRel = Array.isArray(contract.customer) ? contract.customer[0] : contract.customer;
  const riskler = scanContract({
    contractType: contract.contract_type,
    title: contract.title,
    body: contract.body,
    status: contract.status,
    signedAt: contract.signed_at,
    expiresAt: contract.expires_at,
    createdAt: contract.created_at,
    signerCount: signers.length,
    hasProperty: Boolean(propertyRel?.id),
    hasCustomer: Boolean(
      (Array.isArray(contract.customer) ? contract.customer[0] : contract.customer)?.id,
    ),
    commissionRate:
      propertyRel?.commission_rate != null ? Number(propertyRel.commission_rate) : null,
  });
  const ozet = riskSummary(riskler);
  const signedCount = signers.filter((s) => s.status === "signed").length;
  const pendingCount = signers.filter((s) => s.status === "pending").length;

  /** Sağ sütun — tek "sonraki en iyi eylem". */
  const sekmeHref = (t: string) => `/app/sozlesmeler/${id}?sekme=${t}`;
  const nba: { title: string; reason: string; href: string | null; label: string } =
    contract.status === "signed"
      ? {
          title: "Sözleşme imzalandı",
          reason: customerRel?.id ? "Müşteri kaydına dönüp süreci takip edin." : "İmza tamamlandı; ek işlem gerekmiyor.",
          href: customerRel?.id ? `/app/musteriler/${customerRel.id}` : null,
          label: "Müşteriye git",
        }
      : contract.status === "cancelled" || contract.status === "rejected"
        ? {
            title: contract.status === "rejected" ? "Sözleşme reddedildi" : "Sözleşme iptal edildi",
            reason: "Gerekirse yeni bir sözleşme oluşturun.",
            href: "/app/sozlesmeler",
            label: "Sözleşmeler",
          }
        : ozet.error > 0
          ? { title: `${ozet.error} hatayı giderin`, reason: "Sözleşme kontrolünde hata var; imzaya göndermeden önce düzeltin.", href: sekmeHref("icerik"), label: "Kontrole git" }
          : contract.status === "draft"
            ? { title: signers.length === 0 ? "İmzaya gönderin" : "Taslağı imzaya gönderin", reason: "İçerik hazırsa imzalayanları ekleyip gönderin.", href: sekmeHref("imza"), label: "İmza paneli" }
            : { title: `${pendingCount} imza bekleniyor`, reason: "İmzalayanlar sekmesinden \"Hatırlat\" ile WhatsApp hatırlatması gönderin ya da bağlantıyı kopyalayın.", href: sekmeHref("imza"), label: "Hatırlat" };

  const tabDefs: DetailTabDef[] = [
    { id: "icerik", label: "İçerik & kontrol", icon: FileText, count: riskler.length },
    { id: "imza", label: "İmzalayanlar", icon: FileSignature, count: signers.length },
    { id: "surum", label: "Sürüm geçmişi", icon: History },
  ];

  return (
    <div className="space-y-6">
      {/* Geri */}
      <Link
        href="/app/sozlesmeler"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Sözleşmeler
      </Link>

      {/* Hero */}
      <PageHeader
        eyebrow={TYPE_LABELS[contract.contract_type] ?? contract.contract_type}
        title={contract.title}
        description={`Oluşturuldu: ${relDate(contract.created_at)}`}
        meta={
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${statusInfo.cls}`}>
            {statusInfo.icon} {statusInfo.label}
          </span>
        }
        actions={canCreate ? <DuplicateRecordButton kind="contract" id={id} /> : undefined}
      />
      <div className="mb-6 flex flex-wrap gap-3">
        {customerName && (
          <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2 text-sm shadow-[var(--shadow-xs)]">
            <User className="h-4 w-4 text-mint-700" />
            <span className="text-text-muted">Müşteri:</span>
            <span className="font-semibold text-text">
              {customerRel?.id ? (
                <Link href={`/app/musteriler/${customerRel.id}`} className="focus-ring rounded-[var(--radius-control)] hover:underline">
                  {customerName}
                </Link>
              ) : (
                customerName
              )}
            </span>
          </div>
        )}
        {propertyName && (
          <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2 text-sm shadow-[var(--shadow-xs)]">
            <Building2 className="h-4 w-4 text-brand-700" />
            <span className="text-text-muted">Portföy:</span>
            <span className="font-semibold text-text">
              {propertyRel?.id ? (
                <Link href={`/app/portfoyler/${propertyRel.id}`} className="focus-ring rounded-[var(--radius-control)] hover:underline">
                  {propertyName}
                </Link>
              ) : (
                propertyName
              )}
            </span>
          </div>
        )}
        {linkedRentalId && (
          <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2 text-sm shadow-[var(--shadow-xs)]">
            <KeyRound className="h-4 w-4 text-brand-700" />
            <span className="text-text-muted">Kira kaydı:</span>
            <Link href={`/app/kiralama/${linkedRentalId}?sekme=sozlesme`} className="focus-ring rounded-[var(--radius-control)] font-semibold text-text hover:underline">
              Kiralama detayını aç
            </Link>
            {rentalLink?.rent_increase_basis ? <span className="text-xs text-text-muted">· {INCREASE_LABELS[rentalLink.rent_increase_basis] ?? rentalLink.rent_increase_basis}</span> : null}
          </div>
        )}
        {contract.expires_at && (
          <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2 text-sm shadow-[var(--shadow-xs)]">
            <Clock className="h-4 w-4 text-amber-700" />
            <span className="text-text-muted">Son geçerlilik:</span>
            <span className="font-semibold text-text">
              {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(contract.expires_at))}
            </span>
          </div>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <DetailTabs basePath={`/app/sozlesmeler/${id}`} tabs={tabDefs} active={tab} label="Sözleşme sekmeleri" />

          {tab === "icerik" ? (
            <div className="space-y-4">
                  <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-6 shadow-[var(--shadow-xs)]">
                    {/* Risk taramasi — icerigin USTUNDE: kullanici metni okumadan
                        once neyin eksik oldugunu gormeli. */}
                    {riskler.length > 0 ? (
                      <section className="mb-4 rounded-[var(--radius-card)] border border-line bg-canvas p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
                            <ShieldAlert className="h-4 w-4 text-amber-500" /> Sözleşme kontrolü
                          </h2>
                          <div className="flex flex-wrap gap-1.5">
                            {ozet.error > 0 ? (
                              <span className="rounded-full bg-danger-500/10 px-2.5 py-0.5 text-xs font-bold text-danger-600">
                                {ozet.error} hata
                              </span>
                            ) : null}
                            {ozet.warning > 0 ? (
                              <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs font-bold text-amber-600">
                                {ozet.warning} uyarı
                              </span>
                            ) : null}
                            {ozet.info > 0 ? (
                              <span className="rounded-full bg-brand-600/10 px-2.5 py-0.5 text-xs font-bold text-brand-600">
                                {ozet.info} bilgi
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <ul className="mt-3 space-y-2">
                          {riskler.map((r) => (
                            <li
                              key={r.code}
                              className={`rounded-[var(--radius-card)] border px-3.5 py-2.5 ${
                                r.level === "error"
                                  ? "border-danger-500/30 bg-danger-500/[0.05]"
                                  : r.level === "warning"
                                    ? "border-amber-400/35 bg-amber-400/[0.06]"
                                    : "border-line bg-surface"
                              }`}
                            >
                              <p
                                className={`text-sm font-semibold ${
                                  r.level === "error"
                                    ? "text-danger-600"
                                    : r.level === "warning"
                                      ? "text-amber-600"
                                      : "text-ink-950"
                                }`}
                              >
                                {r.title}
                              </p>
                              <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{r.detail}</p>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-3 text-xs leading-relaxed text-text-faint">
                          Bu tarama <strong>mekanik</strong>tir: bir maddenin varlığını arar, içeriğinin doğru ya
                          da yeterli olduğunu söyleyemez. <strong>Hukuki görüş yerine geçmez.</strong>
                        </p>
                      </section>
                    ) : (
                      <p className="mb-4 flex items-center gap-2 rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/[0.06] px-4 py-2.5 text-sm text-mint-600">
                        <ShieldAlert className="h-4 w-4" /> Mekanik kontrollerde bulgu yok.
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                        <FileText className="h-4 w-4 text-brand-600" /> İçerik
                      </h2>
                      {canEdit && (
                        <div className="flex flex-wrap items-center gap-2">
                          {contract.status === "draft" && (
                            <>
                              {/* Değişken doldurma sihirbazı — ___ / {{...}} kalıplarını
                                  müşteri+portföy verisinden önerilerle doldurur. key:
                                  içerik değişince alan listesi ve öneriler tazelensin. */}
                              <FillFieldsDialog
                                key={contract.updated_at ?? contract.body.length}
                                contractId={id}
                                body={contract.body ?? ""}
                                suggestions={{
                                  customerName:    customerRel?.full_name ?? null,
                                  customerPhone:   customerRel?.phone ?? null,
                                  customerEmail:   customerRel?.email ?? null,
                                  propertyLabel:   propertyRel
                                    ? (propertyRel.title ?? propertyRel.property_code ?? null)
                                    : null,
                                  propertyAddress: propertyRel?.address_line ?? null,
                                  priceText:       propertyRel?.list_price != null
                                    ? formatTry(Number(propertyRel.list_price))
                                    : null,
                                  todayText: new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(new Date(now())),
                                }}
                              />
                              <Link
                                href={`/app/sozlesmeler/${id}/duzenle`}
                                className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-600/5"
                              >
                                Düzenle
                              </Link>
                            </>
                          )}
                          {/* İptal: imzalanmamış/iptal edilmemiş sözleşmeler geri çekilebilir. */}
                          {["draft", "sent"].includes(contract.status) && (
                            <CancelContractButton id={id} />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="mt-4 max-h-[60vh] overflow-y-auto">
                      {contract.body ? (
                        <div className="prose prose-sm max-w-none whitespace-pre-wrap rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4 text-sm leading-relaxed text-ink-950">
                          {contract.body}
                        </div>
                      ) : (
                        <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong p-6 text-center text-sm text-text-muted">
                          İçerik girilmemiş.
                        </p>
                      )}
                    </div>
                  </section>
            </div>
          ) : null}

          {tab === "imza" ? (
            <div className="space-y-4">
                    {/* İmzalayan listesi */}
                    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
                      <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                        <FileSignature className="h-4 w-4 text-mint-600" /> İmzalayanlar
                        <span className="ml-auto text-xs font-normal text-text-faint">{signers.length} kişi</span>
                      </h2>

                      {signers.length === 0 ? (
                        <p className="mt-3 text-sm text-text-muted">
                          Henüz imzalayan eklenmedi.
                          {contract.status === "draft" && " Aşağıdan imzaya gönderin."}
                        </p>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {signers.map((s) => (
                            <div key={s.id} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-2.5">
                              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${
                                s.status === "signed" ? "bg-mint-500" : s.status === "rejected" ? "bg-danger-500" : "bg-zinc-400"
                              }`}>
                                {(s.full_name as string).slice(0, 1).toUpperCase()}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-ink-950">{s.full_name as string}</p>
                                <p className="text-xs text-text-faint">
                                  {s.email as string | null ?? s.phone as string | null ?? "—"}
                                </p>
                                {/* İmza denetim izi: imzalayan IP + zaman — e-imzanın hukuki
                                    kanıtı. Yazılıyordu ama gösterilmiyordu. */}
                                {s.status === "signed" && (s.ip_address || s.signed_at) ? (
                                  <p className="mt-0.5 text-xs tabular-nums text-text-faint">
                                    {s.ip_address ? `IP ${String(s.ip_address)}` : ""}
                                    {s.ip_address && s.signed_at ? " · " : ""}
                                    {s.signed_at ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(s.signed_at as string)) : ""}
                                  </p>
                                ) : null}
                              </div>
                              {/* SMS ulaşmadıysa imza linki elle iletilebilsin — token
                                  gönderimde DB tarafında üretiliyor, /imza/{token} */}
                              {canEdit && s.status === "pending" && "token" in s && s.token ? (
                                <>
                                  <RemindSigner
                                    token={String(s.token)}
                                    fullName={String(s.full_name)}
                                    phone={(s.phone as string | null) ?? null}
                                    contractTitle={contract.title}
                                    contractId={String(contract.id)}
                                    signerId={String(s.id)}
                                    smsAvailable={smsReminder && contract.status === "sent"}
                                  />
                                  <CopySignLink token={String(s.token)} />
                                </>
                              ) : null}
                              {canEdit && s.status === "pending" ? (
                                <SignerEditPanel
                                  signer={{
                                    id: String(s.id),
                                    full_name: String(s.full_name),
                                    email: (s.email as string | null) ?? null,
                                    phone: (s.phone as string | null) ?? null,
                                  }}
                                />
                              ) : null}
                              {/* SMS OTP ile telefonunu doğrulayan imzalayan rozeti */}
                              {s.verified_at ? (
                                <span className="whitespace-nowrap rounded-full bg-mint-500/12 px-2 py-0.5 text-xs font-bold text-mint-600" title="Telefon SMS koduyla doğrulandı">
                                  SMS ile doğrulandı ✓
                                </span>
                              ) : null}
                              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                                s.status === "signed" ? "bg-mint-500/12 text-mint-600" :
                                s.status === "rejected" ? "bg-danger-500/12 text-danger-500" :
                                "bg-zinc-100 text-text-muted"
                              }`}>
                                {s.status === "signed" ? "İmzaladı" : s.status === "rejected" ? "Reddetti" : "Bekliyor"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    {/* Gönderme paneli — sadece taslak + yetki varsa */}
                    {canEdit && (
                      <ContractSignPanel contractId={id} status={contract.status} />
                    )}

                    {/* İmzalanma tarihi */}
                    {contract.signed_at && (
                      <div className="rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/8 px-4 py-3 text-sm">
                        <p className="flex items-center gap-2 font-semibold text-mint-700">
                          <CheckCircle2 className="h-4 w-4" /> İmzalandı
                        </p>
                        <p className="mt-1 text-xs text-mint-700/70">{relDate(contract.signed_at)}</p>
                      </div>
                    )}
            </div>
          ) : null}

          {tab === "surum" ? (
            <div className="space-y-4">
                    {/* Sürüm geçmişi — içerik düzenlendikçe önceki haller (geri dönülebilir) */}
                    <VersionHistory
                      contractId={id}
                      versions={versions}
                      canRestore={canEdit && contract.status === "draft"}
                    />
            </div>
          ) : null}
        </div>

        {/* Sağ sütun — her sekmede görünür */}
        <aside aria-label="Özet ve sonraki eylem" className="space-y-4 lg:sticky lg:top-4">
          <NextActionCard title={nba.title} reason={nba.reason} href={nba.href} label={nba.label} />
          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-text-muted">
              {customerName ?? "Müşteri bağlı değil"}
            </p>
            <div className="mt-3">
              <ContactActions
                phone={customerRel?.phone}
                name={customerRel?.full_name}
                appointmentHref={customerRel?.id ? `/app/randevular?customer=${customerRel.id}${propertyRel?.id ? `&property=${propertyRel.id}` : ""}` : null}
              />
            </div>
            <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
              {contract.status === "cancelled" && contract.cancelled_at ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">İptal tarihi</dt>
                  <dd className="font-semibold text-danger-600">
                    {new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" }).format(new Date(contract.cancelled_at))}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">İmza</dt>
                <dd className="font-semibold text-ink-950">{signedCount}/{signers.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">Kontrol bulgusu</dt>
                <dd className="font-semibold text-ink-950">{riskler.length}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

    </div>
  );
}
