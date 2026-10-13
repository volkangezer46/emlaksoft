"use client";

import { useState, useTransition } from "react";
import { Flame, Tag, Trash2, UserCog, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  bulkAddTag,
  bulkAssignCustomers,
  bulkDeleteCustomers,
  bulkReheatCustomers,
  getCustomerDeleteImpact,
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
  const [panel, setPanel] = useState<"assign" | "tag" | null>(null);
  const [impact, setImpact] = useState<CustomerDeleteImpact | null>(null);
  const [advisor, setAdvisor] = useState("");
  const [tag, setTag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (selected.size === 0) return null;
  const ids = [...selected];

  const handleAssign = () => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await bulkAssignCustomers(ids, advisor);
      if (res.error) {
        setError(res.error);
        return;
      }
      setPanel(null);
      clear();
    });
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
            emptyLabel="Atamayı kaldır (danışmansız)"
          />
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPanel(null)}>Vazgeç</Button>
            <Button size="sm" loading={pending} onClick={handleAssign}>Ata</Button>
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
