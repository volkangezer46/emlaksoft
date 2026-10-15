"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Flame, Tag, Trash2, UserCog, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import type { AssignableAdvisor } from "@/lib/team/assignable-roles";
import {
  bulkAddTag,
  bulkAssignCustomers,
  bulkDeleteCustomers,
  bulkReheatCustomers,
  getCustomerDeleteImpact,
  restoreCustomerAssignments,
  type CustomerDeleteImpact,
} from "@/app/actions/customers";
import { describeDeleteImpact } from "./delete-impact";
import { PersonSelect } from "@/components/ui/person-select";
import { useCustomerSelection, type CustomerBulkBarProps } from "./customer-bulk-actions";

/**
 * Seçim varken beliren toplu işlem çubuğunun GÖVDESİ: danışman ata + etiket ekle + yeniden ısıt + sil.
 * Onay diyaloğu (Radix Dialog), kişi seçici ve toplu işlem eylemleri liste sayfasının ilk yük paketine girmesin diye
 * ayrı parçadır; `customer-bulk-actions.tsx` boşta önceden indirir, ilk seçimde bağlar ve bir kez bağlandıktan sonra
 * bağlı tutar (panel/onay durumu eskisi gibi seçim temizlense de korunur).
 */
export function CustomerBulkBarBody({
  advisors,
  tagSuggestions,
  canEdit,
  canDelete,
}: CustomerBulkBarProps) {
  const { selected, clear } = useCustomerSelection();
  const router = useRouter();
  const { push } = useToast();
  const [panel, setPanel] = useState<"assign" | "tag" | null>(null);
  const [impact, setImpact] = useState<CustomerDeleteImpact | null>(null);
  const [advisor, setAdvisor] = useState("");
  const [tag, setTag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (selected.size === 0) return null;
  const ids = [...selected];

  /**
   * Toplu atama (B069): seçim boş gelir; "Ata" seçimsizken pasiftir. "Atamayı kaldır" ayrı ve onaylı bir eylemdir
   * (`UNASSIGN`). Başarıda "N müşteri X'e atandı · Geri al" bildirimi: Geri al, işlem öncesi atamaları geri yükler.
   */
  const runAssign = (target: string) => {
    setError(null);
    setInfo(null);
    const count = ids.length;
    const targetName = target ? (advisors.find((a) => a.id === target)?.full_name ?? "seçilen danışman") : null;
    startTransition(async () => {
      const res = await bulkAssignCustomers(ids, target);
      if (res.error) {
        setError(res.error);
        return;
      }
      const previous = res.previous ?? [];
      push(
        targetName ? `${count} müşteri ${targetName} danışmanına atandı` : `${count} müşteri danışmansız bırakıldı`,
        "ok",
        previous.length > 0
          ? {
              action: {
                label: "Geri al",
                onClick: () => {
                  void restoreCustomerAssignments(previous).then((r) => {
                    if (r.error) push(r.error, "err");
                    else {
                      const skipped = r.skippedCount ?? 0;
                      push(
                        skipped > 0
                          ? `${r.updatedCount ?? 0} müşterinin önceki ataması geri yüklendi; ${skipped} müşterinin önceki danışmanı artık aktif satış rolünde olmadığı için atama değişmedi`
                          : `${r.updatedCount ?? previous.length} müşterinin önceki ataması geri yüklendi`,
                        "ok",
                      );
                      router.refresh();
                    }
                  });
                },
              },
            }
          : undefined,
      );
      setPanel(null);
      setAdvisor("");
      clear();
      router.refresh();
    });
  };
  const handleAssign = () => {
    if (!advisor) return;
    runAssign(advisor);
  };

  const handleAddTag = () => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await bulkAddTag(ids, tag);
      if (res.error) {
        setError(res.error);
        return;
      }
      setPanel(null);
      setTag("");
      clear();
    });
  };

  const handleDelete = async () => {
    setError(null);
    setInfo(null);
    const res = await bulkDeleteCustomers(ids);
    if (res.error) setError(res.error);
    else clear();
  };

  /** Uykuda müşteri aksiyonu: seçililere "Ara: … — uzun süredir temassız" görevi açar. */
  const handleReheat = async () => {
    setError(null);
    setInfo(null);
    const res = await bulkReheatCustomers(ids);
    if (res.error) {
      setError(res.error);
    } else {
      // clear() ÇAĞRILMAZ: seçim sıfırlanınca bar unmount olur ve bilgi
      // mesajı hiç görünmezdi. Kullanıcı X ile veya yeni işlemle temizler.
      setInfo(`${res.updatedCount ?? 0} müşteri için arama görevi oluşturuldu.`);
    }
  };

  return (
    <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-brand-300/40 bg-brand-600/[0.04] px-4 py-2.5">
      <span className="text-sm font-semibold text-brand-700">
        {selected.size} müşteri seçildi
      </span>

      {canEdit && advisors.length > 0 ? (
        <Button
          size="sm"
          aria-expanded={panel === "assign"}
          onClick={() => {
            setError(null);
            // Panel her açılışta BOŞ gelir (önceki seçim taşınmaz).
            setAdvisor("");
            setPanel(panel === "assign" ? null : "assign");
          }}
        >
          <UserCog className="h-3.5 w-3.5" /> Danışman ata
        </Button>
      ) : null}

      {canEdit ? (
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={panel === "tag"}
          onClick={() => {
            setError(null);
            setPanel(panel === "tag" ? null : "tag");
          }}
        >
          <Tag className="h-3.5 w-3.5" /> Etiket ekle
        </Button>
      ) : null}

      {canEdit ? (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="secondary">
              <Flame className="h-3.5 w-3.5 text-amber-500" /> Yeniden ısıt
            </Button>
          }
          title={`${ids.length} müşteri yeniden ısıtılsın mı?`}
          description="Her seçili müşteri için danışmanına yüksek öncelikli 'Ara: uzun süredir temassız' görevi oluşturulur (2 gün vadeli). Zaten açık ısıtma görevi olan müşteriler atlanır."
          confirmLabel="Görev oluştur"
          onConfirm={handleReheat}
        />
      ) : null}

      {canDelete ? (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="danger" onClick={() => void getCustomerDeleteImpact(ids).then(setImpact)}>
              <Trash2 className="h-3.5 w-3.5" /> Sil
            </Button>
          }
          title={`${ids.length} müşteri silinsin mi?`}
          description={
            describeDeleteImpact(impact).length > 0
              ? `Seçili müşterilere bağlı: ${describeDeleteImpact(impact).join(", ")}. Müşteriler listeden kaldırılır (çöp kutusundan geri alınabilir); bağlı kayıtlar silinmez, geçmiş korunur.`
              : "Seçili müşteriler listeden kaldırılır (çöp kutusundan geri alınabilir). Bağlı talep ve görüşme geçmişi korunur."
          }
          confirmLabel="Sil"
          onConfirm={handleDelete}
        />
      ) : null}

      {error ? (
        <span className="text-xs font-semibold text-danger-500" role="alert">
          {error}
        </span>
      ) : null}
      {info ? (
        <span className="text-xs font-semibold text-mint-600" role="status">
          {info}
        </span>
      ) : null}

      <button
        type="button"
        onClick={() => {
          clear();
          setError(null);
          setInfo(null);
        }}
        className="ml-auto grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] text-text-muted transition hover:bg-line touch:min-h-11 touch:min-w-11"
        aria-label="Seçimi temizle"
      >
        <X className="h-4 w-4" />
      </button>
    </div>

      {panel === "assign" ? (
        <section aria-label="Danışman ata" className="rounded-[var(--radius-card)] border border-brand-300 bg-surface p-4">
          <p className="text-sm font-semibold text-ink-950">Danışman ata</p>
          <p className="mt-0.5 text-xs text-text-muted">{ids.length} müşteri seçili — hepsi aynı danışmana atanır.</p>
          <label htmlFor="bulk-assign-advisor" className="mb-1.5 mt-3 block text-xs font-semibold text-text-muted">
            Danışman
          </label>
          <PersonSelect
            id="bulk-assign-advisor"
            className="max-w-sm"
            value={advisor}
            onValueChange={setAdvisor}
            people={advisors.map((a) => ({ id: a.id, name: a.full_name }))}
            featuredIds={advisors.filter((a) => (a as AssignableAdvisor).featured).map((a) => a.id)}
            emptyLabel="Danışman seçin"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPanel(null)}>Vazgeç</Button>
            <Button size="sm" loading={pending} disabled={!advisor} onClick={handleAssign}>Ata</Button>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="secondary" disabled={pending}>
                  Atamayı kaldır
                </Button>
              }
              title={`${ids.length} müşteri danışmansız kalsın mı?`}
              description={`Seçili ${ids.length} müşterinin danışman ataması kaldırılır. İşlemden sonra "Geri al" ile önceki danışmanlara döndürebilirsiniz.`}
              confirmLabel="Atamayı kaldır"
              onConfirm={() => runAssign("")}
            />
          </div>
        </section>
      ) : null}

      {panel === "tag" ? (
        <section aria-label="Etiket ekle" className="rounded-[var(--radius-card)] border border-brand-300 bg-surface p-4">
          <p className="text-sm font-semibold text-ink-950">Etiket ekle</p>
          <p className="mt-0.5 text-xs text-text-muted">{ids.length} müşteri seçili — etiket hepsine eklenir, zaten ekli olanlara mükerrer yazılmaz.</p>
          <label htmlFor="bulk-tag-input" className="mb-1.5 mt-3 block text-xs font-semibold text-text-muted">
            Etiket
          </label>
          <input
            id="bulk-tag-input"
            list="bulk-tag-options"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tag.trim() && !pending) {
                e.preventDefault();
                handleAddTag();
              }
            }}
            maxLength={30}
            placeholder="Örn: VIP, Yatırımcı, Takipte…"
            className="w-full max-w-sm rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          />
          <datalist id="bulk-tag-options">
            {tagSuggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPanel(null)}>Vazgeç</Button>
            <Button size="sm" loading={pending} disabled={!tag.trim()} onClick={handleAddTag}>Ekle</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
