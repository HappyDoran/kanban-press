import Link from "next/link";

import { NotionBrowser } from "./notion-browser";

const workflow = [
  {
    description: "허용한 페이지와 하위 문서만 안전하게 불러옵니다.",
    step: "Notion 연결",
  },
  {
    description: "보관 중인 문서와 게시 상태를 간결하게 관리합니다.",
    step: "칸반 관리",
  },
  {
    description: "승인된 글을 각 사용자의 GitHub Pages에 배포합니다.",
    step: "블로그 게시",
  },
] as const;

export default function Home() {
  return (
    <main>
      <nav aria-label="주요 탐색" className="navigation">
        <Link aria-label="Notion Kanban Blog 홈" className="brand" href="/">
          <span aria-hidden="true" className="brandMark">
            N
          </span>
          <span>Notion Kanban Blog</span>
        </Link>
        <div className="navigationActions">
          <span className="status">개인 칸반</span>
          <Link
            className="notionLink"
            href="/auth/notion/start?returnTo=%2F"
            prefetch={false}
          >
            Notion 연결
          </Link>
          <Link
            className="loginLink"
            href="/auth/github/start?returnTo=%2F"
            prefetch={false}
          >
            GitHub로 시작
          </Link>
        </div>
      </nav>

      <section className="hero">
        <p className="eyebrow">Notion to GitHub Pages</p>
        <h1>
          글쓰기는 Notion에서,
          <br />
          발행은 한눈에.
        </h1>
        <p className="lede">
          여러 Notion 워크스페이스의 문서를 하나의 칸반에서 검수하고,
          승인된 콘텐츠만 정적 블로그로 안전하게 배포합니다.
        </p>
      </section>

      <NotionBrowser />

      <section aria-labelledby="workflow-title" className="workflow">
        <div className="sectionHeading">
          <p className="eyebrow">Workflow</p>
          <h2 id="workflow-title">문서에서 게시까지</h2>
        </div>
        <ol className="workflowGrid">
          {workflow.map((item, index) => (
            <li key={item.step}>
              <span className="stepNumber">{String(index + 1).padStart(2, "0")}</span>
              <h3>{item.step}</h3>
              <p>{item.description}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
