import { DESIGN_TOKENS_CSS } from "@kanban-press/publisher";
import { Hahmlet, JetBrains_Mono, Noto_Sans_KR } from "next/font/google";

import { APP_NAME } from "./brand-mark";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

// 교정쇄 × 원고지 글꼴(디자인 기획 10.2). serif(Hahmlet)는 제목에만 쓴다.
const title = Hahmlet({
  subsets: ["latin"],
  variable: "--font-hahmlet",
  weight: ["600", "700"],
});

const sans = Noto_Sans_KR({
  subsets: ["latin"],
  variable: "--font-noto-sans",
  weight: ["400", "500", "600", "700"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  description: "Notion 문서를 칸반으로 관리하고 GitHub Pages 블로그에 게시하는 서비스",
  title: APP_NAME,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      className={`${title.variable} ${sans.variable} ${mono.variable}`}
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
