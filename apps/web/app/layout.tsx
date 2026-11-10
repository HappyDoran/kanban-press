import { DESIGN_TOKENS_CSS } from "@kanban-press/publisher";
import { Hahmlet, JetBrains_Mono } from "next/font/google";

import { APP_NAME } from "./brand-mark";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

// 교정쇄 × 원고지 글꼴(디자인 기획 10.2). serif(Hahmlet)는 제목에만 쓴다.
// 본문 고딕은 시스템 글꼴을 쓴다. 한글 웹 글꼴은 굵기마다 unicode-range 조각이 수백 개라
// 두 벌을 받으면 Vercel build에서 글꼴 다운로드가 실패했다. 가변 글꼴 한 벌(굵기 지정 없음)만 받는다.
const title = Hahmlet({
  subsets: ["latin"],
  variable: "--font-hahmlet",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  description: "Notion 문서를 칸반으로 관리하고 GitHub Pages 블로그에 게시하는 서비스",
  title: APP_NAME,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      className={`${title.variable} ${mono.variable}`}
      lang="ko"
      suppressHydrationWarning
    >
      <head>
        {/* 색·모양 토큰의 정본은 publisher의 DESIGN_TOKENS_CSS다. 블로그 template도 같은 문자열을 쓴다. */}
        <style dangerouslySetInnerHTML={{ __html: DESIGN_TOKENS_CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
