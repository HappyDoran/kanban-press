import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from "next/font/google";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

// A 작업대형 글꼴(디자인 기획 10.2). serif 글꼴은 쓰지 않는다.
const sans = IBM_Plex_Sans_KR({
  subsets: ["latin"],
  variable: "--font-plex-sans",
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  description: "Notion 문서를 칸반으로 관리하고 GitHub Pages 블로그에 게시하는 서비스",
  title: "Notion Kanban Blog",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className={`${sans.variable} ${mono.variable}`} lang="ko" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
