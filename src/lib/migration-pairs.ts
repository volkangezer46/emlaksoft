/**
 * Migration cift/grup denetimi: SAF fonksiyonlar (dosya sistemine dokunmaz, DB'ye baglanmaz).
 *
 * Neden var: `check:migrations` tek tek dosyanin butunlugunu (ad, checksum, ledger) dogrular; ama
 * "bu dosya su dosyayla AYNI pencerede uygulanmali" ya da "proposed taslagi ile ayni numarayi tasiyor"
 * bilgisini bilmez. Bu modul onu sahibin yayin penceresi icin denetler. `check:migrations` sozlesmesine
 * ENTEGRE DEGILDIR; ayri komut: `npm run check:migration-pairs` (CLI: scripts/check-migration-pairs.ts).
 *
 * Veri (gruplar, pencereler, etki sinifi): `scripts/migration-pairs-data.ts`.
 */

export type ImpactClass = "ek" | "davranis" | "siki";

export const IMPACT_LABELS: Record<ImpactClass, string> = {
  ek: "yalniz ekler (mevcut davranis degismez)",
  davranis: "davranis degistirir",
  siki: "RLS/kisit sikilasir",
};

export interface MigrationWindow {
  id: string;
  order: number;
  title: string;
  /** Uygulama sirasi (--only ile dosya dosya). Pencere icinde surum artan olmalidir. */
  files: readonly string[];
  /** Ayri pencere: yalniz bu dosyalar, baska hicbir pencerenin dosyasi ayni gunde uygulanmaz. */
  separate?: boolean;
}

export interface PairGroup {
  id: string;
  title: string;
  /** Ana migration(lar) */
  main: readonly string[];
  /** Duzeltici migration(lar): ana'dan SONRA numaralanmis ve AYNI pencerede olmali. */
  fixes: readonly string[];
  window: string;
  note?: string;
}

/** [bagimli, onkosul]: onkosul once numaralanir ve pencere sirasi bagimliyi geride birakmaz. */
export type RequiresEdge = readonly [dependent: string, prerequisite: string];

export interface ExternalPending {
  file: string;
  branch: string;
  rule: "migration-once";
  note: string;
}

export interface GroupSpec {
  appliedHead: string;
  impact: Readonly<Record<string, ImpactClass>>;
  windows: readonly MigrationWindow[];
  pairGroups: readonly PairGroup[];
  requires: readonly RequiresEdge[];
  externalPending: readonly ExternalPending[];
}

export type Level = "error" | "warn" | "info";

export interface Finding {
  level: Level;
  code: string;
  message: string;
}

/** Dosya adindan surum: `20260819020100` ya da `20260726000087b`; uymazsa null (ornek: 20260814_perf_indexes). */
export function versionOf(file: string): string | null {
  const m = /^(\d{14}[a-z]?)_/.exec(file);
  return m ? m[1] : null;
}

/** `x.rollback.sql` ve `x.sql` ayni taban ada indirgenir. */
export function baseName(file: string): string {
  return file.replace(/\.rollback\.sql$/, "").replace(/\.sql$/, "");
}

function groupBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function distinctBases(files: readonly string[]): string[] {
  return [...new Set(files.map(baseName))].sort();
}

// ---------------------------------------------------------------------------
// (a) Surum numarasi cakismalari
// ---------------------------------------------------------------------------

export interface CollisionOptions {
  /** `validate-migrations.ts` icindeki donmus tarihsel cakismalar (uygulanmis ledger'lar). */
  legacyMigrationVersions?: readonly string[];
}

/**
 * - migrations icinde ayni surum, farkli ad: HATA (donmus tarihsel istisnalar haric).
 * - proposed icinde ayni surum, farkli ad: HATA.
 * - proposed ile migrations ayni surum, farkli ad: HATA (terfide yeni numara kurali).
 * - proposed ile migrations ayni ad: HATA (terfi edilmis; proposed'dan kaldirilmali).
 * - proposed surumu migrations'taki en buyuk surumden kucuk/esit: BILGI (terfide yeni numara sart).
 * - 14 haneli surum desenine uymayan ad: UYARI.
 */
export function findVersionCollisions(
  migrationFiles: readonly string[],
  proposedFiles: readonly string[],
  options: CollisionOptions = {},
): Finding[] {
  const findings: Finding[] = [];
  const legacy = new Set(options.legacyMigrationVersions ?? []);
  const sql = (files: readonly string[]) => files.filter((f) => f.endsWith(".sql"));
  const migrations = sql(migrationFiles).filter((f) => !f.endsWith(".rollback.sql"));
  const proposed = sql(proposedFiles);

  const migByVersion = groupBy(migrations, versionOf);
  const propByVersion = groupBy(proposed, versionOf);

  for (const [version, files] of migByVersion) {
    const bases = distinctBases(files);
    if (bases.length > 1 && !legacy.has(version)) {
      findings.push({
        level: "error",
        code: "migrations-ic-cakisma",
        message: `migrations/ icinde ${version} surumunu ${bases.length} dosya kullaniyor: ${bases.join(", ")}`,
      });
    }
  }

  for (const [version, files] of propByVersion) {
    const bases = distinctBases(files);
    if (bases.length > 1) {
      findings.push({
        level: "error",
        code: "proposed-ic-cakisma",
        message: `proposed/ icinde ${version} surumunu ${bases.length} taslak kullaniyor: ${bases.join(", ")}`,
      });
    }
  }

  for (const [version, pFiles] of propByVersion) {
    const mFiles = migByVersion.get(version);
    if (!mFiles) continue;
    const mBases = new Set(distinctBases(mFiles));
    for (const base of distinctBases(pFiles)) {
      if (mBases.has(base)) {
        findings.push({
          level: "error",
          code: "terfi-edilmis-kopya",
          message: `proposed/${base} migrations/ icine terfi edilmis gorunuyor (ayni ad); taslak kopyasini proposed/'dan kaldirin.`,
        });
      } else {
        findings.push({
          level: "error",
          code: "proposed-numara-cakismasi",
          message:
            `proposed/${base} taslagi ${version} surumunu migrations/${[...mBases].join(", ")} ile paylasiyor. ` +
            "Taslak terfi edilirken YENI numara almalidir (yeniden numaralama sahibe/ayri goreve aittir).",
        });
      }
    }
  }

  const migVersions = [...migByVersion.keys()].sort();
  const maxMig = migVersions[migVersions.length - 1];
  for (const base of distinctBases(proposed)) {
    const v = versionOf(base + ".sql");
    if (v === null) {
      findings.push({
        level: "warn",
        code: "uyumsuz-ad",
        message: `proposed/${base}: ad 14 haneli surum desenine (^\\d{14}[a-z]?_) uymuyor; terfide yeniden adlandirilmali.`,
      });
      continue;
    }
    if (maxMig && v <= maxMig) {
      findings.push({
        level: "info",
        code: "terfide-yeni-numara",
        message: `proposed/${base} (${v}) migrations/'taki en buyuk surumun (${maxMig}) gerisinde; terfide numara > ${maxMig} olmali.`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// (b) Birlikte uygulanmasi gereken gruplar + pencere/bagimlilik sirasi
// ---------------------------------------------------------------------------

export function validateGroups(migrationFiles: readonly string[], spec: GroupSpec): Finding[] {
  const findings: Finding[] = [];
  const err = (code: string, message: string) => findings.push({ level: "error", code, message });
  const warn = (code: string, message: string) => findings.push({ level: "warn", code, message });

  const existing = new Set(
    migrationFiles.filter((f) => f.endsWith(".sql") && !f.endsWith(".rollback.sql")),
  );
  const external = new Map(spec.externalPending.map((e) => [e.file, e]));
  const verOf = (file: string) => versionOf(file) ?? "";
  const isUnapplied = (file: string) => verOf(file) > spec.appliedHead;
  const windowOf = new Map<string, MigrationWindow>();

  // Pencereler: benzersiz id/order, dosya varligi, tekrar, artan surum.
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const w of spec.windows) {
    if (ids.has(w.id)) err("pencere-tekrar", `pencere id tekrar ediyor: ${w.id}`);
    ids.add(w.id);
    if (orders.has(w.order)) err("pencere-sira-tekrar", `iki pencere ayni sirayi tasiyor: ${w.order}`);
    orders.add(w.order);
    let prev = "";
    for (const f of w.files) {
      if (!existing.has(f)) {
        if (external.has(f)) {
          warn("dal-bekliyor", `${w.id}: ${f} henuz migrations/ icinde degil (dal: ${external.get(f)?.branch}).`);
        } else {
          err("pencere-dosya-yok", `${w.id}: ${f} migrations/ icinde yok (yeniden adlandirilmis/silinmis olabilir).`);
        }
      }
      const prior = windowOf.get(f);
      if (prior) err("dosya-iki-pencerede", `${f} hem ${prior.id} hem ${w.id} penceresinde.`);
      else windowOf.set(f, w);
      const v = verOf(f);
      if (prev && v < prev) {
        err("pencere-ici-sira", `${w.id}: ${f} onceki dosyadan kucuk surumde; pencere ici sira artan olmali.`);
      }
      prev = v;
    }
  }

  // Etki sinifi: her uygulanmamis dosyanin etiketi var; etiket gecerli dosyaya ait.
  const unapplied = [...existing].filter(isUnapplied).sort();
  for (const f of unapplied) {
    if (!spec.impact[f]) err("etki-sinifi-yok", `${f}: etki sinifi etiketi yok (scripts/migration-pairs-data.ts IMPACT).`);
    if (!windowOf.has(f)) err("pencere-yok", `${f}: hicbir yayin penceresinde degil (scripts/migration-pairs-data.ts WINDOWS).`);
  }
  for (const f of Object.keys(spec.impact)) {
    if (!existing.has(f) && !external.has(f)) err("etki-sinifi-hayalet", `${f}: etiketli ama migrations/ icinde yok.`);
  }

  // Ayri pencere: yalniz kendi dosyalari.
  for (const w of spec.windows.filter((x) => x.separate)) {
    const others = spec.windows.filter((x) => x.id !== w.id && x.files.some((f) => w.files.includes(f)));
    for (const o of others) err("ayri-pencere-ihlali", `${w.id} AYRI pencere ama ${o.id} ile ortak dosya var.`);
  }

  // Birlikte uygulanacak cift/gruplar.
  for (const g of spec.pairGroups) {
    const members = [...g.main, ...g.fixes];
    const w = spec.windows.find((x) => x.id === g.window);
    if (!w) {
      err("grup-pencere-yok", `${g.id}: pencere bulunamadi (${g.window}).`);
      continue;
    }
    for (const f of members) {
      if (!existing.has(f)) {
        if (external.has(f)) warn("dal-bekliyor", `${g.id}: ${f} henuz migrations/ icinde degil.`);
        else err("grup-uye-yok", `${g.id}: uye migrations/ icinde yok: ${f}`);
      }
      if (!w.files.includes(f)) {
        err("grup-ayri-pencere", `${g.id}: ${f} grup penceresinde (${w.id}) degil; grup uyeleri AYNI pencerede uygulanmali.`);
      }
    }
    const mainMax = g.main.map(verOf).sort().pop() ?? "";
    for (const f of g.fixes) {
      if (verOf(f) <= mainMax) {
        err(
          "duzeltici-ana-oncesi",
          `${g.id}: duzeltici ${f} ana migration'dan ONCE/AYNI numaralanmis (ana en buyuk surum ${mainMax}); duzeltici sonra gelmeli.`,
        );
      }
    }
  }

  // Bagimlilik kenarlari.
  for (const [dep, pre] of spec.requires) {
    if (!existing.has(dep) && !external.has(dep)) {
      err("bagimlilik-uye-yok", `bagimli dosya yok: ${dep}`);
      continue;
    }
    if (!existing.has(pre) && !external.has(pre)) {
      err("bagimlilik-onkosul-yok", `${dep} onkosulu yok: ${pre}`);
      continue;
    }
    if (verOf(pre) >= verOf(dep)) {
      err("bagimlilik-numara", `${dep} onkosulu ${pre} ondan ONCE numaralanmamis.`);
    }
    if (!isUnapplied(pre)) continue; // onkosul zaten canlida
    const wp = windowOf.get(pre);
    const wd = windowOf.get(dep);
    if (!wp || !wd) continue; // eksik pencere zaten ayri hata
    if (wp.order > wd.order) {
      err("bagimlilik-pencere-sirasi", `${dep} (${wd.id}) penceresi onkosul ${pre} (${wp.id}) penceresinden once uygulanir.`);
    } else if (wp.id === wd.id && wp.files.indexOf(pre) > wp.files.indexOf(dep)) {
      err("bagimlilik-pencere-ici", `${wd.id}: ${pre} ${dep}'den sonra siralanmis.`);
    }
  }

  // Dis dalda bekleyenler (ornek K4 is_document): kural bilgi olarak raporlanir.
  for (const e of spec.externalPending) {
    const present = existing.has(e.file);
    findings.push({
      level: "info",
      code: "dis-bekleyen",
      message: `${e.file} (${e.branch}) ${present ? "migrations/ icinde" : "dalda, main'de YOK"}: ${e.note}`,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// (c) Etki sinifi ozeti + rollback kapsami
// ---------------------------------------------------------------------------

export interface ImpactRow {
  file: string;
  impact: ImpactClass | null;
  window: string | null;
  hasRollback: boolean;
}

export function impactTable(
  migrationFiles: readonly string[],
  rollbackFiles: readonly string[],
  spec: GroupSpec,
): ImpactRow[] {
  const rollbacks = new Set(rollbackFiles.map(baseName));
  const windowOf = new Map<string, string>();
  for (const w of spec.windows) for (const f of w.files) windowOf.set(f, w.id);
  return migrationFiles
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".rollback.sql"))
    .filter((f) => (versionOf(f) ?? "") > spec.appliedHead)
    .sort()
    .map((file) => ({
      file,
      impact: spec.impact[file] ?? null,
      window: windowOf.get(file) ?? null,
      hasRollback: rollbacks.has(baseName(file)),
    }));
}

export function summarizeFindings(findings: readonly Finding[]): Record<Level, number> {
  return {
    error: findings.filter((f) => f.level === "error").length,
    warn: findings.filter((f) => f.level === "warn").length,
    info: findings.filter((f) => f.level === "info").length,
  };
}
