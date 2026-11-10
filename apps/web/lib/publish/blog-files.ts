// 저장소에서 한 Notion 글에 속한 파일을 찾는 규칙(제품 명세 §5.1 R8). 브라우저와 서버가 함께 쓴다.
// 글 slug는 `<제목 slug>-<하이픈 뺀 page ID 32자>`라서, 제목이 바뀌어도 접미사로 같은 글의 파일을 모두 찾는다.
// Notion page ID는 앞부분이 워크스페이스·생성 시점마다 거의 같아 일부만 쓰면 다른 글과 겹친다(앞 12자를 쓰던
// 때 서로 다른 글이 같은 글로 묶여 덮어써졌다). 그래서 ID 전체를 쓴다.
// 접미사가 없는 v1 글과 옛 12자 접미사 글은 어떤 page에도 속하지 않는 것으로 보고 건드리지 않는다.
const SUFFIX = /^[a-f0-9]{32}$/;
const POST_FILE = /^src\/content\/blog\/([a-z0-9-]+-([a-f0-9]{32}))\.md$/;
const REDIRECT_FILE = /^public\/posts\/([a-z0-9-]+-([a-f0-9]{32}))\/index\.html$/;
const ASSET_FILE = /^src\/assets\/blog\/([a-z0-9-]+-([a-f0-9]{32}))\//;

/** Notion page ID → 글 slug 접미사(하이픈을 뺀 32자). */
export function pageIdSuffix(providerPageId: string): string {
  const suffix = providerPageId.replaceAll("-", "").toLowerCase();
  if (!SUFFIX.test(suffix)) {
    throw new Error("Invalid Notion page ID");
  }
  return suffix;
}

/** 이 page의 글 파일·이미지·옛 주소 안내 page 경로와, 그 파일들에 쓰인 slug. */
export function pageFiles(
  contentPaths: readonly string[],
  suffix: string,
): { paths: string[]; slugs: string[] } {
  const slugs = new Set<string>();
  const paths = contentPaths.filter((path) => {
    const match = POST_FILE.exec(path) ?? REDIRECT_FILE.exec(path) ?? ASSET_FILE.exec(path);
    if (match?.[2] !== suffix) {
      return false;
    }
    slugs.add(match[1]!);
    return true;
  });
  return { paths, slugs: [...slugs] };
}

/** 저장소에 게시된 글 목록(접미사가 있는 글만). */
export function publishedPosts(contentPaths: readonly string[]): { slug: string; suffix: string }[] {
  return contentPaths.flatMap((path) => {
    const match = POST_FILE.exec(path);
    return match === null ? [] : [{ slug: match[1]!, suffix: match[2]! }];
  });
}

/**
 * 옛 주소에 두는 안내 page(결정 D4). JavaScript 없이 새 주소로 보내고, 검색엔진에는 새 주소를 알린다.
 * 이동은 상대 주소(`../<새 slug>/`)라 base path·로컬 미리보기에서도 같은 사이트 안에서 움직인다.
 */
export function redirectPage(
  oldSlug: string,
  newSlug: string,
  newUrl: string,
): { bytes: Uint8Array; path: string } {
  const href = `../${escapeHtml(newSlug)}/`;
  const canonical = escapeHtml(newUrl);
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${href}">
<link rel="canonical" href="${canonical}">
<title>글 주소가 바뀌었습니다</title>
</head>
<body>
<p>글 주소가 바뀌었습니다. <a href="${href}">새 주소로 이동</a></p>
</body>
</html>
`;
  return { bytes: new TextEncoder().encode(html), path: `public/posts/${oldSlug}/index.html` };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
