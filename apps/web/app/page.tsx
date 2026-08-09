import { NotionBrowser } from "./notion-browser";

const workflow = [
  {
    description: "허용한 페이지와 하위 문서만 안전하게 불러옵니다.",
    mark: "○",
    step: "Notion 연결",
  },
  {
    description: "보관 중인 문서와 게시 상태를 간결하게 관리합니다.",
    mark: "◐",
    step: "칸반 관리",
  },
  {
    description: "승인된 글을 각 사용자의 GitHub Pages에 배포합니다.",
    mark: "●",
    step: "블로그 게시",
  },
] as const;

export default function Home() {
  return (
    <main>
      <NotionBrowser marketing={<Marketing />} />
    </main>
  );
}

function Marketing() {
  return (
    <>
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
        <div className="heroActions">
          <a className="heroCta" href="/auth/github/start?returnTo=%2F">
            GitHub로 시작
          </a>
        </div>
        <p aria-hidden="true" className="rail">
          <span className="railStop">
            <span className="railDot">○</span> 보관 중
          </span>
          <span className="railLine" />
          <span className="railStop">
            <span className="railDot">◐</span> 게시 중
          </span>
          <span className="railLine" />
          <span className="railStop">
            <span className="railDot">●</span> 게시 완료
          </span>
        </p>
      </section>

      <section aria-labelledby="workflow-title" className="workflow">
        <div className="sectionHeading">
          <p className="eyebrow">Workflow</p>
          <h2 id="workflow-title">문서에서 게시까지</h2>
        </div>
        <ol className="workflowGrid">
          {workflow.map((item) => (
            <li key={item.step}>
              <span aria-hidden="true" className="stepMark">
                {item.mark}
              </span>
              <h3>{item.step}</h3>
              <p>{item.description}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
