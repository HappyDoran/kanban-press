import { describe, expect, it } from "vitest";

import { parseBlock, toContentBlocks } from "./convert";

const LONG_URL = `https://example.com/${"a".repeat(2_100)}`;
const block = (type: string, value: unknown) =>
  parseBlock({ has_children: false, id: "eeeeeeee-1111-4111-8111-eeeeeeeeeeee", object: "block", type, [type]: value });

describe("over-long URLs", () => {
  it("keep the text but drop a link longer than the publish document allows", () => {
    const [paragraph] = toContentBlocks(block("paragraph", { rich_text: [{ href: LONG_URL, plain_text: "링크" }] }), []);
    expect(paragraph).toMatchObject({ kind: "paragraph", richText: [{ href: null, text: "링크" }] });
  });

  it("turn a bookmark with an over-long URL into a plain paragraph", () => {
    const [converted] = toContentBlocks(block("bookmark", { caption: [], url: LONG_URL }), []);
    expect(converted).toMatchObject({ kind: "paragraph", richText: [{ href: null, text: LONG_URL }] });
  });
});
