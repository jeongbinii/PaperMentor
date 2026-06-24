import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

export type GAOutcome = {
  metric: string;
  value: string;
  detail: string;
  direction: "benefit" | "harm" | "neutral";
  primary: boolean;
};

export type GraphicalAbstract = {
  headline: string;
  studyType: string;
  population: string;
  intervention: string;
  comparison: string;
  outcomes: GAOutcome[];
  conclusion: string;
};

const SYSTEM_PROMPT = `당신은 의학 논문을 학술지 graphical abstract(그래픽 초록) 형태로 구조화하는 전문가입니다.
의대 저학년·초심자가 논문 한 편의 구조와 핵심 결과를 한눈에 파악하도록, 논문을 아래 JSON 스키마로 변환합니다.

분석 순서:
1. 먼저 이 연구의 일차결과(primary outcome/endpoint)가 무엇인지 식별합니다(본문에 "primary outcome was…"로 선언돼 있으면 그대로, 없으면 목적문에서 추론).
2. 그 일차결과를 outcomes 배열 맨 앞에 두고 primary=true로 표시합니다. 이어서 중요한 이차결과를 최대 3개까지 추가합니다(총 1~4개).

각 필드 작성 규칙:
- headline: 이 논문의 결론을 비전문가도 이해할 평이한 한 문장. 임상 권고("~해야 한다") 금지 — "~을 시사한다/보여준다" 톤.
- studyType: 연구 유형(예: 무작위대조시험, 메타분석·체계적고찰, 코호트연구, 환자-대조연구, 단면연구, 진단정확도연구, 예측모델 연구, 증례보고, 기초·기전연구).
- population: 연구 대상이 누구이고 규모가 얼마인지(예: "만성 심부전 환자 4,744명"). 메타분석이면 "포함된 연구 N편·참여자 N명".
- intervention: 중재 또는 노출이 무엇인지(예: "SGLT2 억제제 추가 투여", 노출이면 "흡연력"). 관찰연구·증례면 핵심 노출/처치.
- comparison: 비교 대상(예: "위약", "비노출군"). 비교군이 없는 설계(증례보고·단면·기전연구 등)면 빈 문자열 "".
- outcomes[].metric: 결과 지표 이름(예: "심혈관 사망 또는 심부전 입원", "전체 생존율", "진단 민감도").
- outcomes[].value: 핵심 수치를 본문 표기 그대로(예: "HR 0.74", "26% 감소", "민감도 92%", "SMD -0.65"). 정량 수치가 본문에 없으면 정성 표현(예: "유의하게 개선").
- outcomes[].detail: 신뢰구간·p값 등 보조 수치를 본문 그대로(예: "95% CI 0.65–0.85, p<0.001"). 없으면 빈 문자열 "".
- outcomes[].direction: 그 결과가 연구 대상에게 유리하면 "benefit", 불리하면(위험 증가·악화) "harm", 차이 없거나 통계적으로 유의하지 않거나 불확실하면 "neutral". 신뢰구간이 귀무값(비율 1, 차이 0)을 포함하면 neutral로 봅니다.
- conclusion: 그래서 임상적으로 무엇을 의미하는지 한 문장(so-what). 과대 일반화·직접 권고 금지.

공통 규칙:
- 본문에 명시된 내용·수치만 사용합니다. 수치를 지어내지 마십시오. 임의 반올림·단위 변경 금지.
- 모든 텍스트는 한국어. 핵심 의학용어는 영어 병기 가능.

반드시 아래 JSON 객체만 출력하세요. 주석·코드블록 표시(\`\`\`)·다른 설명 없이 JSON만 출력합니다.
{
  "headline": "결론을 평이하게 한 문장",
  "studyType": "연구 유형",
  "population": "연구 대상과 규모",
  "intervention": "중재 또는 노출",
  "comparison": "비교 대상 (없으면 \\"\\")",
  "outcomes": [
    { "metric": "결과 지표", "value": "핵심 수치", "detail": "CI·p값 등 (없으면 \\"\\")", "direction": "benefit | harm | neutral", "primary": true }
  ],
  "conclusion": "임상적 의미 한 문장"
}`;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function extractResult(text: string): GraphicalAbstract {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Claude 응답에서 JSON을 찾지 못했습니다.");
  }
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Partial<GraphicalAbstract>;

  const outcomes: GAOutcome[] = Array.isArray(parsed.outcomes)
    ? parsed.outcomes
        .filter((o) => o && typeof o.metric === "string")
        .slice(0, 4)
        .map((o) => ({
          metric: str(o.metric),
          value: str(o.value),
          detail: str(o.detail),
          direction:
            o.direction === "benefit" || o.direction === "harm"
              ? o.direction
              : "neutral",
          primary: o.primary === true,
        }))
    : [];

  return {
    headline: str(parsed.headline),
    studyType: str(parsed.studyType),
    population: str(parsed.population),
    intervention: str(parsed.intervention),
    comparison: str(parsed.comparison),
    outcomes,
    conclusion: str(parsed.conclusion),
  };
}

export async function POST(request: Request) {
  try {
    const { title, abstract, fullText } = await request.json();

    if (!abstract) {
      return NextResponse.json(
        { error: "abstract 필드가 필요합니다." },
        { status: 400 },
      );
    }

    const content = fullText || abstract;
    const userContent = `제목: ${title ?? "정보 없음"}

${content}`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const visualize = extractResult(text);
    return NextResponse.json({ visualize, usage: response.usage });
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: error.message, status: error.status },
        { status: error.status ?? 500 },
      );
    }
    return NextResponse.json(
      { error: "알 수 없는 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
