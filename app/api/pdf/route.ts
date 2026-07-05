import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { enrichFromPdfIdentifiers, type PubMedPaper } from "@/app/lib/ncbi";

const client = new Anthropic();

// Anthropic PDF 입력 한도: 32MB / 100페이지
const MAX_PDF_BYTES = 32 * 1024 * 1024;

const SYSTEM_PROMPT = `당신은 업로드된 의학 논문 PDF에서 서지정보·초록과 분석에 필요한 본문 핵심(방법·결과)을 추출하는 도우미입니다.
PDF 본문을 읽고 지정된 형식으로 추출합니다.

먼저 이 논문의 유형을 판단합니다(라벨은 출력하지 말고 추출 방향에만 사용):
  (가) 임상연구 — RCT·코호트·환자대조·단면·메타분석·umbrella review 등 사람 대상 연구
  (나) 기전/기초실험 — 세포·동물 대상 분자기전·약리 연구
  (다) 서술적 리뷰 — 특정 주제의 근거를 종합·정리한 리뷰

추출 규칙:
- title: 논문 제목 원문 그대로 (대개 영어). 줄바꿈은 공백으로 정리.
- abstract: 초록(Abstract) 전체 원문. 구조화 초록(Background/Methods/Results/Conclusions 라벨)이면 라벨을 포함해 그대로. 초록이 없으면 도입부(Introduction) 첫 문단으로 대체하고, 그것도 없으면 빈 문자열.
- authors: 저자명 배열 (논문 표기 순서대로). 없으면 빈 배열.
- journal: 저널/학술지명. 없으면 빈 문자열.
- pubdate: 출판 연도 또는 날짜 (예: "2023" 또는 "2023 May"). 없으면 빈 문자열.
- doi: DOI 문자열 (예: "10.1056/NEJMoa2034577"). 없으면 null.
- pmcid: PMC 식별자 (예: "PMC1234567"). 논문 첫 페이지·헤더·각주·워터마크에 있으면 그대로. 없으면 null.
- pmid: PubMed ID(숫자만). 논문에 표기돼 있으면 그대로. 없으면 null.
- methods: 논문 유형에 맞춰 "방법/접근"의 핵심을 본문 문장 그대로 발췌.
  · 임상연구: 연구설계, 대상·표본수, 그리고 일차결과(primary outcome/endpoint)가 무엇으로 정의됐는지.
  · 기전/기초실험: 사용한 실험 모델(세포주·동물모델), 다룬 물질·유전자, 실험 접근법(어떤 표적·경로를 어떻게 평가했는지).
  · 리뷰: 리뷰가 다루는 범위·핵심 주제, 종합한 근거의 종류(전임상/임상 등).
  해당 정보가 없으면 빈 문자열.
- results: 논문 유형에 맞춰 "핵심 결과/내용"을 본문 문장 그대로 발췌(핵심을 누락하지 마십시오).
  · 임상연구: 일차결과의 효과추정치(HR·RR·OR·effect size·mean difference 등)와 CI·p값.
  · 기전/기초실험: 핵심 분자·신호경로와 관찰된 효과(농도·용량과 방향성 등 본문 수치 포함).
  · 리뷰: 주제별 핵심 발견과 저자가 강조한 결론.
  없으면 빈 문자열.

★ methods·results 언어 규칙(중요):
  · methods와 results는 PDF 본문에 쓰인 "원문 언어(대개 영어) 그대로" 발췌합니다. 한국어로 번역·요약·의역하지 마십시오.
  · 가능한 한 본문에 실재하는 연속된 문장을 그대로 복사합니다(독자가 PDF 원문에서 형광펜으로 찾을 수 있어야 함). 문장을 짜깁기하거나 새로 쓰지 마십시오.
  · 라벨([Methods] 등)이나 한국어 설명 문장을 끼워넣지 말고, 영어 원문 발췌만 담습니다.
- 어떤 유형이든 PDF에 명시되지 않은 정보를 추측하거나 생성하지 마십시오. 유형 라벨(임상/기전/리뷰)은 출력하지 말고 내용만 채웁니다.`;

// structured outputs용 JSON 스키마 — Claude가 스키마에 맞는 유효한 JSON만 출력하도록 강제
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    abstract: { type: "string" },
    authors: { type: "array", items: { type: "string" } },
    journal: { type: "string" },
    pubdate: { type: "string" },
    doi: { type: ["string", "null"] },
    pmcid: { type: ["string", "null"] },
    pmid: { type: ["string", "null"] },
    methods: { type: "string" },
    results: { type: "string" },
  },
  required: [
    "title",
    "abstract",
    "authors",
    "journal",
    "pubdate",
    "doi",
    "pmcid",
    "pmid",
    "methods",
    "results",
  ],
  additionalProperties: false,
} as const;

type ExtractedPaper = {
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  pubdate: string;
  doi: string | null;
  pmcid: string | null;
  pmid: string | null;
  methods: string;
  results: string;
};

function extractJson(text: string): ExtractedPaper {
  // structured outputs로 받은 응답은 스키마에 맞는 유효한 JSON 객체임이 보장됨
  const parsed = JSON.parse(text.trim()) as Partial<ExtractedPaper>;
  return {
    title: typeof parsed.title === "string" ? parsed.title : "",
    abstract: typeof parsed.abstract === "string" ? parsed.abstract : "",
    authors: Array.isArray(parsed.authors)
      ? parsed.authors.filter((a): a is string => typeof a === "string")
      : [],
    journal: typeof parsed.journal === "string" ? parsed.journal : "",
    pubdate: typeof parsed.pubdate === "string" ? parsed.pubdate : "",
    doi: typeof parsed.doi === "string" && parsed.doi.trim() ? parsed.doi : null,
    pmcid: typeof parsed.pmcid === "string" && parsed.pmcid.trim() ? parsed.pmcid : null,
    pmid: typeof parsed.pmid === "string" && parsed.pmid.trim() ? parsed.pmid : null,
    methods: typeof parsed.methods === "string" ? parsed.methods : "",
    results: typeof parsed.results === "string" ? parsed.results : "",
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "PDF 파일(file 필드)이 필요합니다." },
        { status: 400 },
      );
    }
    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "PDF 파일만 업로드할 수 있습니다." },
        { status: 400 },
      );
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "PDF 용량이 32MB를 초과합니다." },
        { status: 400 },
      );
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            {
              type: "text",
              text: "이 PDF에서 서지정보·초록과 방법(methods)·결과(results) 핵심을 추출해 지정된 JSON으로 출력하세요.",
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const extracted = extractJson(text);

    // PDF에 인쇄된 식별자(DOI·PMCID·PMID)로 PMC 오픈액세스 전문 보강을 먼저 시도한다.
    // 성공하면 사이트(PMID/DOI) 경로와 동일하게 전체 본문·원문 그림을 갖춘 paper로 수렴 —
    // 요약·시각화요약·발표슬라이드 품질이 경로와 무관하게 일정해진다.
    // 실패(PMC 미수록·식별자 없음·제목 불일치)하면 아래 기존 PDF 추출 결과로 폴백.
    const enriched = await enrichFromPdfIdentifiers({
      doi: extracted.doi,
      pmcid: extracted.pmcid,
      pmid: extracted.pmid,
      title: extracted.title,
    });
    if (enriched) {
      return NextResponse.json({ paper: enriched, source: "pmc", usage: response.usage });
    }

    if (!extracted.abstract) {
      return NextResponse.json(
        { error: "PDF에서 초록을 추출하지 못했습니다." },
        { status: 422 },
      );
    }

    // 발췌(방법·접근 / 핵심 결과)를 본문(fullText)으로 결합.
    // 논문 유형에 따라 Methods/Results 구조가 아닐 수 있으므로 라벨을 붙이지 않고
    // 영어 원문 구절을 그대로 이어 붙인다 (PDF 형광펜 매칭·표시 모두 원문 기준).
    const fullText = [extracted.methods, extracted.results]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n\n");

    // 기존 PubMed 파이프라인과 동일한 모양으로 반환 (pmid는 합성 식별자)
    const syntheticId =
      extracted.doi ?? `pdf:${file.name.replace(/\.pdf$/i, "")}`;

    const paper: PubMedPaper = {
      pmid: syntheticId,
      title: extracted.title || file.name,
      abstract: extracted.abstract,
      authors: extracted.authors,
      journal: extracted.journal,
      pubdate: extracted.pubdate,
      doi: extracted.doi,
      fullText,
    };

    return NextResponse.json({ paper, source: "pdf", usage: response.usage });
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: error.message, status: error.status },
        { status: error.status ?? 500 },
      );
    }
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
