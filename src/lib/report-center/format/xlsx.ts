/**
 * XLSX yazıcı (SUNUCU; sıfır bağımlılık — OOXML + `zip.ts`). İstemci paketine GİRMEZ.
 *
 * Çıktı: tek sayfa. Üstte rapor başlığı + ofis + filtre özeti + oluşturma zamanı (TR saati), ardından kalın/renkli,
 * DONDURULMUŞ başlık satırı, otomatik süzgeç, sütun genişlikleri, gerçek tarih/para/sayı hücreleri
 * (Excel biçimiyle) ve varsa toplam satırı. Metinler paylaşılan dize tablosundadır → hiçbir hücre formül olarak
 * yorumlanmaz (formül enjeksiyonu yok).
 */
import { createZip } from "./zip";
import { columnDecimals, computeTotals, displayValue, excelSerial, toNumber } from "../values";
import type { CellValue, ColumnType, ReportMeta, ReportTable } from "../types";

const esc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function colRef(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

type FontSpec = { bold?: boolean; italic?: boolean; size: number; color?: string };
type XfSpec = { font: number; fill: number; border: number; numFmt: number; halign?: "left" | "right" | "center"; wrap?: boolean };

class Styles {
  readonly fonts: FontSpec[] = [
    { size: 11 }, // 0 varsayılan
    { bold: true, size: 11, color: "FFFFFFFF" }, // 1 başlık
    { bold: true, size: 16, color: "FF1F3A5F" }, // 2 rapor başlığı
    { italic: true, size: 10, color: "FF5B6573" }, // 3 üst bilgi
    { bold: true, size: 11 }, // 4 toplam
    { bold: true, size: 10, color: "FFB45309" }, // 5 uyarı
  ];
  readonly fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  readonly borders = [
    "<border><left/><right/><top/><bottom/><diagonal/></border>",
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFD9DEE5"/></bottom><diagonal/></border>',
    '<border><left/><right/><top style="thin"><color rgb="FF1F3A5F"/></top><bottom/><diagonal/></border>',
  ];
  readonly numFmts = new Map<string, number>();
  private readonly xfs: XfSpec[] = [{ font: 0, fill: 0, border: 0, numFmt: 0 }];
  private readonly xfIndex = new Map<string, number>([[JSON.stringify({ font: 0, fill: 0, border: 0, numFmt: 0 }), 0]]);

  constructor() {
    this.fills.push('<fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill>'); // 2 başlık
    this.fills.push('<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>'); // 3 toplam
  }

  numFmt(code: string | null): number {
    if (!code) return 0;
    let id = this.numFmts.get(code);
    if (!id) {
      id = 164 + this.numFmts.size;
      this.numFmts.set(code, id);
    }
    return id;
  }

  xf(spec: XfSpec): number {
    const key = JSON.stringify(spec);
    let idx = this.xfIndex.get(key);
    if (idx === undefined) {
      idx = this.xfs.length;
      this.xfs.push(spec);
      this.xfIndex.set(key, idx);
    }
    return idx;
  }

  xml(): string {
    const fonts = this.fonts
      .map(
        (f) =>
          `<font>${f.bold ? "<b/>" : ""}${f.italic ? "<i/>" : ""}<sz val="${f.size}"/><color ${f.color ? `rgb="${f.color}"` : 'theme="1"'}/><name val="Calibri"/><family val="2"/></font>`,
      )
      .join("");
    const numFmts = [...this.numFmts.entries()].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`).join("");
    const xfs = this.xfs
      .map((x) => {
        const align =
          x.halign || x.wrap
            ? `<alignment${x.halign ? ` horizontal="${x.halign}"` : ""} vertical="center"${x.wrap ? ' wrapText="1"' : ""}/>`
            : "";
        return `<xf numFmtId="${x.numFmt}" fontId="${x.font}" fillId="${x.fill}" borderId="${x.border}" xfId="0"${x.numFmt ? ' applyNumberFormat="1"' : ""} applyFont="1" applyFill="1" applyBorder="1"${align ? ' applyAlignment="1">' + align + "</xf>" : "/>"}`;
      })
      .join("");
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (numFmts ? `<numFmts count="${this.numFmts.size}">${numFmts}</numFmts>` : "") +
      `<fonts count="${this.fonts.length}">${fonts}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join("")}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${xfs}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      "</styleSheet>"
    );
  }
}

function numberFormatCode(type: ColumnType, decimals: number): string | null {
  const dec = decimals > 0 ? `.${"0".repeat(decimals)}` : "";
  switch (type) {
    case "date":
      return "dd.mm.yyyy";
    case "datetime":
      return "dd.mm.yyyy hh:mm";
    case "money":
      return `#,##0${dec}" ₺"`;
    case "number":
      return `#,##0${dec}`;
    case "percent":
      return `0${dec}"%"`;
    default:
      return null;
  }
}

const DEFAULT_WIDTH: Record<ColumnType, number> = { text: 22, date: 12, datetime: 17, money: 16, number: 11, percent: 10, bool: 8 };
const MAX_CELL_TEXT = 32_000;

export function sheetNameFor(title: string): string {
  const cleaned = title.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
  return cleaned || "Rapor";
}

export function buildXlsx(meta: ReportMeta, table: ReportTable, createdIso: string): Buffer {
  const styles = new Styles();
  const sst: string[] = [];
  const sstIndex = new Map<string, number>();
  let sstTotal = 0;
  const str = (s: string): number => {
    sstTotal += 1;
    const text = s.length > MAX_CELL_TEXT ? s.slice(0, MAX_CELL_TEXT) : s;
    let i = sstIndex.get(text);
    if (i === undefined) {
      i = sst.length;
      sst.push(text);
      sstIndex.set(text, i);
    }
    return i;
  };

  const ncols = Math.max(1, table.columns.length);
  const lastCol = colRef(ncols - 1);

  const sTitle = styles.xf({ font: 2, fill: 0, border: 0, numFmt: 0 });
  const sMeta = styles.xf({ font: 3, fill: 0, border: 0, numFmt: 0 });
  const sWarn = styles.xf({ font: 5, fill: 0, border: 0, numFmt: 0 });
  const sHead = styles.xf({ font: 1, fill: 2, border: 0, numFmt: 0, halign: "center", wrap: true });

  const rowsXml: string[] = [];
  let r = 0;
  const textRow = (text: string, style: number, height?: number) => {
    r += 1;
    rowsXml.push(`<row r="${r}"${height ? ` ht="${height}" customHeight="1"` : ""}><c r="A${r}" s="${style}" t="s"><v>${str(text)}</v></c></row>`);
  };

  textRow(meta.title, sTitle, 26);
  textRow(`${meta.platform ? "EmlakSoft Platform" : `Ofis: ${meta.officeName}`}   |   Oluşturma: ${meta.generatedAt} (TR saati)${meta.generatedBy ? `   |   Hazırlayan: ${meta.generatedBy}` : ""}`, sMeta);
  textRow(
    meta.filterSummary.length
      ? `Filtreler: ${meta.filterSummary.map((f) => `${f.label}: ${f.value}`).join("  ·  ")}`
      : "Filtreler: yok (tüm kayıtlar)",
    sMeta,
  );
  textRow(`Satır sayısı: ${meta.rowCount}`, sMeta);
  if (meta.truncated) textRow("UYARI: Güvenlik sınırı nedeniyle kayıtların yalnızca ilk bölümü dışa aktarıldı. Tamamı için filtreyi daraltın.", sWarn);
  if (meta.personalData) textRow("Bu dosya kişisel veri içerir (KVKK). Yetkisiz kişilerle paylaşmayın; indirmeniz denetim kaydına yazılmıştır.", sWarn);
  r += 1; // boş satır
  const headerRow = r + 1;

  // Sütun stilleri + genişlik tahmini
  const colStyles = table.columns.map((c) => {
    const dec = columnDecimals(c);
    return styles.xf({
      font: 0,
      fill: 0,
      border: 1,
      numFmt: styles.numFmt(numberFormatCode(c.type, dec)),
      halign: c.type === "text" ? "left" : c.type === "bool" ? "center" : undefined,
    });
  });
  const widths = table.columns.map((c, i) => {
    let w = c.width ?? DEFAULT_WIDTH[c.type];
    w = Math.max(w, Math.min(40, c.label.length + 4));
    if (!c.width) {
      let sample = 0;
      for (const row of table.rows.slice(0, 300)) sample = Math.max(sample, displayValue(row[i], c).length);
      w = Math.max(w, Math.min(60, sample + 2));
    }
    return Math.min(70, Math.max(8, w));
  });

  // Başlık satırı
  r += 1;
  rowsXml.push(
    `<row r="${r}" ht="30" customHeight="1">${table.columns
      .map((c, i) => `<c r="${colRef(i)}${r}" s="${sHead}" t="s"><v>${str(c.label)}</v></c>`)
      .join("")}</row>`,
  );

  // Veri satırları
  for (const row of table.rows) {
    r += 1;
    const cells: string[] = [];
    for (let i = 0; i < table.columns.length; i += 1) {
      const c = table.columns[i]!;
      const v: CellValue = row[i];
      if (v === null || v === undefined || v === "") continue;
      const ref = `${colRef(i)}${r}`;
      const s = colStyles[i]!;
      if (c.type === "date" || c.type === "datetime") {
        const serial = excelSerial(v, c.type === "datetime");
        if (serial !== null) cells.push(`<c r="${ref}" s="${s}"><v>${serial}</v></c>`);
        else cells.push(`<c r="${ref}" s="${s}" t="s"><v>${str(String(v))}</v></c>`);
      } else if (c.type === "money" || c.type === "number" || c.type === "percent") {
        const n = toNumber(v);
        if (n !== null) cells.push(`<c r="${ref}" s="${s}"><v>${n}</v></c>`);
        else cells.push(`<c r="${ref}" s="${s}" t="s"><v>${str(String(v))}</v></c>`);
      } else if (c.type === "bool") {
        cells.push(`<c r="${ref}" s="${s}" t="s"><v>${str(displayValue(v, c))}</v></c>`);
      } else {
        cells.push(`<c r="${ref}" s="${s}" t="s"><v>${str(String(v))}</v></c>`);
      }
    }
    rowsXml.push(`<row r="${r}">${cells.join("")}</row>`);
  }
  const lastDataRow = Math.max(headerRow, r);

  // Toplam satırı
  const totals = computeTotals(table.columns, table.rows);
  if (totals.some((t) => t !== null)) {
    r += 1;
    const cells: string[] = [];
    table.columns.forEach((c, i) => {
      const code = numberFormatCode(c.type, columnDecimals(c));
      const style = styles.xf({ font: 4, fill: 3, border: 2, numFmt: styles.numFmt(code) });
      const ref = `${colRef(i)}${r}`;
      const t = totals[i];
      if (t !== null && t !== undefined) cells.push(`<c r="${ref}" s="${style}"><v>${t}</v></c>`);
      else if (i === 0) cells.push(`<c r="${ref}" s="${style}" t="s"><v>${str("TOPLAM")}</v></c>`);
      else cells.push(`<c r="${ref}" s="${style}"/>`);
    });
    rowsXml.push(`<row r="${r}">${cells.join("")}</row>`);
  }

  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const sheetName = sheetNameFor(meta.title);
  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    `<dimension ref="A1:${lastCol}${Math.max(r, 1)}"/>` +
    `<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/></sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${rowsXml.join("")}</sheetData>` +
    `<autoFilter ref="A${headerRow}:${lastCol}${lastDataRow}"/>` +
    '<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
    '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
    '<headerFooter><oddFooter>&amp;L&amp;8EmlakSoft&amp;R&amp;8Sayfa &amp;P / &amp;N</oddFooter></headerFooter>' +
    "</worksheet>";

  const quoted = `'${sheetName.replace(/'/g, "''")}'`;
  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000"/></bookViews>` +
    `<sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
    `<definedNames>` +
    `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${esc(quoted)}!$A$${headerRow}:$${lastCol}$${lastDataRow}</definedName>` +
    `<definedName name="_xlnm.Print_Titles" localSheetId="0">${esc(quoted)}!$${headerRow}:$${headerRow}</definedName>` +
    `</definedNames>` +
    "</workbook>";

  const sstXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sstTotal}" uniqueCount="${sst.length}">` +
    sst.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("") +
    "</sst>";

  const enc = (s: string) => new TextEncoder().encode(s);
  return createZip([
    {
      name: "[Content_Types].xml",
      data: enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
          '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
          '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
          "</Types>",
      ),
    },
    {
      name: "_rels/.rels",
      data: enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
          "</Relationships>",
      ),
    },
    {
      name: "docProps/core.xml",
      data: enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
          `<dc:title>${esc(meta.title)}</dc:title><dc:creator>EmlakSoft</dc:creator>` +
          `<dcterms:created xsi:type="dcterms:W3CDTF">${createdIso}</dcterms:created>` +
          "</cp:coreProperties>",
      ),
    },
    {
      name: "docProps/app.xml",
      data: enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>EmlakSoft</Application></Properties>',
      ),
    },
    { name: "xl/workbook.xml", data: enc(workbookXml) },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
          "</Relationships>",
      ),
    },
    { name: "xl/styles.xml", data: enc(styles.xml()) },
    { name: "xl/sharedStrings.xml", data: enc(sstXml) },
    { name: "xl/worksheets/sheet1.xml", data: enc(sheetXml) },
  ]);
}
