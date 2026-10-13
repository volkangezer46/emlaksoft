"use client";

import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import {
  Archive,
  ArrowRight,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Crown,
  Database,
  ExternalLink,
  Gem,
  History,
  LifeBuoy,
  Mail,
  MoreVertical,
  PauseCircle,
  Receipt,
  Settings2,
  TriangleAlert,
  User,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { startImpersonation, updateTenantPlanStatus } from "@/app/actions/platform";
import { bulkTenantAction, type BulkTenantOp } from "@/app/actions/platform-crm";
import { BulkBar } from "@/components/ui/list-kit";
import { Checkbox } from "@/components/ui/checkbox";
import { PersonSelect } from "@/components/ui/person-select";
import { HEALTH_BAND_LABELS, HEALTH_BAND_TONE, type HealthBand } from "@/lib/admin/health-score";
import { LIFECYCLE_LABELS, LIFECYCLE_TONE, type CrmStaff, type CrmTag, type LifecycleStage } from "@/lib/admin/platform-crm";
import { TagBadge } from "./crm-toolbar";
import { resendTenantOwnerAccessLink } from "@/app/actions/platform-tenants";
import { Button, ButtonLink } from "@/components/ui/button";
import { DraftTable } from "@/components/ui/draft-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InlineSelect, type InlineSelectOption } from "@/components/ui/inline-select";
import { RowSaveActions, rowDraftProps } from "@/components/ui/row-save-actions";
import { OFFICE_STATUS_LABELS } from "@/lib/admin/office-create-rules";
import { tenantRowRisk, validateTenantRow } from "@/lib/admin/tenant-row-rules";
import { useRowDraft } from "@/lib/ui/use-row-draft";
import { cn } from "@/lib/utils";
import type { ActivityHealth } from "./tenants-model";

/**
 * Ofisler tablosu (istemci): satır içi kaydetme standardı (docs/DESIGN_SYSTEM.md). Durum + paket aynı satırda
 * düzenlenir, Kaydet TEK satırı `updateTenantPlanStatus` ile yazar (iyimser eşzamanlılık: `expected_updated_at`).
 * Mevcut veri ve yetkili durumu düzenlenmez (karşılık gelen admin eylemi yok): filtre/ayrıntı bağlantısıdır.
 * Yetkili ve veri durumu ayrı sütun değil: kimlik hücresinde rozet ("Sahip aktif", "Demo veri") + ⋮ menüde "Ekip ve yetkili" / "Sahibe erişim bağlantısı gönder".
 * Satırda birincil eylemler `Yönet` + `Ofise gir`; kalanı ⋮ (Ofis 360 sekmeleri, vitrin, askıya al).
 * CRM (AD5): sağlık skoru, etiket ve sorumlu sütunları (her değer listeyi o değere süzen bağlantıdır) + çoklu seçimle
 * toplu işlem çubuğu (etiket ekle/kaldır, sorumlu ata, deneme uzat, durum). Toplu eylem tek istekte sunucuda çalışır;
 * her ofis için denetim kaydı yazılır ve uygulanamayanlar adıyla listelenir.
 */

export type TenantRowData = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  updatedAt: string | null;
  createdLabel: string;
  trialLabel: string | null;
  trialOver: boolean;
  members: number | null;
  health: ActivityHealth;
  sample: boolean;
  owner: "active" | "inactive" | "none" | null;
  dataHref: string;
  /** CRM verisi; null = CRM kurulumu bekliyor ya da okunamadı (sütunlar "—"). */
  crm: {
    score: number | null;
    band: HealthBand | null;
    scoreHref: string | null;
    tags: (CrmTag & { href: string })[];
    owner: { id: string; name: string; href: string } | null;
    stage: LifecycleStage;
    stageAuto: boolean;
    stageHref: string;
  } | null;
};

export type TenantBulkConfig = {
  perms: { crm: boolean; trial: boolean; status: boolean; destructiveStatus: boolean };
  tags: CrmTag[];
  staff: CrmStaff[];
};

export type TenantPlanOption = { id: string; name: string; order: number; hidden: boolean };

export type TenantTablePerms = { canEdit: boolean; canImpersonate: boolean; canResend: boolean };

const STATUS_META: Record<string, Pick<InlineSelectOption, "icon" | "tone" | "hint">> = {
  active: { icon: CheckCircle2, tone: "success" },
  trial: { icon: Clock3, tone: "gold" },
  past_due: { icon: TriangleAlert, tone: "warn" },
  suspended: { icon: PauseCircle, tone: "danger", hint: "Panel erişimi kesilir" },
  cancelled: { icon: Archive, tone: "neutral", hint: "Arşiv; veri silinmez" },
};
const STATUS_OPTIONS: InlineSelectOption[] = Object.entries(OFFICE_STATUS_LABELS).map(([value, label]) => ({ value, label, ...STATUS_META[value] }));

const PLAN_META: Record<string, Pick<InlineSelectOption, "icon" | "tone">> = {
  advisor: { icon: User, tone: "brand" },
  office: { icon: Building2, tone: "brand" },
  professional: { icon: Crown, tone: "gold" },
  business: { icon: Briefcase, tone: "gold" },
  enterprise: { icon: Gem, tone: "gold" },
};

const HEALTH_TEXT: Record<ActivityHealth["tone"], string> = {
  success: "text-[var(--pm-success-text)]",
  warn: "text-[var(--pm-warn-text)]",
  danger: "text-[var(--pm-danger-text)]",
  neutral: "text-text-muted",
};

export function TenantTable({
  rows,
  plans,
  perms,
  bulk = null,
}: {
  rows: TenantRowData[];
  plans: TenantPlanOption[];
  perms: TenantTablePerms;
  bulk?: TenantBulkConfig | null;
}) {
  const planOrder = Object.fromEntries(plans.map((p) => [p.id, p.order]));
  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? id;
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const canBulk = Boolean(bulk && (bulk.perms.crm || bulk.perms.trial || bulk.perms.status));
  const showCrm = rows.some((r) => r.crm !== null);
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <DraftTable>
      {canBulk && bulk && selected.size > 0 ? (
        <TenantBulkBar
          ids={[...selected]}
          names={new Map(rows.map((r) => [r.id, r.name]))}
          config={bulk}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
      <div className="adm-cq" data-roomy="">
        <div className="adm-scroll">
          <table className="adm-tbl">
            <caption className="sr-only">Ofisler; durum ve paket satır içinde düzenlenir, her satır kendi Kaydet düğmesiyle kaydedilir.</caption>
            <thead>
              <tr>
                {canBulk ? (
                  <th scope="col" className="w-8">
                    <Checkbox
                      checked={allOn}
                      onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))}
                      aria-label={allOn ? "Sayfadaki seçimi kaldır" : "Sayfadaki tüm ofisleri seç"}
                    />
                  </th>
                ) : null}
                <th scope="col">Ofis bilgileri</th>
                {showCrm ? (
                  <>
                    <th scope="col">Sağlık</th>
                    <th scope="col">Etiketler</th>
                    <th scope="col">Sorumlu</th>
                  </>
                ) : null}
                <th scope="col">Durum</th>
                <th scope="col">Paket</th>
                <th scope="col" className="text-right">
                  İşlemler
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <TenantRow
                  key={row.id}
                  row={row}
                  plans={plans}
                  planOrder={planOrder}
                  planName={planName}
                  perms={perms}
                  showCrm={showCrm}
                  select={canBulk ? { on: selected.has(row.id), toggle: () => toggle(row.id) } : null}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DraftTable>
  );
}

const OWNER_META = {
  active: { label: "Sahip aktif", tone: "success", Icon: UserCheck },
  inactive: { label: "Sahip pasif", tone: "danger", Icon: UserX },
  none: { label: "Sahip yok", tone: "danger", Icon: UserX },
} as const;

/** Yetkili durumu: ayrı sütun değil, kimlik hücresinin meta satırında küçük rozet (Ofis 360 > Ekip'e gider). */
function OwnerBadge({ owner, href }: { owner: TenantRowData["owner"]; href: string }) {
  if (owner === null) return null;
  const m = OWNER_META[owner];
  return (
    <Link href={href} className={`adm-badge pm-t-${m.tone} focus-ring`} title="Ofis ekibini ve yetkiliyi aç">
      <m.Icon aria-hidden="true" />
      {m.label}
    </Link>
  );
}

function TenantRow({
  row,
  plans,
  planOrder,
  planName,
  perms,
  showCrm,
  select,
}: {
  row: TenantRowData;
  plans: TenantPlanOption[];
  planOrder: Record<string, number>;
  planName: (id: string) => string;
  perms: TenantTablePerms;
  showCrm: boolean;
  select: { on: boolean; toggle: () => void } | null;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [resending, startResend] = useTransition();
  const draft = useRowDraft({
    id: row.id,
    label: row.name,
    saved: { status: row.status, plan: row.plan },
    version: row.updatedAt,
    validate: validateTenantRow,
    risk: (d, s) => tenantRowRisk(d, s, planOrder, planName),
    save: async (d, ctx) => {
      const fd = new FormData();
      fd.set("id", row.id);
      fd.set("plan", d.plan);
      fd.set("status", d.status);
      if (ctx.version) fd.set("expected_updated_at", ctx.version);
      const res = await updateTenantPlanStatus(fd);
      if (res.ok) {
        router.refresh();
        return { ok: true };
      }
      if (res.code === "stale") router.refresh();
      return { error: res.error ?? "Paket ve durum kaydedilemedi." };
    },
  });

  const planOptions: InlineSelectOption[] = plans
    .filter((p) => !p.hidden || p.id === row.plan || p.id === draft.draft.plan)
    .map((p) => ({ value: p.id, label: p.name, ...(PLAN_META[p.id] ?? { icon: Building2, tone: "brand" as const }) }));
  const detail = `/admin/tenants/${row.id}`;
  const disabled = !perms.canEdit || draft.locked;
  // Askıya alma ⋮'den taslağa yazılır: satırda Kaydet grubu belirir, kaydederken satır içi risk onayı istenir.
  const canSuspend = perms.canEdit && !draft.locked && draft.draft.status !== "suspended" && draft.draft.status !== "cancelled";
  const healthTitle = row.health.n === null ? "Son 14 günün işlem sayısı alınamadı" : `Son 14 günde ${row.health.n} işlem (denetim kaydı)`;

  function resend() {
    setNotice(null);
    startResend(async () => {
      const fd = new FormData();
      fd.set("id", row.id);
      const res = await resendTenantOwnerAccessLink(fd);
      setNotice(res.ok ? { tone: "ok", text: res.message ?? "Erişim bağlantısı gönderildi." } : { tone: "error", text: res.error ?? "Gönderilemedi." });
    });
  }

  return (
    <tr {...rowDraftProps(draft)}>
      {select ? (
        <td className="w-8">
          <Checkbox checked={select.on} onChange={select.toggle} aria-label={`Seç: ${row.name}`} />
        </td>
      ) : null}
      <td>
        <div className="adm-ent">
          <span className="adm-ent-ico" aria-hidden="true">
            <Building2 />
            {row.status === "active" ? <span className="status-pulse absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface)] bg-mint-500" /> : null}
          </span>
          <div className="min-w-0">
            <Link href={detail} title={row.name} className="adm-ent-name focus-ring block min-w-0 truncate rounded-sm hover:text-accent-text">
              {row.name}
            </Link>
            <div className="adm-ent-meta">
              <span className="min-w-0 max-w-full truncate" title={`/${row.slug}`}>/{row.slug}</span>
              <Link href={`/admin/members?tenant=${row.id}`} className="font-semibold text-accent-text hover:underline" title="Ofisin kullanıcılarını listele">
                <Users aria-hidden="true" /> {row.members === null ? "—" : `${row.members} üye`}
              </Link>
              <span title="Kayıt tarihi">
                <CalendarDays aria-hidden="true" /> {row.createdLabel}
              </span>
              <span className={HEALTH_TEXT[row.health.tone]} title={healthTitle}>
                ● {row.health.label}
              </span>
              <OwnerBadge owner={row.owner} href={`${detail}?sekme=ekip`} />
              {/* Veri durumu: sütun değil rozet; yalnız örnek (demo) veri varken (gerçek veri varsayılan, sakin). */}
              {row.sample ? (
                <Link
                  href={row.dataHref}
                  className="adm-badge pm-t-warn focus-ring"
                  title="Ofiste örnek (demo) veri yüklü; gerçek kullanıma geçmedi. Tıklayınca aynı durumdaki ofisleri süzer."
                >
                  <Database aria-hidden="true" />
                  Demo veri
                </Link>
              ) : null}
            </div>
            {row.trialLabel ? (
              <p className={cn("mt-0.5 flex items-center gap-1 text-xs", row.trialOver ? "text-[var(--pm-danger-text)]" : "text-[var(--pm-warn-text)]")}>
                <Clock3 className="h-3 w-3" aria-hidden="true" />
                {row.trialOver ? "Deneme bitti: " : "Deneme bitişi: "}
                {row.trialLabel}
              </p>
            ) : null}
            {notice ? (
              <p role={notice.tone === "error" ? "alert" : "status"} className={cn("mt-0.5 text-xs font-semibold", notice.tone === "error" ? "text-[var(--pm-danger-text)]" : "text-[var(--pm-success-text)]")}>
                {notice.text}
              </p>
            ) : null}
          </div>
        </div>
      </td>
      {showCrm ? <CrmCells crm={row.crm} /> : null}
      <td data-label="Durum">
        <InlineSelect
          value={draft.draft.status}
          onValueChange={(v) => draft.set("status", v)}
          options={STATUS_OPTIONS}
          label={`${row.name} durumu`}
          changed={draft.changed.has("status")}
          disabled={disabled}
          className="w-[9.25rem]"
        />
      </td>
      <td data-label="Paket">
        <InlineSelect
          value={draft.draft.plan}
          onValueChange={(v) => draft.set("plan", v)}
          options={planOptions}
          label={`${row.name} paketi`}
          changed={draft.changed.has("plan")}
          disabled={disabled}
          className="w-[9.25rem]"
        />
      </td>
      <td>
        <div className="adm-acts">
          <RowSaveActions draft={draft}>
            <ButtonLink href={`${detail}?sekme=yonetim`} size="sm" variant="outline" icon={Settings2} aria-label={`Yönet: ${row.name}`} title="Ofis yönetimi">
              <span className="btn-text">Yönet</span>
            </ButtonLink>
            {perms.canImpersonate ? (
              <form action={startImpersonation}>
                <input type="hidden" name="tenant_id" value={row.id} />
                <ImpersonateButton name={row.name} />
              </form>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label={`Diğer işlemler: ${row.name}`}>
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild>
                  <Link href={detail}>
                    <Building2 aria-hidden="true" /> Ofis 360
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`${detail}?sekme=ekip`}>
                    <Users aria-hidden="true" /> Ekip ve yetkili{row.owner ? ` · ${OWNER_META[row.owner].label}` : ""}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`${detail}?sekme=abonelik`}>
                    <Receipt aria-hidden="true" /> Abonelik ve fatura
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`${detail}?sekme=destek`}>
                    <LifeBuoy aria-hidden="true" /> Destek talepleri
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`${detail}?sekme=zaman`}>
                    <History aria-hidden="true" /> Zaman çizelgesi
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`/vitrin/${row.slug}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden="true" /> Vitrini aç
                  </a>
                </DropdownMenuItem>
                {perms.canResend || canSuspend ? <DropdownMenuSeparator /> : null}
                {perms.canResend ? (
                  <DropdownMenuItem disabled={resending} onSelect={resend}>
                    <Mail aria-hidden="true" /> {resending ? "Gönderiliyor…" : "Sahibe erişim bağlantısı gönder"}
                  </DropdownMenuItem>
                ) : null}
                {canSuspend ? (
                  <DropdownMenuItem danger onSelect={() => draft.set("status", "suspended")}>
                    <PauseCircle aria-hidden="true" /> Askıya al…
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </RowSaveActions>
        </div>
      </td>
    </tr>
  );
}

function ImpersonateButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="gold" icon={ArrowRight} loading={pending} aria-label={`Ofise gir: ${name}`} title="Destek oturumuyla ofis paneline gir">
      <span className="btn-text">Ofise gir</span>
    </Button>
  );
}

/** CRM sütunları: sağlık skoru + aşama, etiketler, sorumlu. Her değer listeyi o değere süzer (sıfır çıkmaz metrik). */
function CrmCells({ crm }: { crm: TenantRowData["crm"] }) {
  if (!crm) {
    return (
      <>
        <td data-label="Sağlık" className="text-text-faint">—</td>
        <td data-label="Etiketler" className="text-text-faint">—</td>
        <td data-label="Sorumlu" className="text-text-faint">—</td>
      </>
    );
  }
  return (
    <>
      <td data-label="Sağlık">
        <div className="flex flex-col items-start gap-1">
          {crm.score !== null && crm.band && crm.scoreHref ? (
            <Link href={crm.scoreHref} className={`adm-badge pm-t-${HEALTH_BAND_TONE[crm.band]} focus-ring tabular-nums`} title={`Sağlık skoru ${crm.score}/100 · ${HEALTH_BAND_LABELS[crm.band]}. Aynı banttaki ofisleri göster`}>
              {crm.score} · {HEALTH_BAND_LABELS[crm.band]}
            </Link>
          ) : (
            <span className="text-xs text-text-faint" title="Skor günlük hesaplanır; bu ofis için henüz hesaplanmadı">Hesaplanmadı</span>
          )}
          <Link href={crm.stageHref} className={`adm-badge pm-t-${LIFECYCLE_TONE[crm.stage]} focus-ring`} title={crm.stageAuto ? "Aşama ofis durumundan türetildi (elle seçilmedi)" : "Yaşam döngüsü aşaması"}>
            {LIFECYCLE_LABELS[crm.stage]}
            {crm.stageAuto ? " · oto" : ""}
          </Link>
        </div>
      </td>
      <td data-label="Etiketler">
        {crm.tags.length ? (
          <div className="flex max-w-[12rem] flex-wrap gap-1">
            {crm.tags.map((t) => (
              <TagBadge key={t.id} tag={t} href={t.href} />
            ))}
          </div>
        ) : (
          <span className="text-xs text-text-faint">—</span>
        )}
      </td>
      <td data-label="Sorumlu">
        {crm.owner ? (
          <Link href={crm.owner.href} className="focus-ring block max-w-[10rem] truncate rounded-sm text-sm font-semibold hover:text-accent-text" title="Bu personelin sorumlu olduğu ofisleri göster">
            {crm.owner.name}
          </Link>
        ) : (
          <span className="text-xs text-text-faint">Atanmamış</span>
        )}
      </td>
    </>
  );
}

const BULK_OPS: { value: BulkTenantOp["op"]; label: string; perm: keyof TenantBulkConfig["perms"] }[] = [
  { value: "tag_add", label: "Etiket ekle", perm: "crm" },
  { value: "tag_remove", label: "Etiket kaldır", perm: "crm" },
  { value: "owner", label: "Sorumlu ata", perm: "crm" },
  { value: "trial_extend", label: "Denemeyi uzat", perm: "trial" },
  { value: "status", label: "Durumu değiştir", perm: "status" },
];

const SELECT_CLS =
  "min-h-8 touch:min-h-11 rounded-[var(--radius-control)] border border-line bg-canvas px-2 text-sm text-text outline-none transition focus:border-brand-400 focus:bg-surface";

function TenantBulkBar({ ids, names, config, onClear }: { ids: string[]; names: Map<string, string>; config: TenantBulkConfig; onClear: () => void }) {
  const router = useRouter();
  const ops = BULK_OPS.filter((o) => config.perms[o.perm]);
  const [op, setOp] = useState<BulkTenantOp["op"]>(ops[0]?.value ?? "tag_add");
  const [tagId, setTagId] = useState(config.tags[0]?.id ?? "");
  const [staffId, setStaffId] = useState("");
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("Toplu işlemle deneme süresi uzatıldı");
  const [status, setStatus] = useState("active");
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string; failed: { name: string; error: string }[] } | null>(null);
  const [pending, start] = useTransition();
  const statusOptions = STATUS_OPTIONS.filter((o) => config.perms.destructiveStatus || (o.value !== "suspended" && o.value !== "cancelled"));

  function apply() {
    setResult(null);
    const action: BulkTenantOp =
      op === "tag_add" || op === "tag_remove"
        ? { op, tagId }
        : op === "owner"
          ? { op, staffId: staffId || null }
          : op === "trial_extend"
            ? { op, days: Number(days), reason }
            : { op: "status", status };
    start(async () => {
      const r = await bulkTenantAction(ids, action);
      if (r.error) {
        setResult({ tone: "error", text: r.error, failed: [] });
        return;
      }
      setResult({ tone: r.failed.length ? "error" : "ok", text: r.message ?? `${r.done} ofiste uygulandı.`, failed: r.failed.map((f) => ({ name: names.get(f.id) ?? f.name, error: f.error })) });
      router.refresh();
    });
  }

  const needTag = (op === "tag_add" || op === "tag_remove") && !tagId;
  return (
    <BulkBar count={ids.length} noun="ofis" onClear={onClear} className="mx-3 mb-2">
      <select aria-label="Toplu işlem" value={op} onChange={(e) => setOp(e.target.value as BulkTenantOp["op"])} className={SELECT_CLS}>
        {ops.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {op === "tag_add" || op === "tag_remove" ? (
        config.tags.length ? (
          <select aria-label="Etiket" value={tagId} onChange={(e) => setTagId(e.target.value)} className={SELECT_CLS}>
            {config.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-text-muted">Önce “Etiketler” menüsünden etiket oluşturun.</span>
        )
      ) : null}
      {op === "owner" ? (
        <PersonSelect
          people={config.staff.map((s) => ({ id: s.id, name: s.name }))}
          value={staffId}
          onValueChange={setStaffId}
          emptyLabel="Sorumluyu kaldır"
          clearable
          aria-label="Sorumlu personel"
          className="min-w-[11rem]"
        />
      ) : null}
      {op === "trial_extend" ? (
        <>
          <label className="inline-flex items-center gap-1 text-sm">
            <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Uzatılacak gün" className={cn(SELECT_CLS, "w-16 tabular-nums")} />
            gün
          </label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Gerekçe (en az 10 karakter)" maxLength={200} className={cn(SELECT_CLS, "w-[min(16rem,60vw)]")} />
        </>
      ) : null}
      {op === "status" ? (
        <select aria-label="Yeni durum" value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT_CLS}>
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : null}
      <Button size="sm" onClick={apply} loading={pending} disabled={needTag}>
        Uygula
      </Button>
      {result ? (
        <div role={result.tone === "error" ? "alert" : "status"} className={cn("basis-full text-xs font-semibold", result.tone === "error" ? "text-[var(--pm-danger-text)]" : "text-[var(--pm-success-text)]")}>
          {result.text}
          {result.failed.length ? (
            <ul className="mt-1 list-disc pl-4 font-normal">
              {result.failed.slice(0, 8).map((f, i) => (
                <li key={i}>
                  {f.name}: {f.error}
                </li>
              ))}
              {result.failed.length > 8 ? <li>… ve {result.failed.length - 8} ofis daha</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </BulkBar>
  );
}
