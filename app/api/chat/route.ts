import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const client = new Anthropic();

type HistoryMessage = { role: "user" | "assistant"; text: string };

type PaperContext = {
  title: string;
  abstract: string;
  fullText?: string;
};

export async function POST(request: Request) {
  try {
    const { message, paper, history } = (await request.json()) as {
      message: string;
      paper?: PaperContext | null;
      history?: HistoryMessage[];
    };

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "message 필드가 필요합니다." },
        { status: 400 },
      );
    }

    let systemPrompt: string;

    if (paper) {
      const content = paper.fullText || paper.abstract;
      systemPrompt = `당신은 의학 논문 전문 QA 어시스턴트입니다. 아래 논문만을 근거로 질문에 답하세요.

## 논문
제목: ${paper.title}

${content}

## 답변 규칙
1. 반드시 위 논문에 기술된 내용만 바탕으로 답변하세요.
2. 논문에 없는 내용을 묻는다면 "이 논문에 없습니다"라고 명시하세요.
3. 답변 시 출처 섹션을 [Abstract], [Methods], [Results], [Discussion], [Table N] 등으로 표기하세요.
4. 한국어로 답변하되 의학용어는 영어 원어를 병기하세요.
5. 의대 저학년과 논문 초심자가 이해할 수 있도록 친절하게 설명하세요.`;
    } else {
      systemPrompt =
        "당신은 의학 논문 학습을 돕는 한국어 AI 튜터입니다. 의대 저학년과 의학논문 초심자를 위해 친절하고 명확하게 답변하세요. 의학용어는 한국어 설명과 함께 영어 원어를 병기합니다.";
    }

    const messages: Anthropic.MessageParam[] = [
      ...(history ?? []).map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.text,
      })),
      { role: "user", content: message },
    ];

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return NextResponse.json({
      text,
      usage: response.usage,
      stop_reason: response.stop_reason,
    });
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
