import { NextResponse } from "next/server";
import { extractMethodsResults } from "../../lib/bodyExtract";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

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

function detectInputType(raw: string): "pmid" | "doi" | "unknown" {
  const v = raw.trim();
  if (/^\d{1,9}$/.test(v)) return "pmid";
  if (/^10\.\d{4,9}\/\S+$/i.test(v)) return "doi";
  return "unknown";
}

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

// DOI/PMID 경로에서 PMC(오픈액세스) 전문을 확보:
//  - bodyText: 표시용 전체 본문(@@FIG:n@@ 그림 마커 포함)
//  - figures : 그림(라벨·캡션·CDN 이미지 URL)
//  - fullText: 분석 입력용 methods/results 발췌(전체 본문은 토큰이 커서 발췌만 분석에 사용)
// 전문이 없거나 실패하면 모두 빈 값(초록 기준 분석으로 자연 폴백).
async function buildPmcContent(
  pmid: string,
): Promise<{ bodyText: string; figures: Figure[]; fullText: string }> {
  const empty = { bodyText: "", figures: [] as Figure[], fullText: "" };
  try {
    const pmcId = await fetchPmcId(pmid);
    if (!pmcId) return empty;
    const res = await ncbiFetch(
      `${EUTILS}/efetch.fcgi?db=pmc&id=${pmcId}&retmode=xml`,
    );
    if (!res.ok) return empty;
    const xml = await res.text();

    const plain = jatsBodyToText(xml);
    if (plain.length < 500) return empty; // 전문 미수록/비어있음

    const figMeta = parseFigures(xml);
    const bodyText = jatsBodyToFullText(xml, figMeta);
    const imgMap = figMeta.some((f) => f.files.length)
      ? await fetchPmcImageUrls(pmcId)
      : new Map<string, string>();
    const figures: Figure[] = figMeta.map((f) => ({
      label: f.label,
      caption: f.caption,
      srcs: f.files
        .map((file) => imgMap.get(file))
        .filter((u): u is string => !!u),
    }));

    const fullText = await extractMethodsResults(plain);
    return { bodyText, figures, fullText };
  } catch {
    return empty;
  }
}

export async function POST(request: Request) {
  try {
    const { query } = await request.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "query 필드(PubMed ID 또는 DOI)가 필요합니다." },
        { status: 400 },
      );
    }

    const type = detectInputType(query);
    if (type === "unknown") {
      return NextResponse.json(
        {
          error:
            "PubMed ID(숫자) 또는 DOI(10.xxxx/yyyy 형식)를 입력해주세요.",
        },
        { status: 400 },
      );
    }

    let pmid: string;
    if (type === "doi") {
      const resolved = await doiToPmid(query.trim());
      if (!resolved) {
        return NextResponse.json(
          { error: "해당 DOI에 대응하는 PubMed 논문을 찾지 못했습니다." },
          { status: 404 },
        );
      }
      pmid = resolved;
    } else {
      pmid = query.trim();
    }

    const [summary, abstractText, content] = await Promise.all([
      fetchSummary(pmid),
      fetchAbstract(pmid),
      buildPmcContent(pmid),
    ]);

    const paper: PubMedPaper = {
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

    return NextResponse.json(paper);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
