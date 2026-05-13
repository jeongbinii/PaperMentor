"use client";

import { useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type RightTab = "qa" | "translate";

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPaper, setSelectedPaper] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RightTab>("qa");

  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mockRecentPapers = [
    { id: "37291234", title: "Statin therapy and cardiovascular outcomes" },
    { id: "36789012", title: "Machine learning in radiology: a systematic review" },
    { id: "35234567", title: "GLP-1 receptor agonists in type 2 diabetes" },
  ];

  async function handleSendMessage() {
    const trimmed = chatInput.trim();
    if (!trimmed || isLoading) return;

    const userMessage: ChatMessage = { role: "user", text: trimmed };
    setChatHistory((prev) => [...prev, userMessage]);
    setChatInput("");
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "API 호출 실패");
      }

      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", text: data.text },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-1 h-screen bg-zinc-50 text-zinc-900">
      <aside className="w-1/5 min-w-60 border-r border-zinc-200 bg-white flex flex-col">
        <div className="p-4 border-b border-zinc-200">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            논문 검색
          </h2>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="PubMed ID, DOI, 키워드"
            className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
            최근 분석 논문
          </h3>
          <ul className="space-y-2">
            {mockRecentPapers.map((paper) => (
              <li key={paper.id}>
                <button
                  onClick={() => setSelectedPaper(paper.id)}
                  className={`w-full text-left p-2 text-sm rounded-md transition-colors ${
                    selectedPaper === paper.id
                      ? "bg-blue-50 text-blue-900 border border-blue-200"
                      : "hover:bg-zinc-100 text-zinc-700"
                  }`}
                >
                  <div className="font-medium line-clamp-2">{paper.title}</div>
                  <div className="text-xs text-zinc-500 mt-1">
                    PMID: {paper.id}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex-1 flex flex-col bg-white border-r border-zinc-200 overflow-hidden">
        <div className="p-6 border-b border-zinc-200">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
            논문 요약
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {selectedPaper ? (
            <div className="space-y-6">
              <section>
                <h3 className="text-lg font-semibold mb-2">연구 배경</h3>
                <p className="text-zinc-700 leading-relaxed">
                  선택한 논문 (PMID: {selectedPaper})의 구조화 요약이 여기에
                  표시됩니다. 실제 구현에서는 PubMed API로 본문을 가져와 Claude
                  API로 요약합니다.
                </p>
              </section>
              <section>
                <h3 className="text-lg font-semibold mb-2">연구 방법</h3>
                <p className="text-zinc-700 leading-relaxed text-sm">
                  Placeholder: 연구 설계, 표본수, 통계 방법 등이 요약됩니다.
                </p>
              </section>
              <section>
                <h3 className="text-lg font-semibold mb-2">주요 결과</h3>
                <p className="text-zinc-700 leading-relaxed text-sm">
                  Placeholder: 주요 결과와 효과 크기가 요약됩니다.
                </p>
              </section>
              <section>
                <h3 className="text-lg font-semibold mb-2">결론</h3>
                <p className="text-zinc-700 leading-relaxed text-sm">
                  Placeholder: 임상적 함의와 결론이 요약됩니다.
                </p>
              </section>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-16 h-16 mb-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
              <p className="text-sm">좌측에서 논문을 선택하세요</p>
            </div>
          )}
        </div>
      </main>

      <aside className="w-[30%] min-w-90 bg-white flex flex-col">
        <div className="border-b border-zinc-200">
          <div className="flex">
            <button
              onClick={() => setActiveTab("qa")}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === "qa"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              Q&A
            </button>
            <button
              onClick={() => setActiveTab("translate")}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === "translate"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              번역·설명
            </button>
          </div>
        </div>

        {activeTab === "qa" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatHistory.length === 0 && !error && (
                <div className="text-center text-sm text-zinc-400 mt-8">
                  <p className="mb-2">Claude API 연결 테스트</p>
                  <p className="text-xs">
                    아래에 질문을 입력해 Claude와 대화해보세요.
                  </p>
                </div>
              )}
              {chatHistory.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-zinc-100 text-zinc-900"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-100 text-zinc-500 rounded-lg px-3 py-2 text-sm">
                    응답 생성 중...
                  </div>
                </div>
              )}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                  <div className="font-medium mb-1">오류</div>
                  <div className="text-xs">{error}</div>
                </div>
              )}
            </div>
            <div className="border-t border-zinc-200 p-3">
              <div className="flex gap-2">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Claude에게 질문하기 (Enter 전송)"
                  rows={2}
                  className="flex-1 px-3 py-2 text-sm border border-zinc-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={isLoading}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={isLoading || !chatInput.trim()}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:bg-zinc-300 disabled:cursor-not-allowed transition-colors"
                >
                  전송
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "translate" && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="text-center text-sm text-zinc-400 mt-8">
              <p>번역·설명 탭</p>
              <p className="text-xs mt-2">
                논문 선택 후 활성화 (추후 구현)
              </p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
