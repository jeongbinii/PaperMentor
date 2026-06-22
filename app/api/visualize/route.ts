import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

type VisualizeResult = {
  mermaid: string;
  description: string;
};

function extractResult(text: string): VisualizeResult {
  // Mermaid 코드블록 추출
  const fenceMatch = text.match(/```mermaid\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const mermaid = fenceMatch[1].trim();
    const description = text.replace(/```mermaid[\s\S]*?```/, "").trim();
    return { mermaid, description };
  }
  // 코드블록 없이 바로 mermaid 구문이 나온 경우
  const lines = text.trim().split("\n");
  const start = lines.findIndex((l) =>
    /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|mindmap)/i.test(
      l.trim(),
    ),
  );
  if (start !== -1) {
    return { mermaid: lines.slice(start).join("\n").trim(), description: "" };
  }
  throw new Error("Mermaid 다이어그램 코드를 찾지 못했습니다.");
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

    // 프롬프트 수정으로 다이어그램 타입/구조 변경 가능
    const systemPrompt = `당신은 의학 논문의 연구 구조를 Mermaid 다이어그램으로 시각화하는 전문가입니다.
논문 내용을 분석해 연구 흐름을 보여주는 flowchart를 생성하세요.

출력 형식:
1. 첫 줄에 \`\`\`mermaid 로 시작하는 코드블록으로 Mermaid 코드만 출력
2. 코드블록 이후에 한 줄 설명 (한국어)

다이어그램 작성 규칙:
- flowchart TD (위→아래) 형식 사용
- 노드 텍스트는 한국어로 간결하게 (최대 20자)
- 주요 단계: 연구 목적 → 연구 설계 → 대상/방법 → 주요 결과 → 결론
- 노드 ID는 영문 알파벳만 사용 (예: A, B, C 또는 obj, design, result)
- 노드 레이블에 특수문자(괄호, 따옴표 등) 최소화
- 화살표 레이블은 짧게 (5자 이내)
- 전체 노드 수 8개 이하로 제한`;

    const userContent = `제목: ${title ?? "정보 없음"}

${content}`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: systemPrompt,
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
