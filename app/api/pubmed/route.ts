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

export type PubMedPaper = {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  pubdate: string;
  doi: string | null;
  fullText?: string;
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

// JATS 전문 XML → 본문(body) 평문. 참고문헌·표·그림은 제거.
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

// PMC 전문 본문 텍스트. 실패·비어있으면 빈 문자열.
async function fetchPmcBody(pmcId: string): Promise<string> {
  const url = `${EUTILS}/efetch.fcgi?db=pmc&id=${pmcId}&retmode=xml`;
  const res = await ncbiFetch(url);
  if (!res.ok) return "";
  const xml = await res.text();
  return jatsBodyToText(xml);
}

// DOI/PMID 경로에서도 전문을 확보한다: PMC(오픈액세스)에 있으면 본문을 받아
// PDF 경로와 동일하게 methods/results를 발췌해 fullText로 만든다.
// 전문이 없거나 실패하면 빈 문자열(초록 기준 분석으로 자연 폴백).
async function buildFullText(pmid: string): Promise<string> {
  try {
    const pmcId = await fetchPmcId(pmid);
    if (!pmcId) return "";
    const body = await fetchPmcBody(pmcId);
    if (body.length < 500) return "";
    return await extractMethodsResults(body);
  } catch {
    return "";
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

    const [summary, abstractText, fullText] = await Promise.all([
      fetchSummary(pmid),
      fetchAbstract(pmid),
      buildFullText(pmid),
    ]);

    const paper: PubMedPaper = {
      pmid,
      title: summary.title,
      abstract: abstractText,
      authors: summary.authors,
      journal: summary.journal,
      pubdate: summary.pubdate,
      doi: summary.doi,
      fullText: fullText || undefined,
    };

    return NextResponse.json(paper);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
