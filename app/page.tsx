"use client";

import { useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type RightTab = "qa" | "translate" | "stats" | "background";

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

type MedicalTerm = {
  english: string;
  korean: string;
  explanation: string;
  difficulty: "상" | "중";
};

type TranslationResult = {
  translation: string;
  terms: MedicalTerm[];
};

type StatItem = {
  metric: string;
  value: string;
  plain: string;
  interpretation: string;
  clinicalMeaning: string;
  importance: "핵심" | "보조";
  caution: string;
};

type StatisticsResult = {
  items: StatItem[];
  summary: string;
};

type BackgroundCard = {
  concept: string;
  summary: string;
  importance: string;
};

type BackgroundResult = {
  cards: BackgroundCard[];
};

type LoadedPaper = {
  paper: PubMedPaper;
  summary: StructuredSummary;
  translation?: TranslationResult;
  statistics?: StatisticsResult;
  background?: BackgroundResult;
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

  const [translateLoading, setTranslateLoading] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);

  // 논문(메타+초록)을 받아 요약 생성 후 상태에 적재 — PMID/DOI 경로와 PDF 경로가 공유
  async function summarizeAndLoad(paper: PubMedPaper) {
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
  }

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
      await summarizeAndLoad(pubmedData as PubMedPaper);
    } catch (e) {
      setPaperError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setPaperLoading(false);
    }
  }

  async function handlePdfUpload(file: File) {
    if (paperLoading) return;

    setPaperLoading(true);
    setPaperError(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const pdfRes = await fetch("/api/pdf", { method: "POST", body: form });
      const pdfData = await pdfRes.json();
      if (!pdfRes.ok) {
        throw new Error(pdfData.error ?? "PDF를 분석하지 못했습니다.");
      }
      await summarizeAndLoad(pdfData.paper as PubMedPaper);
    } catch (e) {
      setPaperError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setPaperLoading(false);
    }
  }

  async function handleTranslate(target: LoadedPaper) {
    if (target.translation || translateLoading) return;

    setTranslateLoading(true);
    setTranslateError(null);

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: target.paper.title,
          abstract: target.paper.abstract,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "번역 생성에 실패했습니다.");
      }

      const translation = data.translation as TranslationResult;
      const updated: LoadedPaper = { ...target, translation };
      setLoadedPaper(updated);
      setRecentPapers((prev) =>
        prev.map((p) => (p.paper.pmid === target.paper.pmid ? updated : p)),
      );
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setTranslateLoading(false);
    }
  }

  async function handleStatistics(target: LoadedPaper) {
    if (target.statistics || statsLoading) return;

    setStatsLoading(true);
    setStatsError(null);

    try {
      const res = await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: target.paper.title,
          abstract: target.paper.abstract,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "통계 해석 생성에 실패했습니다.");
      }

      const statistics = data.statistics as StatisticsResult;
      const updated: LoadedPaper = { ...target, statistics };
      setLoadedPaper(updated);
      setRecentPapers((prev) =>
        prev.map((p) => (p.paper.pmid === target.paper.pmid ? updated : p)),
      );
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setStatsLoading(false);
    }
  }

  async function handleBackground(target: LoadedPaper) {
    if (target.background || backgroundLoading) return;

    setBackgroundLoading(true);
    setBackgroundError(null);

    try {
      const res = await fetch("/api/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: target.paper.title,
          abstract: target.paper.abstract,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "배경지식 생성에 실패했습니다.");
      }

      const background = data.background as BackgroundResult;
      const updated: LoadedPaper = { ...target, background };
      setLoadedPaper(updated);
      setRecentPapers((prev) =>
        prev.map((p) => (p.paper.pmid === target.paper.pmid ? updated : p)),
      );
    } catch (e) {
      setBackgroundError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setBackgroundLoading(false);
    }
  }

  function handleTabChange(tab: RightTab) {
    setActiveTab(tab);
    if (tab === "translate" && loadedPaper && !loadedPaper.translation) {
      handleTranslate(loadedPaper);
    }
    if (tab === "stats" && loadedPaper && !loadedPaper.statistics) {
      handleStatistics(loadedPaper);
    }
    if (tab === "background" && loadedPaper && !loadedPaper.background) {
      handleBackground(loadedPaper);
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

          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-px bg-zinc-200" />
            <span className="text-xs text-zinc-400">또는</span>
            <div className="flex-1 h-px bg-zinc-200" />
          </div>

          <label
            className={`mt-3 flex items-center justify-center gap-2 w-full px-3 py-2 border border-dashed border-zinc-300 rounded-md text-sm text-zinc-600 transition-colors ${
              paperLoading
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:bg-zinc-50 hover:border-blue-400"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-4 h-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
              />
            </svg>
            PDF 업로드
            <input
              type="file"
              accept="application/pdf"
              disabled={paperLoading}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePdfUpload(file);
                e.target.value = "";
              }}
            />
          </label>

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
              onClick={() => handleTabChange("qa")}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === "qa"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              Q&A
            </button>
            <button
              onClick={() => handleTabChange("translate")}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === "translate"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              번역·설명
            </button>
            <button
              onClick={() => handleTabChange("stats")}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === "stats"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              통계 해석
            </button>
            <button
              onClick={() => handleTabChange("background")}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === "background"
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              배경지식
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

        {activeTab === "stats" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-zinc-400 mt-8">
                <p>통계 해석 탭</p>
                <p className="text-xs mt-2">
                  좌측에서 논문을 먼저 분석하세요
                </p>
              </div>
            ) : statsLoading ? (
              <div className="text-center text-sm text-zinc-400 mt-8 animate-pulse">
                통계 수치 해석 중입니다...
              </div>
            ) : statsError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                <div className="font-medium mb-1">오류</div>
                <div className="text-xs mb-2">{statsError}</div>
                <button
                  onClick={() => handleStatistics(loadedPaper)}
                  className="text-xs underline text-red-600 hover:text-red-700"
                >
                  다시 시도
                </button>
              </div>
            ) : loadedPaper.statistics ? (
              <div className="space-y-6">
                {loadedPaper.statistics.items.length > 0 ? (
                  <section>
                    <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                      통계 수치
                    </h3>
                    <ul className="space-y-3">
                      {loadedPaper.statistics.items.map((item, idx) => (
                        <li
                          key={`${item.metric}-${idx}`}
                          className="border border-zinc-200 rounded-md p-3 bg-zinc-50/60"
                        >
                          <div className="flex items-baseline gap-2 flex-wrap mb-2">
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                item.importance === "핵심"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-zinc-100 text-zinc-500"
                              }`}
                            >
                              {item.importance}
                            </span>
                            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                              {item.metric}
                            </span>
                            <span className="font-mono text-sm text-zinc-900">
                              {item.value}
                            </span>
                          </div>
                          {item.plain && (
                            <p className="text-xs text-zinc-700 leading-relaxed mb-2">
                              <span className="font-semibold text-zinc-600">
                                쉬운 설명:{" "}
                              </span>
                              {item.plain}
                            </p>
                          )}
                          <p className="text-xs text-zinc-700 leading-relaxed mb-2">
                            <span className="font-semibold text-zinc-600">
                              이 수치는:{" "}
                            </span>
                            {item.interpretation}
                          </p>
                          <p className="text-xs text-zinc-700 leading-relaxed">
                            <span className="font-semibold text-zinc-600">
                              임상적 함의:{" "}
                            </span>
                            {item.clinicalMeaning}
                          </p>
                          {item.caution && (
                            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 leading-relaxed">
                              ⚠ {item.caution}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {loadedPaper.statistics.summary && (
                  <section className="border-l-4 border-blue-500 bg-blue-50/40 rounded-r-md p-4">
                    <h3 className="text-sm font-semibold mb-2">종합</h3>
                    <p className="text-sm text-zinc-700 leading-relaxed">
                      {loadedPaper.statistics.summary}
                    </p>
                  </section>
                )}
              </div>
            ) : (
              <div className="text-center text-sm text-zinc-400 mt-8">
                통계 해석을 불러오는 중...
              </div>
            )}
          </div>
        )}

        {activeTab === "translate" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-zinc-400 mt-8">
                <p>번역·설명 탭</p>
                <p className="text-xs mt-2">
                  좌측에서 논문을 먼저 분석하세요
                </p>
              </div>
            ) : translateLoading ? (
              <div className="text-center text-sm text-zinc-400 mt-8 animate-pulse">
                의학 특화 번역 중입니다...
              </div>
            ) : translateError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                <div className="font-medium mb-1">오류</div>
                <div className="text-xs mb-2">{translateError}</div>
                <button
                  onClick={() => handleTranslate(loadedPaper)}
                  className="text-xs underline text-red-600 hover:text-red-700"
                >
                  다시 시도
                </button>
              </div>
            ) : loadedPaper.translation ? (
              <div className="space-y-6">
                <section>
                  <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                    한국어 번역
                  </h3>
                  <p className="text-sm text-zinc-800 leading-relaxed whitespace-pre-wrap">
                    {loadedPaper.translation.translation}
                  </p>
                </section>

                {loadedPaper.translation.terms.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                      핵심 의학용어
                    </h3>
                    <ul className="space-y-3">
                      {loadedPaper.translation.terms.map((term, idx) => (
                        <li
                          key={`${term.english}-${idx}`}
                          className="border border-zinc-200 rounded-md p-3 bg-zinc-50/60"
                        >
                          <div className="flex items-baseline gap-2 flex-wrap mb-1">
                            <span className="font-semibold text-sm text-zinc-900">
                              {term.korean}
                            </span>
                            <span className="text-xs text-zinc-500 italic">
                              {term.english}
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                term.difficulty === "상"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-zinc-100 text-zinc-500"
                              }`}
                            >
                              {term.difficulty}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-700 leading-relaxed">
                            {term.explanation}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            ) : (
              <div className="text-center text-sm text-zinc-400 mt-8">
                번역을 불러오는 중...
              </div>
            )}
          </div>
        )}

        {activeTab === "background" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-zinc-400 mt-8">
                <p>배경지식 탭</p>
                <p className="text-xs mt-2">
                  좌측에서 논문을 먼저 분석하세요
                </p>
              </div>
            ) : backgroundLoading ? (
              <div className="text-center text-sm text-zinc-400 mt-8 animate-pulse">
                논문을 읽기 위한 배경지식을 정리하는 중입니다...
              </div>
            ) : backgroundError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                <div className="font-medium mb-1">오류</div>
                <div className="text-xs mb-2">{backgroundError}</div>
                <button
                  onClick={() => handleBackground(loadedPaper)}
                  className="text-xs underline text-red-600 hover:text-red-700"
                >
                  다시 시도
                </button>
              </div>
            ) : loadedPaper.background ? (
              loadedPaper.background.cards.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-zinc-500 mb-1">
                    이 논문을 읽기 전에 알아두면 좋은 개념입니다.
                  </p>
                  {loadedPaper.background.cards.map((card, idx) => (
                    <section
                      key={`${card.concept}-${idx}`}
                      className="border border-zinc-200 rounded-md p-3 bg-zinc-50/60"
                    >
                      <h3 className="font-semibold text-sm text-zinc-900 mb-1">
                        {card.concept}
                      </h3>
                      <p className="text-xs text-zinc-700 leading-relaxed mb-2">
                        {card.summary}
                      </p>
                      <p className="text-xs text-blue-700 leading-relaxed">
                        <span className="font-semibold">왜 필요한가: </span>
                        {card.importance}
                      </p>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="text-center text-sm text-zinc-400 mt-8">
                  생성된 배경지식 카드가 없습니다.
                </div>
              )
            ) : (
              <div className="text-center text-sm text-zinc-400 mt-8">
                배경지식을 불러오는 중...
              </div>
            )}
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
