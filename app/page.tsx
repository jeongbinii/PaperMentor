"use client";

import { useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type RightTab = "qa" | "translate";

type PubMedPaper = {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  pubdate: string;
  doi: string | null;
};

type StructuredSummary = {
  background: string;
  methods: string;
  results: string;
  conclusion: string;
  keyMessage: string;
};

type LoadedPaper = {
  paper: PubMedPaper;
  summary: StructuredSummary;
};

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<RightTab>("qa");

  const [paperLoading, setPaperLoading] = useState(false);
  const [paperError, setPaperError] = useState<string | null>(null);
  const [loadedPaper, setLoadedPaper] = useState<LoadedPaper | null>(null);
  const [recentPapers, setRecentPapers] = useState<LoadedPaper[]>([]);

  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyzePaper(queryOverride?: string) {
    const raw = (queryOverride ?? searchQuery).trim();
    if (!raw || paperLoading) return;

    setPaperLoading(true);
    setPaperError(null);

    try {
      const pubmedRes = await fetch("/api/pubmed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: raw }),
      });
      const pubmedData = await pubmedRes.json();
      if (!pubmedRes.ok) {
        throw new Error(pubmedData.error ?? "논문을 불러오지 못했습니다.");
      }
      const paper = pubmedData as PubMedPaper;

      const summaryRes = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: paper.title,
          abstract: paper.abstract,
        }),
      });
      const summaryData = await summaryRes.json();
      if (!summaryRes.ok) {
        throw new Error(summaryData.error ?? "요약 생성에 실패했습니다.");
      }

      const loaded: LoadedPaper = {
        paper,
        summary: summaryData.summary as StructuredSummary,
      };
      setLoadedPaper(loaded);
      setRecentPapers((prev) => {
        const without = prev.filter((p) => p.paper.pmid !== paper.pmid);
        return [loaded, ...without].slice(0, 10);
      });
    } catch (e) {
      setPaperError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setPaperLoading(false);
    }
  }

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
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAnalyzePaper();
              }
            }}
            placeholder="PubMed ID 또는 DOI"
            disabled={paperLoading}
            className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-zinc-100"
          />
          <button
            onClick={() => handleAnalyzePaper()}
            disabled={paperLoading || !searchQuery.trim()}
            className="mt-2 w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:bg-zinc-300 disabled:cursor-not-allowed transition-colors"
          >
            {paperLoading ? "분석 중..." : "분석"}
          </button>
          {paperError && (
            <div className="mt-2 bg-red-50 border border-red-200 text-red-700 rounded-md p-2 text-xs">
              {paperError}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
            최근 분석 논문
          </h3>
          {recentPapers.length === 0 ? (
            <p className="text-xs text-zinc-400">
              PubMed ID나 DOI를 입력하면 여기에 추가됩니다.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentPapers.map((item) => (
                <li key={item.paper.pmid}>
                  <button
                    onClick={() => setLoadedPaper(item)}
                    className={`w-full text-left p-2 text-sm rounded-md transition-colors ${
                      loadedPaper?.paper.pmid === item.paper.pmid
                        ? "bg-blue-50 text-blue-900 border border-blue-200"
                        : "hover:bg-zinc-100 text-zinc-700"
                    }`}
                  >
                    <div className="font-medium line-clamp-2">
                      {item.paper.title}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      PMID: {item.paper.pmid}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col bg-white border-r border-zinc-200 overflow-hidden">
        <div className="p-6 border-b border-zinc-200">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
            논문 요약
          </h2>
          {loadedPaper && (
            <div className="mt-2">
              <h1 className="text-lg font-semibold text-zinc-900 leading-snug">
                {loadedPaper.paper.title}
              </h1>
              <p className="text-xs text-zinc-500 mt-1">
                {loadedPaper.paper.journal}
                {loadedPaper.paper.pubdate &&
                  ` · ${loadedPaper.paper.pubdate}`}
                {` · PMID ${loadedPaper.paper.pmid}`}
                {loadedPaper.paper.doi && ` · DOI ${loadedPaper.paper.doi}`}
              </p>
              {loadedPaper.paper.authors.length > 0 && (
                <p className="text-xs text-zinc-500 mt-1 line-clamp-1">
                  {loadedPaper.paper.authors.slice(0, 6).join(", ")}
                  {loadedPaper.paper.authors.length > 6 && " 외"}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {paperLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-2">
              <div className="animate-pulse text-sm">
                논문을 불러오고 Claude로 요약 중입니다...
              </div>
            </div>
          ) : loadedPaper ? (
            <div className="space-y-6">
              <SummarySection
                title="연구 배경"
                body={loadedPaper.summary.background}
              />
              <SummarySection
                title="연구 방법"
                body={loadedPaper.summary.methods}
              />
              <SummarySection
                title="주요 결과"
                body={loadedPaper.summary.results}
              />
              <SummarySection
                title="결론"
                body={loadedPaper.summary.conclusion}
              />
              <SummarySection
                title="핵심 메시지"
                body={loadedPaper.summary.keyMessage}
                accent
              />
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
              <p className="text-sm">좌측에 PubMed ID나 DOI를 입력하세요</p>
              <p className="text-xs mt-1 text-zinc-400">
                예) PMID: 37291234 / DOI: 10.1056/NEJMoa2034577
              </p>
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
              <p className="text-xs mt-2">논문 선택 후 활성화 (추후 구현)</p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function SummarySection({
  title,
  body,
  accent,
}: {
  title: string;
  body: string;
  accent?: boolean;
}) {
  return (
    <section
      className={
        accent
          ? "border-l-4 border-blue-500 bg-blue-50/40 rounded-r-md p-4"
          : undefined
      }
    >
      <h3 className="text-base font-semibold mb-2">{title}</h3>
      <p className="text-zinc-700 leading-relaxed text-sm whitespace-pre-wrap">
        {body || "본문에 명시되어 있지 않습니다."}
      </p>
    </section>
  );
}
