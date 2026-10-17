import { Archive, Database, FileLock2, HardDrive, History, Trash2 } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/list-kit/status-pill";
import { requirePlatformModule } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";
import { relativeTimeTR } from "@/lib/admin-format";
import { formatDateTimeTr } from "@/lib/format";
import { RETENTION_RULES, STEP_STATUS_LABEL, formatBytesTr, type StepStatus } from "@/lib/admin/ops/retention-catalog";
import { loadRetention } from "@/lib/admin/ops/read";
import { CronRunButton } from "../sistem/cron-run-button";
import { OpsCard, OpsGrid, OpsKpis, OpsList, OpsRow, num } from "../_components/ops-kit";
import "@/app/app/_home/kurumsal/home.css";

export const metadata = { title: "Veri saklama" };

const STEP_TONE: Record<StepStatus, "success" | "danger" | "neutral" | "info"> = { ok: "success", error: "danger", skipped: "neutral", unknown: "info" };
const BACKUP_LEVEL = { iyi: { tone: "success", label: "Güncel" }, uyari: { tone: "warning", label: "Dikkat" }, kritik: { tone: "danger", label: "Kritik" } } as const;

/**
 * VERİ SAKLAMA VE YEDEK (KVKK m.7 imha + iş sürekliliği). Kaynaklar: saklama kataloğu (`retention-catalog.ts`, gece işi
 * `operational-retention` adımlarıyla birebir), son 14 çalıştırma (`cron_runs`, adım bazında sonuç), yedek koşuları
 * (`backup_runs`: şifreli/uzak kopya), dosya silme kuyruğu ve (üye yetkisi varsa) KVKK silme/veri paketi sayıları.
 * Eylem: saklama işini şimdi çalıştır (yalnız süper admin; mevcut cron çalıştırma eylemi, denetim kaydı).
 */
export default async function RetentionPage() {
  const staff = await requirePlatformModule("sistem");
  const canKvkk = platformCanAccess(staff, "members");
  const d = await loadRetention({ kvkk: canKvkk });
  const last = d.runs[0] ?? null;
  const failingSteps = last ? Object.values(last.parsed.steps).filter((s) => s === "error").length : 0;
  const lvl = BACKUP_LEVEL[d.backup.level];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="document"
        icon={Database}
        eyebrow="Güvenlik & veri"
        title="Veri saklama"
        description="Hangi verinin ne kadar saklandığı, gece imha işinin adım adım sonucu, dosya silme kuyruğu ve yedeklerin durumu."
        actions={staff.role === "super_admin" ? <CronRunButton job="operational-retention" label="Operasyonel veri ve KVKK dosya temizliği" /> : undefined}
      />

      <OpsKpis
        label="Saklama ve yedek göstergeleri"
        items={[
          { key: "run", title: "Son imha turu", value: last ? relativeTimeTR(last.finishedAt) : "—", href: "#calistirmalar", icon: History, tone: last?.status === "error" ? "rose" : "brand", caption: last ? (failingSteps ? `${failingSteps} adım hatalı` : "Tüm adımlar tamam") : "Kayıt yok" },
          { key: "bk", title: "Son başarılı yedek", value: d.backup.hoursSinceOk === null ? "—" : `${num(d.backup.hoursSinceOk)} sa`, href: "#yedekler", icon: HardDrive, tone: d.backup.level === "iyi" ? "mint" : d.backup.level === "uyari" ? "amber" : "rose", caption: lvl.label },
          { key: "q", title: "Silinecek dosya", value: num(d.storage.waiting), href: "/admin/kuyruklar#storage_deletion", icon: Trash2, tone: "cyan", caption: d.storage.failed ? `${num(d.storage.failed)} kalıcı hata` : "Kuyrukta" },
          ...(d.kvkk
            ? [
                { key: "er", title: "KVKK silmesi", value: num(d.kvkk.erasures30d), href: "/admin/tickets/kvkk", icon: FileLock2, tone: "violet" as const, caption: "Son 30 gün" },
                { key: "ex", title: "Geçerli veri paketi", value: num(d.kvkk.activeExports), href: "/admin/tickets/kvkk", icon: Archive, tone: "slate" as const, caption: "90 gün sonra silinir" },
              ]
            : []),
        ]}
      />

      <OpsCard id="kurallar" icon={Database} tone="brand" title="Saklama kuralları" sub="Gece imha işinin her adımı; son çalıştırmadaki sonucuyla">
        <OpsList label="Saklama kuralları">
          {RETENTION_RULES.map((r) => {
            const st: StepStatus = last?.parsed.steps[r.step] ?? "unknown";
            return (
              <OpsRow
                key={r.step}
                primary={r.label}
                href={r.settingHref}
                secondary={`${r.period} · ${r.action}`}
                right={
                  <>
                    {r.personal ? <StatusPill tone="info">Kişisel veri</StatusPill> : null}
                    <StatusPill tone={STEP_TONE[st]}>{STEP_STATUS_LABEL[st]}</StatusPill>
                  </>
                }
              />
            );
          })}
        </OpsList>
        {last?.parsed.partial ? <p className="mt-2 text-xs text-text-muted">Son çalıştırma notu kısaltılmış; görünmeyen adımlar &quot;Bilinmiyor&quot; gösterilir.</p> : null}
      </OpsCard>

      <OpsGrid>
        <OpsCard id="calistirmalar" icon={History} tone="violet" title="Son imha çalıştırmaları" sub="Son 14 tur; tetikleyen (zamanlama / elle) ve süre">
          {d.runs.length === 0 ? (
            <EmptyState variant="compact" bare icon={History} title="Çalıştırma kaydı yok" description="Gece işi ilk kez çalıştığında burada görünür." />
          ) : (
            <OpsList label="İmha çalıştırmaları">
              {d.runs.map((r) => {
                const errs = Object.entries(r.parsed.steps).filter(([, s]) => s === "error").map(([k]) => RETENTION_RULES.find((x) => x.step === k)?.label ?? k);
                return (
                  <OpsRow
                    key={r.finishedAt}
                    primary={formatDateTimeTr(r.finishedAt)}
                    secondary={`${r.trigger === "manual" ? "Elle" : "Zamanlama"}${r.durationMs !== null ? ` · ${num(Math.round(r.durationMs / 1000))} sn` : ""}${errs.length ? ` · Hatalı: ${errs.join(", ")}` : ""}`}
                    right={<StatusPill tone={r.status === "ok" ? "success" : "danger"}>{r.status === "ok" ? "Tamam" : "Hata"}</StatusPill>}
                  />
                );
              })}
            </OpsList>
          )}
        </OpsCard>

        <OpsCard id="yedekler" icon={HardDrive} tone="mint" title="Yedekler" sub="Veritabanı + depo yedekleri; şifreli ve uzak kopya iş sürekliliği için şarttır" right={<Link href="/admin/sistem" className="kh-seeall focus-ring">Sağlık</Link>}>
          {d.backups.length === 0 ? (
            <EmptyState variant="compact" bare icon={HardDrive} title="Yedek kaydı yok" description="Sunucu yedek betiği her koşuda bir satır yazar; kayıt yoksa yedek alınmıyor olabilir." />
          ) : (
            <OpsList label="Yedek koşuları">
              {d.backups.map((b) => (
                <OpsRow
                  key={b.finishedAt}
                  primary={formatDateTimeTr(b.finishedAt)}
                  secondary={`${formatBytesTr(b.sizeBytes)} · ${b.encrypted ? "şifreli" : "şifresiz"} · ${b.remote ? "uzak kopya var" : "yalnız yerel"}`}
                  right={<StatusPill tone={b.status === "ok" ? "success" : b.status === "partial" ? "warning" : "danger"}>{b.status === "ok" ? "Tamam" : b.status === "partial" ? "Kısmi" : "Hata"}</StatusPill>}
                />
              ))}
            </OpsList>
          )}
        </OpsCard>
      </OpsGrid>
    </div>
  );
}
