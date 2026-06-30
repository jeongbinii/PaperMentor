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

export type GANode = {
  id: string;
  label: string;
  kind: "molecule" | "process" | "phenotype";
};

export type GAEdge = {
  from: string;
  to: string;
  effect: "activate" | "inhibit" | "lead";
  label: string;
};

export type GAPathway = {
  nodes: GANode[];
  edges: GAEdge[];
};

export type GraphicalAbstract = {
  headline: string;
  studyType: string;
  population: string;
  intervention: string;
  comparison: string;
  pathway: GAPathway;
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
- intervention: 중재 또는 노출이 무엇인지(예: "SGLT2 억제제 추가 투여", 노출이면 "흡연력").
- comparison: 비교 대상(예: "위약"). 비교군이 없는 설계(증례보고·단면·일부 기전연구)면 빈 문자열 "".
- outcomes[].metric: 결과 지표 이름. value: 핵심 수치를 본문 표기 그대로. detail: CI·p값 등 보조 수치(없으면 ""). direction: 연구 대상에게 유리=benefit, 불리=harm, 차이 없음/유의하지 않음/불확실=neutral(신뢰구간이 귀무값[비율 1, 차이 0] 포함 시 neutral). primary: 일차결과면 true.
- conclusion: 임상적·생물학적 의미 한 문장(so-what). 과대 일반화·직접 권고 금지.

[기전 도식 — pathway, 기전·기초연구에서 특히 중요]
논문이 신호전달 경로·작용기전(MoA)·병태생리 같은 "인과 사슬"을 기술하면, 그 핵심 축을 작은 방향 그래프로 만듭니다. 이 그림이 독자가 "무엇이 무엇을 활성/억제하는가"를 한눈에 보게 하는 핵심입니다.
- nodes: 인과 사슬의 핵심 요소 2~6개. id는 짧은 영문/숫자(예: "n1","hif2a"). label은 표시용 이름(분자명은 영어 약어 그대로, 과정·표현형은 한국어). kind는 "molecule"(단백질·유전자·약물·분자), "process"(세포 과정: 세포사멸·자가포식·염증 등), "phenotype"(표현형·질환 결과: 골관절염 진행 등) 중 하나.
- nodes는 반드시 인과 흐름 순서대로(상류 → 하류) 배열합니다.
- edges: 인접한 두 요소의 관계. from·to는 node id. effect는 "activate"(활성/촉진/유도), "inhibit"(억제/감소), "lead"(귀결: ~로 이어짐) 중 하나. label은 관계를 한 단어로(예: "억제","유도","악화","활성"), 없으면 "". 방향을 정확히: 논문이 "A가 B를 억제한다"고 하면 from=A,to=B,effect=inhibit.
- 핵심 축만 담습니다(곁가지·세부 분자 나열 금지, 최대 6노드). 본문이 명시한 방향만 사용하고 지어내지 않습니다.
- 임상시험·역학·진단 등 분자 기전 사슬이 본문에 없으면 nodes·edges를 빈 배열 []로 둡니다.

공통 규칙:
- 본문에 명시된 내용·수치만 사용합니다. 수치를 지어내지 마십시오. 임의 반올림·단위 변경 금지.
- 모든 텍스트는 한국어(분자·유전자·약물명은 영어 약어 허용).

반드시 아래 JSON 객체만 출력하세요. 주석·코드블록 표시(\`\`\`)·다른 설명 없이 JSON만 출력합니다.
{
  "headline": "결론을 평이하게 한 문장",
  "studyType": "연구 유형",
  "population": "연구 대상과 규모",
  "intervention": "중재 또는 노출",
  "comparison": "비교 대상 (없으면 \\"\\")",
  "pathway": {
    "nodes": [ { "id": "n1", "label": "HIF-2α", "kind": "molecule" } ],
    "edges": [ { "from": "n1", "to": "n2", "effect": "inhibit", "label": "억제" } ]
  },
  "outcomes": [
    { "metric": "결과 지표", "value": "핵심 수치", "detail": "CI·p값 등 (없으면 \\"\\")", "direction": "benefit | harm | neutral", "primary": true }
  ],
  "conclusion": "임상적·생물학적 의미 한 문장"
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

  const rawPath = parsed.pathway ?? { nodes: [], edges: [] };
  const nodes: GANode[] = Array.isArray(rawPath.nodes)
    ? rawPath.nodes
        .filter((n) => n && typeof n.id === "string" && typeof n.label === "string")
        .slice(0, 6)
        .map((n) => ({
          id: str(n.id),
          label: str(n.label),
          kind:
            n.kind === "molecule" || n.kind === "process" || n.kind === "phenotype"
              ? n.kind
              : "molecule",
        }))
    : [];
  const ids = new Set(nodes.map((n) => n.id));
  const coerceEffect = (effect: unknown, label: string): GAEdge["effect"] => {
    if (effect === "activate" || effect === "inhibit") return effect;
    // effect가 모호(lead 등)할 때, 명확한 한국어 라벨로 방향을 보정
    if (/억제|저해|감소|차단|불활성|하향/.test(label)) return "inhibit";
    if (/촉진|유도|활성|증가|상향|발현/.test(label)) return "activate";
    return "lead";
  };
  const edges: GAEdge[] = Array.isArray(rawPath.edges)
    ? rawPath.edges
        .filter((e) => e && ids.has(e.from) && ids.has(e.to))
        .map((e) => ({
          from: str(e.from),
          to: str(e.to),
          effect: coerceEffect(e.effect, str(e.label)),
          label: str(e.label),
        }))
    : [];

  return {
    headline: str(parsed.headline),
    studyType: str(parsed.studyType),
    population: str(parsed.population),
    intervention: str(parsed.intervention),
    comparison: str(parsed.comparison),
    pathway: { nodes, edges },
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
      max_tokens: 2560,
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
