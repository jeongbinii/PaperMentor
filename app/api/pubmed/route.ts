import { NextResponse } from "next/server";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export type PubMedPaper = {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  pubdate: string;
  doi: string | null;
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
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  const ids: string[] | undefined = data?.esearchresult?.idlist;
  return ids && ids.length > 0 ? ids[0] : null;
}

async function fetchSummary(pmid: string) {
  const url = `${EUTILS}/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
  const res = await fetch(url, { cache: "no-store" });
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

async function fetchAbstract(pmid: string): Promise<string> {
  const url = `${EUTILS}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=text`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`efetch 실패 (status ${res.status})`);
  const text = await res.text();
  return text.trim();
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

    const [summary, abstractText] = await Promise.all([
      fetchSummary(pmid),
      fetchAbstract(pmid),
    ]);

    const paper: PubMedPaper = {
      pmid,
      title: summary.title,
      abstract: abstractText,
      authors: summary.authors,
      journal: summary.journal,
      pubdate: summary.pubdate,
      doi: summary.doi,
    };

    return NextResponse.json(paper);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
