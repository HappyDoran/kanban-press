/** 원고지 한 장의 칸 수. */
const CELLS_PER_PAGE = 200;

// 게시 문서와 앱 프리뷰의 블록을 모두 받도록 글자만 읽는 최소 모양으로 둔다.
type TextPart = { readonly text: string };

type TextBlock = {
  caption?: readonly TextPart[];
  children?: readonly TextBlock[];
  kind: string;
  richText?: readonly TextPart[];
  rows?: readonly (readonly (readonly TextPart[])[])[];
  summary?: readonly TextPart[];
};

/**
 * 글 분량을 200자 원고지 매수로 센다(디자인 기획 2.4, 판권의 분량).
 * 사람이 쓴 글자(공백 포함, 줄바꿈 제외)만 세고 code·수식은 뺀다. 원고지처럼 마지막 장은 다 채우지 않아도 한 장이다.
 */
export function countManuscriptPages(blocks: readonly TextBlock[]): number {
  return Math.ceil(countCells(blocks) / CELLS_PER_PAGE);
}

function countCells(blocks: readonly TextBlock[]): number {
  let cells = 0;
  for (const block of blocks) {
    if (block.kind === "code" || block.kind === "equation") continue;
    cells += countText(block.richText) + countText(block.summary) + countText(block.caption);
    for (const row of block.rows ?? []) {
      for (const cell of row) cells += countText(cell);
    }
    if (block.children !== undefined) cells += countCells(block.children);
  }
  return cells;
}

function countText(parts: readonly TextPart[] | undefined): number {
  let cells = 0;
  for (const part of parts ?? []) {
    // 한글·이모지를 한 칸으로 세려고 code point 단위로 센다.
    cells += Array.from(part.text.replace(/\r?\n/gu, "")).length;
  }
  return cells;
}
