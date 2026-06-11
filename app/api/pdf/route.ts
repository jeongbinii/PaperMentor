import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

// Anthropic PDF 입력 한도: 32MB / 100페이지
const MAX_PDF_BYTES = 32 * 1024 * 1024;

export type PubMedPaper = {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  pubdate: string;
  doi: string | null;
};

const SYSTEM_PROMPT = `당신은 업로드된 의학 논문 PDF에서 서지정보와 초록을 추출하는 도우미입니다.
PDF 본문을 읽고 지정된 형식으로 추출합니다.

추출 규칙:
- title: 논문 제목 원문 그대로 (대개 영어). 줄바꿈은 공백으로 정리.
- abstract: 초록(Abstract) 전체 원문. 구조화 초록(Background/Methods/Results/Conclusions 라벨)이면 라벨을 포함해 그대로. 초록이 없으면 도입부(Introduction) 첫 문단으로 대체하고, 그것도 없으면 빈 문자열.
- authors: 저자명 배열 (논문 표기 순서대로). 없으면 빈 배열.
- journal: 저널/학술지명. 없으면 빈 문자열.
- pubdate: 출판 연도 또는 날짜 (예: "2023" 또는 "2023 May"). 없으면 빈 문자열.
- doi: DOI 문자열 (예: "10.1056/NEJMoa2034577"). 없으면 null.
- PDF에 명시되지 않은 정보를 추측하거나 생성하지 마십시오.`;

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
  },
  required: ["title", "abstract", "authors", "journal", "pubdate", "doi"],
  additionalProperties: false,
} as const;

type ExtractedPaper = {
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  pubdate: string;
  doi: string | null;
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
      max_tokens: 4096,
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
              text: "이 PDF에서 서지정보와 초록을 추출해 지정된 JSON으로 출력하세요.",
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

    if (!extracted.abstract) {
      return NextResponse.json(
        { error: "PDF에서 초록을 추출하지 못했습니다." },
        { status: 422 },
      );
    }

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
    };

    return NextResponse.json({ paper, usage: response.usage });
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
