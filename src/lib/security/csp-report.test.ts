import { describe, expect, it } from "vitest";
import { MAX_REPORTS_PER_REQUEST, maskPath, parseCspReports, violationDetail, violationMessage } from "./csp-report";

const ORIGIN = "https://emlaksoft.com.tr";

const legacy = (r: Record<string, unknown>) => JSON.stringify({ "csp-report": r });
const api = (bodies: Record<string, unknown>[]) => JSON.stringify(bodies.map((body) => ({ type: "csp-violation", url: body.documentURL, body })));

describe("CSP rapor ayrıştırıcı", () => {
  it("eski report-uri biçimi: satır içi betik, kaynak belge parmak izine girmez", () => {
    const [v] = parseCspReports(
      legacy({
        "document-uri": `${ORIGIN}/app/musteriler/8f3a1c2e-1111-4222-8333-944445555666?x=1`,
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src-elem",
        "blocked-uri": "inline",
        "source-file": `${ORIGIN}/app/musteriler/8f3a1c2e-1111-4222-8333-944445555666?x=1`,
        "line-number": 12,
        "script-sample": "try{if(localStorage.getItem(\"es-x\")",
        disposition: "report",
      }),
      ORIGIN,
    );
    expect(v).toMatchObject({ directive: "script-src-elem", blocked: "inline", documentPath: "/app/musteriler/<id>", sourceFile: null, line: null });
    expect(violationMessage(v!)).toBe('CSP (rapor modu) script-src-elem: inline «try{if(localStorage.getItem("es-x")»');
    expect(violationDetail(v!)).toContain("örnek sayfa: /app/musteriler/<id>");
  });

  it("Reporting API biçimi: harici betik, sürüm özetli Next parça adı sabitlenir (yayından yayına aynı satır)", () => {
    const out = parseCspReports(
      api([
        {
          documentURL: `${ORIGIN}/admin/sistem`,
          effectiveDirective: "script-src-elem",
          blockedURL: `${ORIGIN}/_next/static/chunks/0abc123xyz.js`,
          sourceFile: `${ORIGIN}/_next/static/chunks/2lxtw-dfmj4t6.js`,
          lineNumber: 1,
          columnNumber: 5000,
          disposition: "report",
        },
      ]),
      ORIGIN,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ blocked: "/_next/static/chunks/*.js", sourceFile: "/_next/static/chunks/*.js", line: 1, column: 5000 });
    expect(violationMessage(out[0]!)).toBe("CSP (rapor modu) script-src-elem: /_next/static/chunks/*.js @ /_next/static/chunks/*.js:1");
  });

  it("başka sitenin belgesi, tarayıcı eklentisi, enforce kipi ve bozuk gövde atılır", () => {
    expect(parseCspReports(legacy({ "document-uri": "https://evil.example/app", "effective-directive": "script-src", "blocked-uri": "inline" }), ORIGIN)).toEqual([]);
    expect(
      parseCspReports(legacy({ "document-uri": `${ORIGIN}/app`, "effective-directive": "script-src", "blocked-uri": "chrome-extension://abc/x.js" }), ORIGIN),
    ).toEqual([]);
    expect(
      parseCspReports(legacy({ "document-uri": `${ORIGIN}/app`, "effective-directive": "script-src", "blocked-uri": "inline", disposition: "enforce" }), ORIGIN),
    ).toEqual([]);
    expect(parseCspReports("{bozuk", ORIGIN)).toEqual([]);
    expect(parseCspReports(JSON.stringify({ x: 1 }), ORIGIN)).toEqual([]);
    expect(parseCspReports(JSON.stringify([{ type: "deprecation", body: {} }]), ORIGIN)).toEqual([]);
    expect(parseCspReports(legacy({ "document-uri": `${ORIGIN}/app`, "effective-directive": "x'; drop", "blocked-uri": "inline" }), ORIGIN)).toEqual([]);
  });

  it("dış kaynak: origin + yol (sorgu atılır); istek başına en çok 20 rapor", () => {
    const [v] = parseCspReports(
      legacy({ "document-uri": `${ORIGIN}/app`, "effective-directive": "script-src-elem", "blocked-uri": "https://cdn.example.com/a.js?token=gizli" }),
      ORIGIN,
    );
    expect(v?.blocked).toBe("https://cdn.example.com/a.js");
    const many = Array.from({ length: 50 }, () => ({ documentURL: `${ORIGIN}/app`, effectiveDirective: "script-src-elem", blockedURL: "eval" }));
    expect(parseCspReports(api(many), ORIGIN)).toHaveLength(MAX_REPORTS_PER_REQUEST);
  });

  it("maskPath: UUID ve uzun sayılar maskelenir, sorgu atılır", () => {
    expect(maskPath("/app/portfoyler/123456/duzenle?x=1")).toBe("/app/portfoyler/<n>/duzenle");
    expect(maskPath("/app/gorevler")).toBe("/app/gorevler");
  });
});
