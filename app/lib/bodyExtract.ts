import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// 논문 전문(영어 텍스트)에서 분석용 본문 핵심(방법·결과)을 추출한다.
// PDF 업로드 경로(/api/pdf)와 동일한 방침: 유형 적응형 + 영어 원문 verbatim 발췌.
const SYSTEM_PROMPT = `당신은 의학 논문 전문(영어)에서 분석에 필요한 본문 핵심(방법·결과)을 발췌하는 도우미입니다.

먼저 이 논문의 유형을 판단합니다(라벨은 출력하지 말고 추출 방향에만 사용):
  (가) 임상연구 — RCT·코호트·환자대조·단면·메타분석·umbrella review 등 사람 대상 연구
  (나) 기전/기초실험 — 세포·동물 대상 분자기전·약리 연구
  (다) 서술적 리뷰 — 특정 주제의 근거를 종합·정리한 리뷰

추출 규칙:
- methods: 논문 유형에 맞춰 "방법/접근"의 핵심을 본문 문장 그대로 발췌.
  · 임상연구: 연구설계, 대상·표본수, 그리고 일차결과(primary outcome/endpoint) 정의.
  · 기전/기초실험: 실험 모델(세포주·동물모델), 다룬 물질·유전자, 실험 접근법.
  · 리뷰: 리뷰가 다루는 범위·핵심 주제, 종합한 근거의 종류(전임상/임상 등).
  해당 정보가 없으면 빈 문자열.
- results: 논문 유형에 맞춰 "핵심 결과/내용"을 본문 수치·명칭 그대로 발췌(핵심을 누락하지 마십시오).
  · 임상연구: 일차결과의 효과추정치(HR·RR·OR·effect size·mean difference 등)와 CI·p값.
  · 기전/기초실험: 핵심 분자·신호경로와 관찰된 효과(농도·용량과 방향성 등 본문 수치 포함).
  · 리뷰: 주제별 핵심 발견과 저자가 강조한 결론.
  없으면 빈 문자열.

★ methods·results 언어 규칙(중요):
  · 원문 언어(영어) 그대로 verbatim 발췌합니다. 한국어로 번역·요약·의역하지 마십시오.
  · 본문에 실재하는 연속된 문장을 그대로 복사합니다(독자가 원문에서 형광펜으로 찾을 수 있어야 함). 짜깁기·재작성 금지.
  · 라벨([Methods] 등)이나 한국어 설명 문장을 넣지 말고, 영어 원문 발췌만 담습니다.
- 본문에 명시되지 않은 정보를 추측·생성하지 마십시오. 유형 라벨은 출력하지 마십시오.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    methods: { type: "string" },
    results: { type: "string" },
  },
  required: ["methods", "results"],
  additionalProperties: false,
} as const;

// 입력 상한 — 전문이 매우 길어도 앞부분(방법·결과가 위치하는 구간) 위주로 전달
const MAX_INPUT_CHARS = 80000;

// 전문 텍스트 → "[methods 발췌]\n\n[results 발췌]" 형태의 fullText (없으면 빈 문자열)
export async function extractMethodsResults(bodyText: string): Promise<string> {
  const trimmed = bodyText.slice(0, MAX_INPUT_CHARS);
  if (trimmed.trim().length < 400) return "";

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
        content: `다음은 한 편의 의학 논문 전문(영어)입니다. 지정된 JSON 형식으로 methods·results 핵심을 추출하세요.\n\n${trimmed}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  let parsed: { methods?: unknown; results?: unknown };
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return "";
  }
  const methods = typeof parsed.methods === "string" ? parsed.methods : "";
  const results = typeof parsed.results === "string" ? parsed.results : "";
  return [methods, results]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
}
