import test from "node:test";
import assert from "node:assert/strict";
import { categoryCode, getArticle, getLaw, normalizeArticleCandidates, normalizeDate } from "../src/egovClient.js";

test("normalizeDate accepts compact and dashed dates", () => {
  assert.equal(normalizeDate("20260417"), "20260417");
  assert.equal(normalizeDate("2026-04-17"), "20260417");
});

test("categoryCode maps public law API categories", () => {
  assert.equal(categoryCode("all"), "1");
  assert.equal(categoryCode("acts"), "2");
  assert.equal(categoryCode("orders"), "3");
  assert.equal(categoryCode("ministerial_orders"), "4");
});

test("normalizeArticleCandidates accepts Japanese and separator variants", () => {
  const article246_2 = "\u7B2C\u4E8C\u767E\u56DB\u5341\u516D\u6761\u306E\u4E8C";
  assert.deepEqual(normalizeArticleCandidates(article246_2), ["246_2", "246\u6761\u306e2", article246_2]);
  assert.deepEqual(normalizeArticleCandidates("246\u6761\u306e2"), ["246_2", "246\u6761\u306e2"]);
  assert.deepEqual(normalizeArticleCandidates("246_2"), ["246_2", "246\u6761\u306e2"]);
  assert.deepEqual(normalizeArticleCandidates("246-2"), ["246_2", "246\u6761\u306e2", "246-2"]);
});

test("getLaw returns extracted law text in explicit fields", async () => {
  await withMockFetch([
    {
      status: 200,
      body: `<?xml version="1.0" encoding="UTF-8"?>
<DataRoot>
  <Result><Code>0</Code><Message/></Result>
  <ApplData>
    <LawId>TEST</LawId>
    <LawFullText>
      <Law>
        <LawNum>Act No. 1</LawNum>
        <LawBody>
          <LawTitle>Sample Law</LawTitle>
          <MainProvision>
            <Article Num="1">
              <ArticleTitle>Article 1</ArticleTitle>
              <Paragraph Num="1">
                <ParagraphSentence><Sentence Num="1">Full body text</Sentence></ParagraphSentence>
              </Paragraph>
            </Article>
          </MainProvision>
        </LawBody>
      </Law>
    </LawFullText>
  </ApplData>
</DataRoot>`
    }
  ], async () => {
    const result = await getLaw({ law_id_or_num: "TEST", max_chars: 20000 });
    assert.equal(result.contentFound, true);
    assert.match(result.content, /Full body text/);
    assert.match(result.lawText, /Full body text/);
    assert.match(result.text, /Full body text/);
    assert.equal(result.reason, "");
  });
});

test("getArticle returns articleText and content after normalizing article input", async () => {
  const calls = await withMockFetch([
    {
      status: 200,
      body: `<?xml version="1.0" encoding="UTF-8"?>
<DataRoot>
  <Result><Code>0</Code><Message/></Result>
  <ApplData>
    <LawId>TEST</LawId>
    <Article>246_2</Article>
    <LawContents>
      <Article Num="246_2">
        <ArticleTitle>Article 246-2</ArticleTitle>
        <Paragraph Num="1">
          <ParagraphSentence><Sentence Num="1">Article body text</Sentence></ParagraphSentence>
        </Paragraph>
      </Article>
    </LawContents>
  </ApplData>
</DataRoot>`
    }
  ], async () => {
    const result = await getArticle({ law_id: "TEST", article: "246-2", max_chars: 16000 });
    assert.equal(result.contentFound, true);
    assert.equal(result.reason, "");
    assert.equal(result.article, "246_2");
    assert.match(result.articleText, /Article body text/);
    assert.match(result.content, /Article body text/);
  });
  assert.match(calls[0], /article=246_2/);
});

test("getArticle reports contentFound false and reason when article content is absent", async () => {
  await withMockFetch([
    {
      status: 404,
      body: `<?xml version="1.0" encoding="UTF-8"?>
<DataRoot>
  <Result><Code>1</Code><Message>article not matched</Message></Result>
</DataRoot>`
    },
    {
      status: 404,
      body: `<?xml version="1.0" encoding="UTF-8"?>
<DataRoot>
  <Result><Code>1</Code><Message>article not matched</Message></Result>
</DataRoot>`
    },
    {
      status: 404,
      body: `<?xml version="1.0" encoding="UTF-8"?>
<DataRoot>
  <Result><Code>1</Code><Message>article not matched</Message></Result>
</DataRoot>`
    }
  ], async () => {
    const result = await getArticle({ law_id: "TEST", article: "246-2", max_chars: 16000 });
    assert.equal(result.contentFound, false);
    assert.equal(result.reason, "article not matched");
    assert.equal(result.content, "");
    assert.equal(result.articleText, "");
    assert.match(result.text, /article not matched/);
    assert.equal(result.attempts.length, 3);
  });
});

async function withMockFetch(responses, callback) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const response = responses.shift();
    if (!response) {
      throw new Error("unexpected fetch call");
    }
    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": "application/xml" }
    });
  };
  try {
    await callback();
    assert.equal(responses.length, 0);
    return calls;
  } finally {
    globalThis.fetch = originalFetch;
  }
}
