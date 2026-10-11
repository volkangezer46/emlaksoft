/**
 * OFX/QFX ayrıştırıcısı (SAF). Hem SGML (kapanış etiketsiz, OFX 1.x) hem XML (2.x) biçimini okur:
 * her `<STMTTRN>` bloğundan DTPOSTED, TRNAMT, NAME/MEMO ve FITID alınır. İmzalı tutar: eksi = çıkış.
 */
import { cleanDescription, MAX_STATEMENT_ROWS, parseStatementDate, parseStatementNumber, type MappedStatement, type StatementLine } from "./parse";

export function looksLikeOfx(text: string): boolean {
  return /<OFX[\s>]/i.test(text) || /^\s*OFXHEADER:/i.test(text) || /<STMTTRN>/i.test(text);
}

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}>\\s*([^<\\r\\n]*)`, "i").exec(block);
  return m ? m[1]!.trim() : "";
}

export function parseOfx(text: string): MappedStatement {
  const lines: StatementLine[] = [];
  let invalid = 0;
  let truncated = false;
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const block of blocks) {
    const body = block.split(/<\/STMTTRN>/i)[0] ?? block;
    const date = parseStatementDate(tag(body, "DTPOSTED"));
    const signed = parseStatementNumber(tag(body, "TRNAMT"));
    if (!date || signed === null) {
      invalid += 1;
      continue;
    }
    if (signed === 0) continue;
    if (lines.length >= MAX_STATEMENT_ROWS) {
      truncated = true;
      break;
    }
    const name = tag(body, "NAME");
    const memo = tag(body, "MEMO");
    const description = cleanDescription([name, memo && memo !== name ? memo : ""].filter(Boolean).join(" - "));
    const fitid = tag(body, "FITID");
    lines.push({
      date,
      dir: signed > 0 ? "in" : "out",
      amount: Math.abs(signed),
      description,
      balance: null,
      ...(fitid ? { ref: fitid.slice(0, 60) } : {}),
    });
  }
  return { lines, invalid, truncated };
}
