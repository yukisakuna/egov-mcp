import test from "node:test";
import assert from "node:assert/strict";
import { extractLines, parseXml, removeImageData, truncateText } from "../src/xml.js";

test("extractLines keeps law text and omits ImageData", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DataRoot>
  <Result><Code>0</Code><Message/></Result>
  <ApplData>
    <LawFullText>
      <Law>
        <LawNum>平成五年法律第八十八号</LawNum>
        <LawBody>
          <LawTitle>行政手続法</LawTitle>
          <MainProvision>
            <Article Num="1">
              <ArticleTitle>第一条</ArticleTitle>
              <Paragraph Num="1">
                <ParagraphSentence>
                  <Sentence Num="1">この法律は、国民の権利利益の保護に資することを目的とする。</Sentence>
                </ParagraphSentence>
              </Paragraph>
            </Article>
          </MainProvision>
        </LawBody>
      </Law>
    </LawFullText>
    <ImageData>abcdef</ImageData>
  </ApplData>
</DataRoot>`;
  const data = parseXml(xml);
  const text = extractLines(data.DataRoot.ApplData.LawFullText);
  assert.match(text, /行政手続法/);
  assert.match(text, /第一条/);
  assert.match(text, /国民の権利利益/);
  assert.doesNotMatch(text, /abcdef/);
});

test("removeImageData replaces image payloads", () => {
  const value = removeImageData({ ApplData: { ImageData: "payload", LawId: "x" } });
  assert.deepEqual(value, { ApplData: { hasImageData: true, imageDataOmitted: true, LawId: "x" } });
});

test("truncateText appends a notice when output is longer than the requested length", () => {
  assert.equal(truncateText("abcdef", 3), "abc\n\n[Output truncated to 3 characters. Increase max_chars to receive more.]");
  assert.equal(truncateText("abc", 3), "abc");
});
