import { NotionBrowser } from "./notion-browser";

export default function Home() {
  return <NotionBrowser marketing={<Marketing />} />;
}

/** 로그인 전 화면: 한 화면짜리 소개와 시작 버튼 하나(디자인 기획 6.4). */
function Marketing() {
  return (
    <main className="intro" id="main">
      <h1>
        글쓰기는 Notion에서,
        <br />
        발행은 한눈에.
      </h1>
      <p className="introLede">
        Notion 문서를 칸반에 올려 두고, 게시 중으로 옮기면 내 GitHub Pages 블로그에 바로 게시합니다.
      </p>
      <a className="buttonPrimary" href="/auth/github/start?returnTo=%2F">
        GitHub로 시작
      </a>
      <ol className="introSteps">
        <li>
          <strong>Notion 연결</strong>
          <span>공유를 허용한 페이지와 하위 문서만 불러옵니다.</span>
        </li>
        <li>
          <strong>칸반에서 고르기</strong>
          <span>게시할 문서를 보관 중에 모아 둡니다.</span>
        </li>
        <li>
          <strong>블로그 게시</strong>
          <span>내 계정의 공개 &lt;login&gt;.github.io 저장소에 게시합니다.</span>
        </li>
      </ol>
    </main>
  );
}
