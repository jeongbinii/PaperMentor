// NCBI E-utilities · PMC(오픈액세스 전문) 공용 모듈.
// PMID/DOI/PMCID 어느 경로로 들어오든 동일한 PubMedPaper를 만들어 downstream(요약·GA·슬라이드)에
// 일관된 재료를 공급한다. /api/pubmed(식별자 입력)와 /api/pdf(업로드 후 보강)가 함께 사용.

import { extractMethodsResults } from "./bodyExtract";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export type Figure = { label: string; caption: string; srcs: string[] };

export type PubMedPaper = {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  pubdate: string;
  doi: string | null;
  fullText?: string;
  bodyText?: string;
  figures?: Figure[];
};

// NCBI E-utilities 식별 파라미터(권장) + 선택적 API 키.
// NCBI_API_KEY를 .env.local에 넣으면 초당 요청 한도가 3→10으로 올라가 429가 크게 줄어든다.
function ncbiParams(): string {
  const parts = ["tool=papermentor", "email=risepapermentor%40gmail.com"];
  const key = process.env.NCBI_API_KEY;
  if (key) parts.push(`api_key=${encodeURIComponent(key)}`);
  return parts.join("&");
}

// 레이트리밋(429)에 지수 백오프 재시도. NCBI는 키 없이 초당 3회 제한이라
// 논문 1건 로드에 필요한 여러 호출이 몰리면 간헐적으로 429가 난다.
async function ncbiFetch(url: string, tries = 4): Promise<Response> {
  const full = url + (url.includes("?") ? "&" : "?") + ncbiParams();
  let res: Response = await fetch(full, { cache: "no-store" });
  for (let i = 0; i < tries - 1 && res.status === 429; i++) {
    await new Promise((r) => setTimeout(r, 350 * 2 ** i)); // 350·700·1400ms
    res = await fetch(full, { cache: "no-store" });
  }
  return res;
}

// ── 식별자 판별·정규화 ──────────────────────────────────────────────
export type InputType = "pmid" | "doi" | "pmcid" | "unknown";

export function detectInputType(raw: string): InputType {
  const v = raw.trim();
  // "PMC1234567" · "PMC 1234567" · "PMCID: 1234567" 등 PMC 라벨이 붙으면 PMCID (숫자만이면 아래 PMID)
  if (/^pmc(\s*id)?[\s:]*\d{1,9}$/i.test(v)) return "pmcid";
  if (/^\d{1,9}$/.test(v)) return "pmid";
  if (/^10\.\d{4,9}\/\S+$/i.test(v)) return "doi";
  return "unknown";
}

// "PMC1234567" · "pmc 1234567" · "PMCID: PMC1234567" → "1234567"(숫자만). 없으면 "".
export function normalizePmcid(raw: string): string {
  return raw.trim().replace(/pmcid/i, "").replace(/pmc/i, "").replace(/\D/g, "");
}

// ── 식별자 → PMID 변환 ──────────────────────────────────────────────
async function doiToPmid(doi: string): Promise<string | null> {
  const url = `${EUTILS}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(
    doi,
  )}[doi]&retmode=json`;
  const res = await ncbiFetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const ids: string[] | undefined = data?.esearchresult?.idlist;
  return ids && ids.length > 0 ? ids[0] : null;
}

// PMCID(숫자) → PMID. elink(dbfrom=pmc, db=pubmed). 대응 PubMed 레코드가 없으면 null.
async function pmcidToPmid(pmcNumeric: string): Promise<string | null> {
  if (!pmcNumeric) return null;
  const url = `${EUTILS}/elink.fcgi?dbfrom=pmc&db=pubmed&id=${pmcNumeric}&retmode=json`;
  const res = await ncbiFetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const dbs = data?.linksets?.[0]?.linksetdbs ?? [];
  const pm = dbs.find(
    (d: { dbto?: string; linkname?: string }) =>
      d.dbto === "pubmed" || d.linkname?.includes("pubmed"),
  );
  const id = pm?.links?.[0];
  return id ? String(id) : null;
}

async function fetchSummary(pmid: string) {
  const url = `${EUTILS}/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
  const res = await ncbiFetch(url);
  if (!res.ok) throw new Error(`esummary 실패 (status ${res.status})`);
  const data = await res.json();
  const entry = data?.result?.[pmid];
  if (!entry || entry.error) {
    throw new Error("해당 PMID의 논문을 PubMed에서 찾을 수 없습니다.");
  }
  const authors: string[] = (entry.authors ?? [])
    .filter((a: { authtype?: string }) => a.authtype === "Author")
    .map((a: { name: string }) => a.name);
  const doi: string | null =
    (entry.articleids ?? []).find(
      (id: { idtype: string }) => id.idtype === "doi",
    )?.value ?? null;
  return {
    title: entry.title ?? "",
    authors,
    journal: entry.fulljournalname ?? entry.source ?? "",
    pubdate: entry.pubdate ?? "",
    doi,
  };
}

function stripXml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x0*26;|&amp;/gi, "&")
    .replace(/&#\d+;|&#x[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 깔끔한 초록: efetch XML의 <AbstractText>만 추출(저자·소속·DOI 등 잡정보 제거).
// 구조화 초록(Label="METHODS" 등)은 라벨을 살려 재구성. 없으면 text 모드로 폴백.
async function fetchAbstract(pmid: string): Promise<string> {
  const xmlRes = await ncbiFetch(
    `${EUTILS}/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`,
  );
  if (xmlRes.ok) {
    const xml = await xmlRes.text();
    const parts: string[] = [];
    const re = /<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const label = m[1].match(/Label="([^"]*)"/i)?.[1]?.trim() ?? "";
      const text = stripXml(m[2]);
      if (text) parts.push(label ? `${label}: ${text}` : text);
    }
    const abstract = parts.join("\n\n").trim();
    if (abstract) return abstract;
  }
  // 폴백: 구조화 초록 파싱 실패 시 text 모드
  const res = await ncbiFetch(
    `${EUTILS}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=text`,
  );
  if (!res.ok) throw new Error(`efetch 실패 (status ${res.status})`);
  return (await res.text()).trim();
}

// PMID → PMC(오픈액세스 전문) 식별자. 없으면 null (= 전문 비공개/미수록).
async function fetchPmcId(pmid: string): Promise<string | null> {
  const url = `${EUTILS}/elink.fcgi?dbfrom=pubmed&db=pmc&id=${pmid}&retmode=json`;
  const res = await ncbiFetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const dbs = data?.linksets?.[0]?.linksetdbs ?? [];
  const pmc = dbs.find(
    (d: { dbto?: string; linkname?: string }) =>
      d.dbto === "pmc" || d.linkname?.includes("pmc"),
  );
  const id = pmc?.links?.[0];
  return id ? String(id) : null;
}

// XML 조각 → 평문(태그 제거 + 엔티티 정리)
function decodeXmlText(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x0*26;|&amp;/gi, "&")
    .replace(/&#\d+;|&#x[0-9a-f]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// JATS 전문 XML → 본문(body) 평문. 참고문헌·표·그림은 제거. (methods/results 발췌 입력용)
function jatsBodyToText(xml: string): string {
  const m = xml.match(/<body[\s>][\s\S]*?<\/body>/i);
  if (!m) return "";
  return m[0]
    .replace(/<ref-list[\s\S]*?<\/ref-list>/gi, "")
    .replace(/<table-wrap[\s\S]*?<\/table-wrap>/gi, "")
    .replace(/<fig[\s\S]*?<\/fig>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x0*26;|&amp;/gi, "&")
    .replace(/&#\d+;|&#x[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 문서 전체에서 <fig> 추출(본문 인라인 + 뒤쪽 floats-group 모두). id로 본문 xref와 연결.
// 하나의 <fig>에 여러 <graphic>(하위 패널 a·b·c)이 있으면 파일명을 모두 담는다.
function parseFigures(
  xml: string,
): { id: string; label: string; caption: string; files: string[] }[] {
  const out: {
    id: string;
    label: string;
    caption: string;
    files: string[];
  }[] = [];
  const re = /<fig[\s>][\s\S]*?<\/fig>/gi;
  let f: RegExpExecArray | null;
  while ((f = re.exec(xml)) !== null) {
    const block = f[0];
    const id = block.match(/\bid="([^"]+)"/i)?.[1] ?? "";
    const label = decodeXmlText(block.match(/<label>([\s\S]*?)<\/label>/i)?.[1] ?? "");
    const caption = decodeXmlText(
      block.match(/<caption>([\s\S]*?)<\/caption>/i)?.[1] ?? "",
    );
    const files: string[] = [];
    const gre = /<graphic[^>]*?(?:xlink:href|href)="([^"]+)"/gi;
    let g: RegExpExecArray | null;
    while ((g = gre.exec(block)) !== null) {
      files.push(g[1].replace(/\.[a-z0-9]+$/i, ""));
    }
    out.push({ id, label, caption, files });
  }
  return out;
}

// JATS <body> → 표시용 전체 본문(구조 보존). 그림은 본문 내 위치(인라인 <fig> 또는
// <xref ref-type="fig">가 처음 나온 지점)에 @@FIG:n@@ 마커로 끼워 넣고, 참조 안 된 그림은 끝에 붙인다.
function jatsBodyToFullText(xml: string, figs: { id: string }[]): string {
  const m = xml.match(/<body[\s>][\s\S]*?<\/body>/i);
  if (!m) return "";
  const idToIndex = new Map(figs.map((f, i) => [f.id, i]));
  const placed = new Set<number>();

  let s = m[0]
    .replace(/<ref-list[\s\S]*?<\/ref-list>/gi, "")
    .replace(/<table-wrap[\s\S]*?<\/table-wrap>/gi, "");

  // (a) 본문에 인라인으로 들어있는 <fig>는 그 자리에 마커로 치환
  s = s.replace(/<fig[\s>][\s\S]*?<\/fig>/gi, (block) => {
    const id = block.match(/\bid="([^"]+)"/i)?.[1] ?? "";
    const idx = idToIndex.get(id);
    if (idx !== undefined && !placed.has(idx)) {
      placed.add(idx);
      return `\n\n@@FIG:${idx}@@\n\n`;
    }
    return "";
  });

  // (b) floats-group에 그림이 몰려있으면 본문 첫 xref 지점에 마커 삽입(참조 텍스트는 유지)
  s = s.replace(
    /<xref[^>]*ref-type="fig"[^>]*rid="([^"]+)"[^>]*>([\s\S]*?)<\/xref>/gi,
    (_whole, rid, txt) => {
      const idx = idToIndex.get(rid);
      if (idx !== undefined && !placed.has(idx)) {
        placed.add(idx);
        return `${txt} @@FIG:${idx}@@`;
      }
      return txt;
    },
  );

  s = s
    .replace(/<title[^>]*>/gi, "\n\n")
    .replace(/<\/title>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/sec>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x0*26;|&amp;/gi, "&")
    .replace(/&#\d+;|&#x[0-9a-f]+;/gi, " ");

  // (c) 본문에서 참조되지 않은 그림은 끝에 순서대로 붙임
  const leftover = figs.map((_, i) => i).filter((i) => !placed.has(i));
  if (leftover.length) {
    s += "\n\n" + leftover.map((i) => `@@FIG:${i}@@`).join("\n\n");
  }

  return s
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 아티클 HTML을 받아 그림 CDN URL을 (파일명 → URL)로 매핑.
// efetch XML엔 파일명만 있고 실제 경로는 해시 CDN이라 HTML에서 긁어야 한다.
async function fetchPmcImageUrls(pmcId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await fetch(`https://pmc.ncbi.nlm.nih.gov/articles/PMC${pmcId}/`, {
      headers: { "User-Agent": "Mozilla/5.0 (PaperMentor)" },
      cache: "no-store",
    });
    if (!res.ok) return map;
    const html = await res.text();
    const re =
      /https:\/\/cdn\.ncbi\.nlm\.nih\.gov\/pmc\/blobs\/[^"'\s]+?\/([^"'/\s]+?)\.(?:jpg|jpeg|png|gif)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (!map.has(m[1])) map.set(m[1], m[0]);
    }
  } catch {
    // 무시 — 그림 없이 텍스트만 표시
  }
  return map;
}

// ── HTML 폴백 헬퍼 (efetch가 전문 XML을 거부하는 논문용) ─────────────

// HTML 엔티티 디코드. XML용(decodeXmlText)은 숫자 엔티티를 공백으로 버리지만,
// 표시 품질을 위해 여기선 그리스문자·기호를 실제 문자로 복원한다.
function decodeHtmlEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
    hellip: "…", deg: "°", times: "×", minus: "−", plusmn: "±", micro: "µ",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", kappa: "κ", lambda: "λ", mu: "µ",
  };
  const cp = (n: number) => {
    try {
      return String.fromCodePoint(n);
    } catch {
      return " ";
    }
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => named[n] ?? named[n.toLowerCase()] ?? m);
}

// HTML 조각 → 평문. 헤딩·문단은 개행으로, 표·스크립트는 제거. @@FIG:n@@ 마커는 보존.
function htmlFragmentToText(frag: string): string {
  const s = frag
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<table[\s\S]*?<\/table>/gi, "")
    .replace(/<h[1-6][^>]*>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/(section|div|li|tr|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(s)
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// PMC 웹 HTML에서 본문·그림을 파싱. 화면용 HTML이라 본문 컨테이너를 격리하고
// 참고문헌·그림 블록을 분리하는 휴리스틱이 필요하다. 본문 확신 못 하면 빈 값(→초록 폴백).
async function buildPmcContentFromHtml(pmcId: string): Promise<PmcContent> {
  const res = await fetch(`https://pmc.ncbi.nlm.nih.gov/articles/PMC${pmcId}/`, {
    headers: { "User-Agent": "Mozilla/5.0 (PaperMentor)" },
    cache: "no-store",
  });
  if (!res.ok) return EMPTY_CONTENT;
  const html = await res.text();

  // 1) 본문 컨테이너 격리: <section class="... main-article-body ...">
  const startRe = /<section[^>]*class="[^"]*\bmain-article-body\b[^"]*"[^>]*>/i;
  const startM = startRe.exec(html);
  if (!startM) return EMPTY_CONTENT;
  const afterStart = html.slice(startM.index + startM[0].length);

  // 참고문헌(<section id="ref-list…">) 앞까지가 본문. 그 뒤(감사말·각주 등)는 버림.
  const refM = /<section[^>]*\bid="ref-list/i.exec(afterStart);
  let region = refM ? afterStart.slice(0, refM.index) : afterStart;

  // 2) 초록은 별도로 이미 확보 → 첫 본문 섹션 제목(pmc_sec_title)부터 시작해 중복 방지
  const firstSec = /<h2[^>]*class="[^"]*pmc_sec_title/i.exec(region);
  if (firstSec) region = region.slice(firstSec.index);

  // 3) <figure> 블록 → figures 추출 + 위치에 @@FIG:n@@ 마커 치환(인라인 배치 보존)
  const figures: Figure[] = [];
  region = region.replace(/<figure\b[\s\S]*?<\/figure>/gi, (block) => {
    const objHead = decodeHtmlEntities(
      (block.match(/<h4[^>]*class="[^"]*obj_head[^"]*"[^>]*>([\s\S]*?)<\/h4>/i)?.[1] ?? "")
        .replace(/<[^>]+>/g, " "),
    ).replace(/\s+/g, " ").trim();
    const figcap = decodeHtmlEntities(
      (block.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] ?? "")
        .replace(/<[^>]+>/g, " "),
    ).replace(/\s+/g, " ").trim();
    const srcs = Array.from(
      block.matchAll(
        /<img[^>]*\bsrc="(https:\/\/cdn\.ncbi\.nlm\.nih\.gov\/pmc\/blobs\/[^"]+)"/gi,
      ),
    ).map((m) => m[1]);
    // 이미지가 없는 figure(수식 등)는 슬라이드/표시에서 의미 없어 건너뜀
    if (srcs.length === 0) return " ";
    const idx = figures.length;
    const labelM = objHead.match(/^\s*((?:Figure|Fig\.?|Table|Scheme)\s*\.?\s*\d+)/i);
    const label = labelM ? labelM[1].replace(/\s+/g, " ").trim() : `Figure ${idx + 1}`;
    const title = objHead.replace(
      /^\s*(?:Figure|Fig\.?|Table|Scheme)\s*\.?\s*\d+\s*[.:]?\s*/i,
      "",
    );
    const caption = [title, figcap].map((t) => t.trim()).filter(Boolean).join(" ");
    figures.push({ label, caption, srcs });
    return `\n\n@@FIG:${idx}@@\n\n`;
  });

  const bodyText = htmlFragmentToText(region);
  if (bodyText.length < 500) return EMPTY_CONTENT; // 본문 격리 실패로 간주 → 초록 폴백

  // 분석 입력용 발췌는 마커 제거한 순수 본문에서 추출
  const plain = bodyText.replace(/@@FIG:\d+@@/g, " ").replace(/\s+/g, " ").trim();
  const fullText = await extractMethodsResults(plain);
  return { bodyText, figures, fullText };
}

// ── PMC 전문 확보 (XML 우선 → HTML 폴백) ────────────────────────────
type PmcContent = { bodyText: string; figures: Figure[]; fullText: string };
const EMPTY_CONTENT: PmcContent = { bodyText: "", figures: [], fullText: "" };

// efetch(db=pmc) 전문 XML(JATS). 오픈액세스 서브셋이면 구조가 깔끔. 본문 없으면 빈 값.
async function buildPmcContentFromXml(pmcId: string): Promise<PmcContent> {
  const res = await ncbiFetch(`${EUTILS}/efetch.fcgi?db=pmc&id=${pmcId}&retmode=xml`);
  if (!res.ok) return EMPTY_CONTENT;
  const xml = await res.text();

  const plain = jatsBodyToText(xml);
  if (plain.length < 500) return EMPTY_CONTENT; // 전문 미수록/출판사 XML 거부

  const figMeta = parseFigures(xml);
  const bodyText = jatsBodyToFullText(xml, figMeta);
  const imgMap = figMeta.some((f) => f.files.length)
    ? await fetchPmcImageUrls(pmcId)
    : new Map<string, string>();
  const figures: Figure[] = figMeta.map((f) => ({
    label: f.label,
    caption: f.caption,
    srcs: f.files.map((file) => imgMap.get(file)).filter((u): u is string => !!u),
  }));

  const fullText = await extractMethodsResults(plain);
  return { bodyText, figures, fullText };
}

// PMC 전문 확보:
//  - bodyText: 표시용 전체 본문(@@FIG:n@@ 그림 마커 포함)
//  - figures : 그림(라벨·캡션·CDN 이미지 URL)
//  - fullText: 분석 입력용 methods/results 발췌
// 먼저 efetch XML(구조 깔끔)을 쓰고, 출판사가 XML을 막은 논문은 웹 HTML로 폴백한다.
// knownPmcId를 주면 PMID→PMC 조회를 생략한다. 전문이 없거나 실패하면 모두 빈 값.
async function buildPmcContent(
  pmid: string,
  knownPmcId?: string,
): Promise<PmcContent> {
  try {
    const pmcId = knownPmcId || (await fetchPmcId(pmid));
    if (!pmcId) return EMPTY_CONTENT;

    const fromXml = await buildPmcContentFromXml(pmcId);
    if (fromXml.bodyText) return fromXml;

    // efetch가 전문 XML을 거부하는 논문(웹엔 보이지만 OA 서브셋 밖) → 웹 HTML 파싱
    return await buildPmcContentFromHtml(pmcId);
  } catch {
    return EMPTY_CONTENT;
  }
}

// ── 고수준 API ──────────────────────────────────────────────────────

export type ResolveResult =
  | { ok: true; pmid: string; pmcId?: string }
  | { ok: false; error: string; status: number };

// 입력(PMID/DOI/PMCID)을 PMID로 해석. PMCID 경로는 PMC 숫자 id도 함께 돌려준다.
export async function resolveToPmid(query: string): Promise<ResolveResult> {
  const type = detectInputType(query);
  if (type === "unknown") {
    return {
      ok: false,
      error:
        "PubMed ID(숫자) · DOI(10.xxxx/yyyy) · PMCID(PMC…) 중 하나를 입력해주세요.",
      status: 400,
    };
  }
  if (type === "pmid") return { ok: true, pmid: query.trim() };
  if (type === "doi") {
    const pmid = await doiToPmid(query.trim());
    if (!pmid) {
      return {
        ok: false,
        error: "해당 DOI에 대응하는 PubMed 논문을 찾지 못했습니다.",
        status: 404,
      };
    }
    return { ok: true, pmid };
  }
  // pmcid
  const pmcNum = normalizePmcid(query);
  const pmid = await pmcidToPmid(pmcNum);
  if (!pmid) {
    return {
      ok: false,
      error: "해당 PMCID에 대응하는 PubMed 논문을 찾지 못했습니다.",
      status: 404,
    };
  }
  return { ok: true, pmid, pmcId: pmcNum };
}

// PMID로 완전한 PubMedPaper 조립(서지·초록·PMC 전문 병렬). knownPmcId로 PMC 조회 생략 가능.
export async function loadPaperByPmid(
  pmid: string,
  knownPmcId?: string,
): Promise<PubMedPaper> {
  const [summary, abstractText, content] = await Promise.all([
    fetchSummary(pmid),
    fetchAbstract(pmid),
    buildPmcContent(pmid, knownPmcId),
  ]);

  return {
    pmid,
    title: summary.title,
    abstract: abstractText,
    authors: summary.authors,
    journal: summary.journal,
    pubdate: summary.pubdate,
    doi: summary.doi,
    fullText: content.fullText || undefined,
    bodyText: content.bodyText || undefined,
    figures: content.figures.length ? content.figures : undefined,
  };
}

// 제목 토큰 겹침 비율(0~1). PDF에서 뽑은 제목과 PMC 해석 결과가 같은 논문인지 가벼운 대조용.
function titleOverlap(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const ta = new Set(norm(a));
  const tb = norm(b);
  if (ta.size === 0 || tb.length === 0) return 0;
  const hit = tb.filter((w) => ta.has(w)).length;
  return hit / Math.max(ta.size, tb.length);
}

// PDF에서 추출한 식별자(doi·pmcid·pmid)로 PMC 전문 보강을 시도.
// PMC 전문(그림 또는 본문)이 실제로 확보됐고, 제목이 PDF와 어긋나지 않을 때만 채택.
// 그 외에는 null → 호출부가 기존 PDF 추출 결과로 폴백한다.
export async function enrichFromPdfIdentifiers(ids: {
  doi?: string | null;
  pmcid?: string | null;
  pmid?: string | null;
  title?: string | null;
}): Promise<PubMedPaper | null> {
  try {
    let pmid: string | null = null;
    let knownPmcId: string | undefined;

    // 1) PMCID(가장 확실) → 2) PMID → 3) DOI 순으로 PMID 확보
    if (ids.pmcid) {
      const pmcNum = normalizePmcid(ids.pmcid);
      if (pmcNum) {
        const p = await pmcidToPmid(pmcNum);
        if (p) {
          pmid = p;
          knownPmcId = pmcNum;
        }
      }
    }
    if (!pmid && ids.pmid && /^\d{1,9}$/.test(ids.pmid.trim())) {
      pmid = ids.pmid.trim();
    }
    if (!pmid && ids.doi && /^10\.\d{4,9}\/\S+$/i.test(ids.doi.trim())) {
      pmid = await doiToPmid(ids.doi.trim());
    }
    if (!pmid) return null;

    const paper = await loadPaperByPmid(pmid, knownPmcId);

    // PMC 전문(그림/본문)이 실제로 확보됐을 때만 의미가 있다. 아니면 PDF 경로가 낫다.
    const hasPmc = !!(paper.figures?.length || paper.bodyText);
    if (!hasPmc) return null;

    // 잘못된 DOI/식별자로 엉뚱한 논문을 불러오는 사고 방지: 제목이 크게 다르면 폐기.
    // (PDF 제목 추출이 비었으면 대조 불가 → 통과시킴)
    if (ids.title && ids.title.trim()) {
      if (titleOverlap(ids.title, paper.title) < 0.4) return null;
    }

    return paper;
  } catch {
    return null;
  }
}
