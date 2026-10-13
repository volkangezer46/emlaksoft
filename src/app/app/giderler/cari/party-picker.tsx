"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { upsertParty } from "@/app/actions/finance-ledger";
import { useToast } from "@/components/app/toast-provider";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { PARTY_KIND_LABEL, partyKindLabel, partyKindOf, type PartyKindKey } from "@/lib/finance/party/aging";

/**
 * PartyPicker — cari seçici (Hareketler, yeni kayıt penceresi ve Cari formlarında ortak).
 *
 * - Form uyumu: seçilen carinin kimliği `name` adlı alanla gönderilir (boş = cari yok).
 * - Arama: yazdıkça (≥2 harf) ofisin arşivlenmemiş carileri aranır (RLS: yalnız kendi ofisi); açılışta son 30 cari.
 * - Türe göre öneri: `kindHint` verilirse o türdeki cariler listenin başına gelir, satır içi oluşturma o türü kullanır.
 * - Satır içinde oluşturma (`allowCreate`): eşleşme yoksa "“…” adlı yeni cari" seçeneği; seçince cari sunucuda
 *   oluşturulur (`upsertParty`, `expenses:create` kapısı) ve hemen seçilir.
 * Supabase tarayıcı istemcisi yalnız ilk aramada dinamik yüklenir (ilk yük JS'ine girmez).
 */

export type PickedParty = { id: string; name: string; kind: PartyKindKey | null };

const NEW_PREFIX = "__yeni__:";
const SEARCH_LIMIT = 20;

type Row = { id: string; name: string; kind: string | null };

async function queryParties(q: string | null, kindHint: PartyKindKey | null): Promise<Row[]> {
  const { createClient } = await import("@/lib/supabase/client");
  const db = createClient();
  let query = db.from("finance_parties").select("id, name, kind").is("archived_at", null);
  if (q) {
    // ilike joker karakterleri ve PostgREST ayraçları kaçırılır (kullanıcı metni desen olamaz).
    const safe = q.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()]/g, " ").slice(0, 60);
    query = query.ilike("name", `%${safe}%`).order("name", { ascending: true }).limit(SEARCH_LIMIT);
  } else {
    query = query.order("updated_at", { ascending: false }).limit(30);
  }
  const { data, error } = await query;
  if (error) return [];
  const rows = (data ?? []) as Row[];
  if (!kindHint) return rows;
  return [...rows.filter((r) => r.kind === kindHint), ...rows.filter((r) => r.kind !== kindHint)];
}

function toOption(r: Row): ComboboxOption {
  return { value: r.id, label: r.name, hint: partyKindLabel(r.kind) };
}

export function PartyPicker({
  name,
  defaultValue,
  defaultLabel,
  kindHint,
  allowCreate,
  onValueChange,
  id,
  placeholder = "Cari seçin",
  "aria-label": ariaLabel,
  disabled,
}: {
  name: string;
  defaultValue?: string | null;
  /** Varsayılan carinin adı (sayfa zaten biliyorsa; açılışta ek arama yapılmaz). */
  defaultLabel?: string | null;
  kindHint?: PartyKindKey | string | null;
  allowCreate: boolean;
  onValueChange?: (party: PickedParty | null) => void;
  id?: string;
  placeholder?: string;
  "aria-label"?: string;
  disabled?: boolean;
}) {
  const hint = partyKindOf(kindHint ?? null);
  const { push } = useToast();
  const [value, setValue] = useState(defaultValue ?? "");
  const [label, setLabel] = useState(defaultLabel ?? "");
  const [initial, setInitial] = useState<ComboboxOption[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    queryParties(null, hint).then((rows) => {
      if (alive) setInitial(rows.map(toOption));
    });
    return () => {
      alive = false;
    };
  }, [hint]);

  const onSearch = useCallback(
    async (q: string): Promise<ComboboxOption[]> => {
      const rows = await queryParties(q, hint);
      const options = rows.map(toOption);
      const exact = rows.some((r) => r.name.toLocaleLowerCase("tr") === q.toLocaleLowerCase("tr"));
      if (allowCreate && !exact && q.trim().length >= 2) {
        const nm = q.trim().slice(0, 120);
        options.push({ value: `${NEW_PREFIX}${nm}`, label: `“${nm}” adlı yeni cari oluştur`, hint: hint ? PARTY_KIND_LABEL[hint] : "Tür: Diğer" });
      }
      return options;
    },
    [allowCreate, hint],
  );

  const options = useMemo(() => {
    if (!value || initial.some((o) => o.value === value) || !label) return initial;
    return [{ value, label }, ...initial];
  }, [initial, value, label]);

  async function change(next: string) {
    if (next.startsWith(NEW_PREFIX)) {
      const partyName = next.slice(NEW_PREFIX.length);
      setCreating(true);
      const res = await upsertParty({ name: partyName, kind: hint ?? "diger" });
      setCreating(false);
      if (!res.ok || !res.id) {
        push(res.ok ? "Cari oluşturulamadı." : res.error, "err");
        return;
      }
      const party: PickedParty = { id: res.id, name: partyName, kind: hint ?? "diger" };
      setInitial((prev) => [toOption({ id: party.id, name: party.name, kind: party.kind }), ...prev]);
      setValue(party.id);
      setLabel(party.name);
      push(`“${partyName}” carisi oluşturuldu`, "ok");
      onValueChange?.(party);
      return;
    }
    setValue(next);
    const opt = options.find((o) => o.value === next);
    setLabel(opt?.label ?? "");
    onValueChange?.(next ? { id: next, name: opt?.label ?? "", kind: null } : null);
  }

  return (
    <Combobox
      id={id}
      name={name}
      options={options}
      value={value}
      onValueChange={change}
      onSearch={onSearch}
      selectedLabel={label || undefined}
      placeholder={placeholder}
      searchPlaceholder={allowCreate ? "Ara ya da yeni cari adı yazın…" : "Cari ara…"}
      emptyText={allowCreate ? "Eşleşme yok. Yeni cari için adı yazmaya devam edin." : "Eşleşen cari yok"}
      loading={creating}
      disabled={disabled}
      aria-label={ariaLabel ?? "Cari"}
    />
  );
}
