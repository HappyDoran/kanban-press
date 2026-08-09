import { Gowun_Batang, IBM_Plex_Sans_KR } from "next/font/google";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

const display = Gowun_Batang({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "700"],
});

const body = IBM_Plex_Sans_KR({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  description:
    "Notion 문서를 칸반으로 관리하고 GitHub Pages 블로그에 게시하는 서비스",
  title: "Notion Kanban Blog",
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      className={`${display.variable} ${body.variable}`}
      lang="ko"
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
