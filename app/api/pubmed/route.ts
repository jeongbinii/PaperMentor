import { NextResponse } from "next/server";
import { resolveToPmid, loadPaperByPmid } from "@/app/lib/ncbi";

// 기존 import 경로 유지용 재-export (slides/route·slidePlan 등이 여기서 타입을 가져온다)
export type { Figure, PubMedPaper } from "@/app/lib/ncbi";

// PMID · DOI · PMCID 어느 것으로 들어와도 동일한 PubMedPaper를 반환.
export async function POST(request: Request) {
  try {
    const { query } = await request.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "query 필드(PubMed ID · DOI · PMCID)가 필요합니다." },
        { status: 400 },
      );
    }

    const resolved = await resolveToPmid(query);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const paper = await loadPaperByPmid(resolved.pmid, resolved.pmcId);
    return NextResponse.json(paper);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
