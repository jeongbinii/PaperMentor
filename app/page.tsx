"use client";

import { useState, useEffect, useRef } from "react";
import GraphicalAbstract from "./components/GraphicalAbstract";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type RightTab = "background" | "translate" | "stats" | "qa" | "reliability" | "quiz" | "visualize";

type PubMedPaper = {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  pubdate: string;
  doi: string | null;
  fullText?: string;
};

type KeyFinding = {
  claim: string;
  evidence: string;
};

type StructuredSummary = {
  keyFindings: KeyFinding[];
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

type ReliabilityCard = {
  category: string;
  value: string;
  interpretation: string;
  level: "높음" | "보통" | "낮음" | "정보없음";
};

type ReliabilityResult = {
  cards: ReliabilityCard[];
  overall: string;
};

type QuizQuestion = {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
};

type QuizResult = {
  questions: QuizQuestion[];
};

type VisualizeOutcome = {
  metric: string;
  value: string;
  detail: string;
  direction: "benefit" | "harm" | "neutral";
  primary: boolean;
};

type VisualizeNode = {
  id: string;
  label: string;
  kind: "molecule" | "process" | "phenotype";
};

type VisualizeEdge = {
  from: string;
  to: string;
  effect: "activate" | "inhibit" | "lead";
  label: string;
};

type VisualizeResult = {
  headline: string;
  studyType: string;
  population: string;
  intervention: string;
  comparison: string;
  pathway: { nodes: VisualizeNode[]; edges: VisualizeEdge[] };
  outcomes: VisualizeOutcome[];
  conclusion: string;
};

type LoadedPaper = {
  paper: PubMedPaper;
  summary: StructuredSummary;
  translation?: TranslationResult;
  statistics?: StatisticsResult;
  background?: BackgroundResult;
  reliability?: ReliabilityResult;
  quiz?: QuizResult;
  visualize?: VisualizeResult;
  geminiImage?: string;
};

export default function Home() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<RightTab>("background");

  const [paperLoading, setPaperLoading] = useState(false);
  const [paperError, setPaperError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 3분할 패널 너비 (px) — 가운데(main)는 flex-1로 나머지 차지
  const [leftW, setLeftW] = useState(288);
  const [rightW, setRightW] = useState(440);
  const resizingRef = useRef<null | "left" | "right">(null);

  useEffect(() => {
    const MIN_LEFT = 200;
    const MIN_RIGHT = 320;
    const MIN_CENTER = 360;
    function onMove(e: MouseEvent) {
      const side = resizingRef.current;
      if (!side) return;
      const total = window.innerWidth;
      if (side === "left") {
        const max = total - rightW - MIN_CENTER;
        setLeftW(Math.max(MIN_LEFT, Math.min(e.clientX, max)));
      } else {
        const max = total - leftW - MIN_CENTER;
        setRightW(Math.max(MIN_RIGHT, Math.min(total - e.clientX, max)));
      }
    }
    function onUp() {
      if (!resizingRef.current) return;
      resizingRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [leftW, rightW]);

  function startResize(side: "left" | "right") {
    resizingRef.current = side;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }
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

  const [reliabilityLoading, setReliabilityLoading] = useState(false);
  const [reliabilityError, setReliabilityError] = useState<string | null>(null);

  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});

  const [visualizeLoading, setVisualizeLoading] = useState(false);
  const [visualizeError, setVisualizeError] = useState<string | null>(null);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [imageProvider, setImageProvider] = useState<
    "gemini" | "openai" | "flux" | "ideogram"
  >("gemini");

  // 논문(메타+초록)을 받아 요약 생성 후 상태에 적재 — PMID/DOI 경로와 PDF 경로가 공유
  async function summarizeAndLoad(paper: PubMedPaper) {
    const summaryRes = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: paper.title,
        abstract: paper.abstract,
        fullText: paper.fullText,
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
    setChatHistory([]);
    setQuizAnswers({});
    setActiveTab("background");
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

  function acceptPdfFile(file: File | undefined | null) {
    if (!file) return;
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setPaperError("PDF 파일만 업로드할 수 있습니다.");
      return;
    }
    handlePdfUpload(file);
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
      const summaryContext = target.summary
        ? `연구설계·방법: ${target.summary.methods}\n주요 결과: ${target.summary.results}\n핵심: ${target.summary.keyMessage}`
        : undefined;
      const res = await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: target.paper.title,
          abstract: target.paper.abstract,
          fullText: target.paper.fullText,
          summaryContext,
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
          fullText: target.paper.fullText,
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

  async function handleReliability(target: LoadedPaper) {
    if (target.reliability || reliabilityLoading) return;
    setReliabilityLoading(true);
    setReliabilityError(null);
    try {
      const res = await fetch("/api/reliability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: target.paper.title,
          abstract: target.paper.abstract,
          journal: target.paper.journal,
          authors: target.paper.authors,
          pubdate: target.paper.pubdate,
          doi: target.paper.doi,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "신뢰도 분석에 실패했습니다.");
      const reliability = data.reliability as ReliabilityResult;
      const updated: LoadedPaper = { ...target, reliability };
      setLoadedPaper(updated);
      setRecentPapers((prev) =>
        prev.map((p) => (p.paper.pmid === target.paper.pmid ? updated : p)),
      );
    } catch (e) {
      setReliabilityError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setReliabilityLoading(false);
    }
  }

  async function handleQuiz(target: LoadedPaper) {
    if (target.quiz || quizLoading) return;
    setQuizLoading(true);
    setQuizError(null);
    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: target.paper.title,
          abstract: target.paper.abstract,
          fullText: target.paper.fullText,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "퀴즈 생성에 실패했습니다.");
      const quiz = data.quiz as QuizResult;
      const updated: LoadedPaper = { ...target, quiz };
      setLoadedPaper(updated);
      setRecentPapers((prev) =>
        prev.map((p) => (p.paper.pmid === target.paper.pmid ? updated : p)),
      );
    } catch (e) {
      setQuizError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setQuizLoading(false);
    }
  }

  async function handleVisualize(target: LoadedPaper) {
    if (target.visualize || visualizeLoading) return;
    setVisualizeLoading(true);
    setVisualizeError(null);
    try {
      const res = await fetch("/api/visualize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: target.paper.title,
          abstract: target.paper.abstract,
          fullText: target.paper.fullText,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "시각화 생성에 실패했습니다.");
      const visualize = data.visualize as VisualizeResult;
      const updated: LoadedPaper = { ...target, visualize };
      setLoadedPaper(updated);
      setRecentPapers((prev) =>
        prev.map((p) => (p.paper.pmid === target.paper.pmid ? updated : p)),
      );
    } catch (e) {
      setVisualizeError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setVisualizeLoading(false);
    }
  }

  async function handleGenerateImage(target: LoadedPaper) {
    if (geminiLoading) return;
    setGeminiLoading(true);
    setGeminiError(null);
    try {
      const res = await fetch("/api/visualize-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: imageProvider,
          title: target.paper.title,
          keyFindings: target.summary.keyFindings,
          methods: target.summary.methods,
          results: target.summary.results,
          conclusion: target.summary.conclusion,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "이미지 생성에 실패했습니다.");
      const updated: LoadedPaper = { ...target, geminiImage: data.image as string };
      setLoadedPaper(updated);
      setRecentPapers((prev) =>
        prev.map((p) => (p.paper.pmid === target.paper.pmid ? updated : p)),
      );
    } catch (e) {
      setGeminiError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setGeminiLoading(false);
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
    if (tab === "reliability" && loadedPaper && !loadedPaper.reliability) {
      handleReliability(loadedPaper);
    }
    if (tab === "quiz" && loadedPaper && !loadedPaper.quiz) {
      handleQuiz(loadedPaper);
    }
    if (tab === "visualize" && loadedPaper && !loadedPaper.visualize) {
      handleVisualize(loadedPaper);
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
        body: JSON.stringify({
          message: trimmed,
          paper: loadedPaper?.paper ?? null,
          history: chatHistory,
        }),
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
      <aside
        style={{ width: leftW }}
        className="shrink-0 border-r border-zinc-200 bg-white flex flex-col overflow-hidden"
      >
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
            onDragOver={(e) => {
              e.preventDefault();
              if (!paperLoading) setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (paperLoading) return;
              acceptPdfFile(e.dataTransfer.files?.[0]);
            }}
            className={`mt-3 flex flex-col items-center justify-center gap-1 w-full px-3 py-4 border border-dashed rounded-md text-sm transition-colors ${
              paperLoading
                ? "cursor-not-allowed opacity-60 border-zinc-300 text-zinc-600"
                : isDragging
                  ? "cursor-copy border-blue-500 bg-blue-50 text-blue-700"
                  : "cursor-pointer border-zinc-300 text-zinc-600 hover:bg-zinc-50 hover:border-blue-400"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
              />
            </svg>
            <span className="font-medium">
              {isDragging ? "여기에 놓으세요" : "PDF 업로드"}
            </span>
            <span className="text-xs text-zinc-400">
              클릭하거나 파일을 끌어다 놓기
            </span>
            <input
              type="file"
              accept="application/pdf"
              disabled={paperLoading}
              className="hidden"
              onChange={(e) => {
                acceptPdfFile(e.target.files?.[0]);
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
                    onClick={() => {
                      setLoadedPaper(item);
                      setChatHistory([]);
                      setQuizAnswers({});
                      setActiveTab("background");
                    }}
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

      <div
        onMouseDown={() => startResize("left")}
        className="w-1.5 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-blue-400 active:bg-blue-500 transition-colors"
        title="드래그하여 너비 조절"
      />

      <main className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden">
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
              {loadedPaper.summary.keyFindings?.length > 0 && (
                <section>
                  <h3 className="text-base font-semibold mb-2">핵심 결과</h3>
                  <ul className="space-y-2">
                    {loadedPaper.summary.keyFindings.map((f, idx) => (
                      <li
                        key={idx}
                        className="border-l-4 border-blue-500 bg-blue-50/40 rounded-r-md p-3"
                      >
                        <p className="text-sm font-semibold text-zinc-900 mb-1">
                          {f.claim}
                        </p>
                        <p className="text-xs text-zinc-700 leading-relaxed">
                          <span className="font-semibold text-zinc-600">
                            근거:{" "}
                          </span>
                          {f.evidence}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
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

      <div
        onMouseDown={() => startResize("right")}
        className="w-1.5 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-blue-400 active:bg-blue-500 transition-colors"
        title="드래그하여 너비 조절"
      />

      <aside
        style={{ width: rightW }}
        className="shrink-0 border-l border-zinc-200 bg-white flex flex-col overflow-hidden"
      >
        <div className="border-b border-zinc-200">
          <div className="flex overflow-x-auto scrollbar-none">
            {(
              [
                { key: "background", label: "배경지식" },
                { key: "translate", label: "번역·설명" },
                { key: "stats", label: "통계" },
                { key: "qa", label: "Q&A" },
                { key: "reliability", label: "신뢰도" },
                { key: "quiz", label: "퀴즈" },
                { key: "visualize", label: "시각화" },
              ] as { key: RightTab; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                disabled={!loadedPaper}
                className={`shrink-0 px-3 py-3 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  activeTab === key
                    ? "text-blue-600 border-b-2 border-blue-600"
                    : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "qa" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatHistory.length === 0 && !error && (
                <div className="text-center text-sm text-zinc-400 mt-8">
                  {loadedPaper ? (
                    <>
                      <p className="mb-2 font-medium text-zinc-500">논문 QA</p>
                      <p className="text-xs">
                        논문 내용에 대해 질문하세요.
                        <br />
                        논문에 없는 내용은 &quot;이 논문에 없습니다&quot;로 답변합니다.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mb-2">논문을 먼저 불러오세요</p>
                      <p className="text-xs">
                        논문 로드 후 해당 논문에 대해 질문할 수 있습니다.
                      </p>
                    </>
                  )}
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
                  placeholder={loadedPaper ? "논문에 대해 질문하기 (Enter 전송)" : "논문을 먼저 불러오세요"}
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

        {activeTab === "reliability" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-zinc-400 mt-8">
                <p>신뢰도 탭</p>
                <p className="text-xs mt-2">좌측에서 논문을 먼저 분석하세요</p>
              </div>
            ) : reliabilityLoading ? (
              <div className="text-center text-sm text-zinc-400 mt-8 animate-pulse">
                논문 신뢰도를 분석하는 중입니다...
              </div>
            ) : reliabilityError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                <div className="font-medium mb-1">오류</div>
                <div className="text-xs mb-2">{reliabilityError}</div>
                <button
                  onClick={() => handleReliability(loadedPaper)}
                  className="text-xs underline text-red-600 hover:text-red-700"
                >
                  다시 시도
                </button>
              </div>
            ) : loadedPaper.reliability ? (
              <div className="space-y-4">
                <ul className="space-y-3">
                  {loadedPaper.reliability.cards.map((card, idx) => (
                    <li
                      key={idx}
                      className="border border-zinc-200 rounded-md p-3 bg-zinc-50/60"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                          {card.category}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            card.level === "높음"
                              ? "bg-green-100 text-green-700"
                              : card.level === "보통"
                                ? "bg-yellow-100 text-yellow-700"
                                : card.level === "낮음"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {card.level}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-zinc-900 mb-1">
                        {card.value}
                      </p>
                      <p className="text-xs text-zinc-600 leading-relaxed">
                        {card.interpretation}
                      </p>
                    </li>
                  ))}
                </ul>
                {loadedPaper.reliability.overall && (
                  <section className="border-l-4 border-blue-500 bg-blue-50/40 rounded-r-md p-4">
                    <h3 className="text-sm font-semibold mb-2">종합 평가</h3>
                    <p className="text-sm text-zinc-700 leading-relaxed">
                      {loadedPaper.reliability.overall}
                    </p>
                  </section>
                )}
              </div>
            ) : (
              <div className="text-center text-sm text-zinc-400 mt-8">
                신뢰도 분석을 불러오는 중...
              </div>
            )}
          </div>
        )}

        {activeTab === "quiz" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-zinc-400 mt-8">
                <p>퀴즈 탭</p>
                <p className="text-xs mt-2">좌측에서 논문을 먼저 분석하세요</p>
              </div>
            ) : quizLoading ? (
              <div className="text-center text-sm text-zinc-400 mt-8 animate-pulse">
                논문 기반 퀴즈를 생성하는 중입니다...
              </div>
            ) : quizError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                <div className="font-medium mb-1">오류</div>
                <div className="text-xs mb-2">{quizError}</div>
                <button
                  onClick={() => handleQuiz(loadedPaper)}
                  className="text-xs underline text-red-600 hover:text-red-700"
                >
                  다시 시도
                </button>
              </div>
            ) : loadedPaper.quiz ? (
              <div className="space-y-1">
                <p className="text-xs text-zinc-500 mb-3">
                  선택지를 클릭하면 즉시 채점됩니다. &nbsp;
                  {Object.keys(quizAnswers).length > 0 && (
                    <span className="font-semibold text-zinc-700">
                      {Object.keys(quizAnswers).length}/{loadedPaper.quiz.questions.length}문제 완료 &nbsp;·&nbsp;
                      {Object.entries(quizAnswers).filter(([i, a]) => a === loadedPaper.quiz!.questions[Number(i)].answer).length}개 정답
                    </span>
                  )}
                </p>
                {loadedPaper.quiz.questions.map((q, qi) => {
                  const selected = quizAnswers[qi];
                  const answered = selected !== undefined;
                  const correct = answered && selected === q.answer;
                  return (
                    <section
                      key={qi}
                      className="border border-zinc-200 rounded-md p-3 bg-zinc-50/60 mb-3"
                    >
                      <p className="text-sm font-medium text-zinc-900 mb-3">
                        <span className="text-zinc-400 mr-1">Q{qi + 1}.</span>
                        {q.question}
                      </p>
                      <ul className="space-y-1.5">
                        {q.options.map((opt, oi) => {
                          let style =
                            "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100";
                          if (answered) {
                            if (oi === q.answer)
                              style =
                                "border border-green-400 bg-green-50 text-green-800 font-medium";
                            else if (oi === selected)
                              style =
                                "border border-red-300 bg-red-50 text-red-700";
                            else style = "border border-zinc-200 bg-white text-zinc-400";
                          }
                          return (
                            <li key={oi}>
                              <button
                                onClick={() => {
                                  if (!answered)
                                    setQuizAnswers((prev) => ({
                                      ...prev,
                                      [qi]: oi,
                                    }));
                                }}
                                disabled={answered}
                                className={`w-full text-left px-3 py-2 text-xs rounded-md transition-colors ${style} disabled:cursor-default`}
                              >
                                <span className="font-semibold mr-1.5">
                                  {["A", "B", "C", "D"][oi]}.
                                </span>
                                {opt}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      {answered && (
                        <div
                          className={`mt-2 text-xs rounded px-2 py-1.5 leading-relaxed ${
                            correct
                              ? "bg-green-50 text-green-800 border border-green-200"
                              : "bg-red-50 text-red-800 border border-red-200"
                          }`}
                        >
                          <span className="font-semibold">
                            {correct ? "정답 ✓" : "오답 ✗"}
                          </span>{" "}
                          {q.explanation}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-sm text-zinc-400 mt-8">
                퀴즈를 불러오는 중...
              </div>
            )}
          </div>
        )}
        {activeTab === "visualize" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!loadedPaper ? (
              <div className="text-center text-sm text-zinc-400 mt-8">
                <p>시각화 탭</p>
                <p className="text-xs mt-2">좌측에서 논문을 먼저 분석하세요</p>
              </div>
            ) : visualizeLoading ? (
              <div className="text-center text-sm text-zinc-400 mt-8 animate-pulse">
                graphical abstract를 생성하는 중입니다...
              </div>
            ) : visualizeError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
                <div className="font-medium mb-1">오류</div>
                <div className="text-xs mb-2">{visualizeError}</div>
                <button
                  onClick={() => handleVisualize(loadedPaper)}
                  className="text-xs underline text-red-600 hover:text-red-700"
                >
                  다시 시도
                </button>
              </div>
            ) : loadedPaper.visualize ? (
              <div className="space-y-4">
                {/* NEJM 스타일 이미지 — 제공자 선택형 (실험적) */}
                <div className="rounded-xl border border-zinc-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                      NEJM 스타일 이미지 (실험적)
                    </span>
                    <button
                      onClick={() => handleGenerateImage(loadedPaper)}
                      disabled={geminiLoading}
                      className="rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-zinc-700 disabled:bg-zinc-300"
                    >
                      {geminiLoading
                        ? "생성 중..."
                        : loadedPaper.geminiImage
                          ? "다시 생성"
                          : "이미지 생성"}
                    </button>
                  </div>
                  {/* 제공자 선택 */}
                  <div className="mb-2 flex flex-wrap gap-1">
                    {(
                      [
                        ["gemini", "Gemini"],
                        ["openai", "OpenAI"],
                        ["flux", "Flux"],
                        ["ideogram", "Ideogram"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setImageProvider(key)}
                        disabled={geminiLoading}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                          imageProvider === key
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {geminiError ? (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-2 text-xs">
                      {geminiError}
                    </div>
                  ) : geminiLoading ? (
                    <div className="text-center text-xs text-zinc-400 py-6 animate-pulse">
                      Gemini가 이미지를 생성하는 중입니다... (수십 초 소요)
                    </div>
                  ) : loadedPaper.geminiImage ? (
                    <div className="space-y-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={loadedPaper.geminiImage}
                        alt="Gemini 생성 graphical abstract"
                        className="w-full rounded-md border border-zinc-200"
                      />
                      <div className="flex items-center justify-between">
                        <a
                          href={loadedPaper.geminiImage}
                          download="graphical-abstract.png"
                          className="text-[11px] text-blue-600 underline hover:text-blue-700"
                        >
                          이미지 저장
                        </a>
                        <span className="text-[10px] text-amber-600">
                          ⚠ 차트·수치·이미지는 AI 생성물 — 원문과 대조 검증 필요
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400 py-2">
                      핵심 결과를 바탕으로 Gemini가 NEJM 스타일 이미지를 생성합니다. 위 버튼을 누르세요.
                    </p>
                  )}
                </div>

                <GraphicalAbstract data={loadedPaper.visualize} />
              </div>
            ) : (
              <div className="text-center text-sm text-zinc-400 mt-8">
                graphical abstract를 불러오는 중...
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
