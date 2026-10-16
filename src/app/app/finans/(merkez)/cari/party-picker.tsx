"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { upsertParty } from "@/app/actions/finance-ledger";
import { useToast } from "@/components/app/toast-provider";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { PARTY_KIND_LABEL, partyKindLabel, partyKindOf, type PartyKindKey } from "@/lib/finance/party/aging";

/**
 * PartyPicker — cari seçici (Hareketler, yeni kayıt sayfası ve Cari formlarında ortak).
 *
 * - Form uyumu: seçilen carinin kimliği `name` adlı alanla gönderilir (boş = cari yok).
 * - Arama: yazdıkça (≥2 harf) ofisin arşivlenmemiş carileri aranır (RLS: yalnız kendi ofisi); açılışta son 30 cari.
 * - Türe göre öneri: `kindHint` verilirse o türdeki cariler listenin başına gelir, satır içi oluşturma o türü kullanır.
 * - Satır içinde oluşturma (`allowCreate`): eşleşme yoksa "“…” adlı yeni cari" seçeneği; seçince cari sunucuda
 *   oluşturulur (`upsertParty`, `expenses:create` kapısı) ve hemen seçilir.
 * - P12: `advisorOwnerId` verilirse (kullanıcının `earnings_all` izni yok) danışman türündeki cariler yalnız o kullanıcıya
 *   bağlıysa listelenir; başka danışmanın carisi adıyla bile görünmez.
 * Supabase tarayıcı istemcisi ve ilk liste yalnız seçici ilk kez açılınca (odak/dokunma) yüklenir; ekranda duran ama hiç
 * açılmayan seçici sorgu göndermez.
 */

export type PickedParty = { id: string; name: string; kind: PartyKindKey | null };

const NEW_PREFIX = "__yeni__:";
const SEARCH_LIMIT = 20;

type Row = { id: string; name: string; kind: string | null; user_id?: string | null };

async function queryParties(q: string | null, kindHint: PartyKindKey | null, advisorOwnerId: string | null): Promise<Row[]> {
  const { createClient } = await import("@/lib/supabase/client");
  const db = createClient();
  let query = db.from("finance_parties").select("id, name, kind, user_id").is("archived_at", null);
  if (q) {
    // ilike joker karakterleri ve PostgREST ayraçları kaçırılır (kullanıcı metni desen olamaz).
    const safe = q.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()]/g, " ").slice(0, 60);
    query = query.ilike("name", `%${safe}%`).order("name", { ascending: true }).limit(SEARCH_LIMIT);
  } else {
    query = query.order("updated_at", { ascending: false }).limit(30);
  }
  const { data, error } = await query;
  if (error) return [];
  const rows = ((data ?? []) as Row[]).filter((r) => !advisorOwnerId || r.kind !== "danisman" || r.user_id === advisorOwnerId);
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
  advisorOwnerId,
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
  /** `earnings_all` yoksa kullanıcının kimliği: yalnız kendi danışman carisi listelenir (P12). Boş = kısıt yok. */
  advisorOwnerId?: string | null;
}) {
  const hint = partyKindOf(kindHint ?? null);
  const { push } = useToast();
  const [value, setValue] = useState(defaultValue ?? "");
  const [label, setLabel] = useState(defaultLabel ?? "");
  const [initial, setInitial] = useState<ComboboxOption[]>([]);
  const [creating, setCreating] = useState(false);

  const owner = advisorOwnerId ?? null;
  // Son uzak arama sonuçları: seçilen satırın etiketi buradan alınır (options yalnız ilk liste + seçili).
  const remote = useRef<Map<string, string>>(new Map());
  const loadedFor = useRef<string | null>(null);

  // İlk liste yalnız seçici ilk açıldığında (odak/dokunma) yüklenir.
  const ensureInitial = useCallback(() => {
    const key = `${hint ?? ""}|${owner ?? ""}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    void queryParties(null, hint, owner).then((rows) => {
      if (loadedFor.current === key) setInitial(rows.map(toOption));
    });
  }, [hint, owner]);

  const onSearch = useCallback(
    async (q: string): Promise<ComboboxOption[]> => {
      const rows = await queryParties(q, hint, owner);
      for (const r of rows) remote.current.set(r.id, r.name);
      const options = rows.map(toOption);
      const exact = rows.some((r) => r.name.toLocaleLowerCase("tr") === q.toLocaleLowerCase("tr"));
      if (allowCreate && !exact && q.trim().length >= 2) {
        const nm = q.trim().slice(0, 120);
        options.push({ value: `${NEW_PREFIX}${nm}`, label: `“${nm}” adlı yeni cari oluştur`, hint: hint ? PARTY_KIND_LABEL[hint] : "Tür: Diğer" });
      }
      return options;
    },
    [allowCreate, hint, owner],
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
    const name = options.find((o) => o.value === next)?.label ?? remote.current.get(next) ?? "";
    setLabel(name);
    onValueChange?.(next ? { id: next, name, kind: null } : null);
  }

  return (
    <span className="contents" onFocusCapture={ensureInitial} onPointerDownCapture={ensureInitial}>
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
    </span>
  );
}
