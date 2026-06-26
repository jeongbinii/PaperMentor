"use client";

import type { ReactNode } from "react";

// 처음 한 번만 띄우는 기능 안내 팝업. "닫기"는 이번만 닫고, "다시 보지 않음"은 영구 숨김.
export default function FeatureTip({
  title,
  badge,
  children,
  onClose,
  onNeverShow,
}: {
  title: string;
  badge?: string;
  children: ReactNode;
  onClose: () => void;
  onNeverShow: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
          {badge && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              {badge}
            </span>
          )}
        </div>
        <div className="space-y-2 text-sm leading-relaxed text-zinc-600">
          {children}
        </div>
        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={onNeverShow}
            className="text-[13px] text-zinc-400 hover:text-zinc-600"
          >
            다시 보지 않음
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
