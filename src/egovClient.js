import { asArray, cleanText, collectText, extractLines, parseXml, removeImageData, truncateText } from "./xml.js";

const BASE_URL = "https://laws.e-gov.go.jp/api/1";
const lawListCache = new Map();

const categories = {
  all: "1",
  acts: "2",
  orders: "3",
  ministerial_orders: "4"
};

export class EgovApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "EgovApiError";
    this.details = details;
  }
}

export function normalizeDate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!match) {
    throw new EgovApiError("date must be YYYYMMDD or YYYY-MM-DD", { date: value });
  }
  return `${match[1]}${match[2]}${match[3]}`;
}

export function categoryCode(value = "all") {
  const code = categories[value];
  if (!code) {
    throw new EgovApiError("unsupported category", { category: value });
  }
  return code;
}

export function normalizeArticleCandidates(value) {
  const original = cleanText(value);
  if (!original) {
    return [];
  }
  const compact = normalizeArticleText(original);
  const candidates = [];
  const add = (candidate) => {
    const text = cleanText(candidate);
    if (text && !candidates.includes(text)) {
      candidates.push(text);
    }
  };
  const canonical = canonicalArticleNumber(compact);
  if (canonical) {
    add(canonical);
    const branch = canonical.match(/^(\d+)_(\d+)$/);
    if (branch) {
      add(`${branch[1]}\u6761\u306e${branch[2]}`);
    }
  }
  add(compact.replace(/-/g, "_"));
  add(compact);
  add(original);
  return candidates;
}

export async function searchLaws({ query = "", category = "all", limit = 20, offset = 0 } = {}) {
  const list = await fetchLawList(category);
  const needle = normalizeForSearch(query);
  const filtered = needle
    ? list.filter((item) =>
        [item.lawId, item.lawName, item.lawNo, item.promulgationDate].some((field) =>
          normalizeForSearch(field).includes(needle)
        )
      )
    : list;
  const start = Math.max(0, offset);
  const end = start + limit;
  return {
    query,
    category,
    total: list.length,
    totalMatches: filtered.length,
    offset: start,
    limit,
    items: filtered.slice(start, end)
  };
}

export async function getLaw({ law_id_or_num, format = "text", max_chars = 20000 } = {}) {
  if (!law_id_or_num) {
    throw new EgovApiError("law_id_or_num is required");
  }
  const path = `/lawdata/${encodeURIComponent(law_id_or_num)}`;
  const { xml, data } = await requestXml(path);
  const app = data.DataRoot?.ApplData;
  const result = apiResult(data);
  const sourceUrl = `${BASE_URL}${path}`;
  const law = app?.LawFullText?.Law;
  const body = law?.LawBody;
  const title = collectText(body?.LawTitle);
  const lawNo = collectText(law?.LawNum) || collectText(app?.LawNum);
  const lawText = extractLines(app?.LawFullText);
  const contentFound = Boolean(lawText);
  const reason = contentFound ? "" : "law text not found";
  const base = {
    result,
    sourceUrl,
    lawId: cleanText(app?.LawId),
    lawNo,
    lawName: title,
    hasImageData: Boolean(app?.ImageData),
    contentFound,
    reason
  };
  if (format === "xml") {
    const content = truncateText(xml, max_chars);
    return {
      ...base,
      content,
      lawText: truncateText(lawText, max_chars),
      text: content
    };
  }
  if (format === "json") {
    const content = truncateText(JSON.stringify(removeImageData(app), null, 2), max_chars);
    return {
      ...base,
      content,
      lawText: truncateText(lawText, max_chars),
      text: content
    };
  }
  const text = [
    `LawId: ${cleanText(app?.LawId) || cleanText(law_id_or_num)}`,
    lawNo ? `LawNo: ${lawNo}` : "",
    title ? `LawName: ${title}` : "",
    `Source: ${sourceUrl}`,
    "",
    lawText || reason
  ]
    .filter((line) => line !== "")
    .join("\n");
  return {
    ...base,
    content: truncateText(lawText, max_chars),
    lawText: truncateText(lawText, max_chars),
    text: truncateText(text, max_chars)
  };
}

export async function getArticle({
  law_id,
  law_num,
  article,
  paragraph,
  appdx_table,
  format = "text",
  max_chars = 16000
} = {}) {
  if (!law_id && !law_num) {
    throw new EgovApiError("law_id or law_num is required");
  }
  if (!article && !paragraph && !appdx_table) {
    throw new EgovApiError("article, paragraph, or appdx_table is required");
  }
  const articleCandidates = article ? normalizeArticleCandidates(article) : [undefined];
  const attempts = [];
  let selected;
  for (const candidate of articleCandidates) {
    const path = articlePath({ law_id, law_num, article: candidate, paragraph, appdx_table });
    const response = await requestXml(path, { allowApiResultError: true });
    const app = response.data.DataRoot?.ApplData;
    const result = apiResult(response.data);
    const articleText = extractArticleText(app);
    const contentFound = Boolean(articleText);
    const sourceUrl = `${BASE_URL}${path}`;
    attempts.push({
      article: candidate ?? "",
      sourceUrl,
      httpStatus: response.httpStatus,
      result,
      contentFound
    });
    selected = { path, sourceUrl, ...response, app, result, articleText, contentFound };
    if (contentFound) {
      break;
    }
  }
  const { xml, app, result, articleText, contentFound, sourceUrl } = selected;
  const reason = articleContentReason({ result, contentFound, article: article ? cleanText(article) : "" });
  const base = {
    result,
    sourceUrl,
    attemptedSourceUrls: attempts.map((attempt) => attempt.sourceUrl),
    attempts,
    lawId: cleanText(app?.LawId),
    lawNo: cleanText(app?.LawNum),
    article: cleanText(app?.Article),
    requestedArticle: article ? cleanText(article) : "",
    matchedArticle: matchedArticleTitle(app),
    paragraph: cleanText(app?.Paragraph),
    appdxTable: cleanText(app?.AppdxTable),
    hasImageData: Boolean(app?.ImageData),
    contentFound,
    reason
  };
  if (format === "xml") {
    const content = truncateText(xml, max_chars);
    return {
      ...base,
      content,
      articleText: truncateText(articleText, max_chars),
      text: contentFound ? content : failureText(base)
    };
  }
  if (format === "json") {
    const content = truncateText(JSON.stringify(removeImageData(app), null, 2), max_chars);
    return {
      ...base,
      content,
      articleText: truncateText(articleText, max_chars),
      text: contentFound ? content : failureText(base)
    };
  }
  const lines = [
    `LawId: ${base.lawId || ""}`,
    base.lawNo ? `LawNo: ${base.lawNo}` : "",
    base.article ? `Article: ${base.article}` : "",
    base.paragraph ? `Paragraph: ${base.paragraph}` : "",
    base.appdxTable ? `AppdxTable: ${base.appdxTable}` : "",
    `Source: ${sourceUrl}`,
    "",
    articleText || reason
  ].filter((line) => line !== "");
  return {
    ...base,
    content: truncateText(articleText, max_chars),
    articleText: truncateText(articleText, max_chars),
    text: truncateText(lines.join("\n"), max_chars)
  };
}

export async function getUpdatedLaws({ date, limit = 50, offset = 0 } = {}) {
  const normalized = normalizeDate(date);
  const path = `/updatelawlists/${normalized}`;
  const { data } = await requestXml(path);
  const app = data.DataRoot?.ApplData;
  const list = asArray(app?.LawNameListInfo).map((item) => ({
    lawTypeName: cleanText(item.LawTypeName),
    lawNo: cleanText(item.LawNo),
    lawName: cleanText(item.LawName),
    lawNameKana: cleanText(item.LawNameKana),
    oldLawName: cleanText(item.OldLawName),
    promulgationDate: cleanText(item.PromulgationDate),
    amendName: cleanText(item.AmendName),
    amendNo: cleanText(item.AmendNo),
    amendPromulgationDate: cleanText(item.AmendPromulgationDate),
    enforcementDate: cleanText(item.EnforcementDate),
    enforcementComment: cleanText(item.EnforcementComment),
    lawId: cleanText(item.LawId),
    lawUrl: cleanText(item.LawUrl),
    enforcementFlag: cleanText(item.EnforcementFlg),
    authFlag: cleanText(item.AuthFlg)
  }));
  const start = Math.max(0, offset);
  return {
    date: normalized,
    totalMatches: list.length,
    offset: start,
    limit,
    items: list.slice(start, start + limit)
  };
}

export async function fetchLawList(category = "all") {
  const code = categoryCode(category);
  if (!lawListCache.has(code)) {
    lawListCache.set(code, fetchLawListFromApi(code));
  }
  return lawListCache.get(code);
}

async function fetchLawListFromApi(code) {
  const { data } = await requestXml(`/lawlists/${code}`);
  const app = data.DataRoot?.ApplData;
  return asArray(app?.LawNameListInfo).map((item) => ({
    lawId: cleanText(item.LawId),
    lawName: cleanText(item.LawName),
    lawNo: cleanText(item.LawNo),
    promulgationDate: cleanText(item.PromulgationDate)
  }));
}

async function requestXml(path, { allowApiResultError = false } = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "user-agent": "egov-mcp/0.1"
    }
  });
  const xml = await response.text();
  const data = parseXml(xml);
  const result = apiResult(data);
  if (!response.ok) {
    if (allowApiResultError && result.code) {
      return { xml, data, httpStatus: response.status };
    }
    throw new EgovApiError(`e-Gov API returned HTTP ${response.status}`, {
      status: response.status,
      url,
      body: truncateText(xml, 1000)
    });
  }
  if (result.code && result.code !== "0") {
    if (allowApiResultError) {
      return { xml, data, httpStatus: response.status };
    }
    throw new EgovApiError(result.message || `e-Gov API returned result code ${result.code}`, {
      code: result.code,
      message: result.message,
      url
    });
  }
  return { xml, data, httpStatus: response.status };
}

function apiResult(data) {
  const result = data?.DataRoot?.Result || {};
  return {
    code: cleanText(result.Code),
    message: cleanText(result.Message)
  };
}

function normalizeForSearch(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function articlePath({ law_id, law_num, article, paragraph, appdx_table }) {
  const parts = [];
  if (law_num) {
    parts.push(`lawNum=${encodeURIComponent(law_num)}`);
  }
  if (law_id) {
    parts.push(`lawId=${encodeURIComponent(law_id)}`);
  }
  if (article) {
    parts.push(`article=${encodeURIComponent(article)}`);
  }
  if (paragraph) {
    parts.push(`paragraph=${encodeURIComponent(paragraph)}`);
  }
  if (appdx_table) {
    parts.push(`appdxTable=${encodeURIComponent(appdx_table)}`);
  }
  return `/articles;${parts.join(";")}`;
}

function extractArticleText(app) {
  return extractLines(app?.LawContents || app?.AppdxTableTitleLists);
}

function matchedArticleTitle(app) {
  return cleanText(collectText(asArray(app?.LawContents?.Article)[0]?.ArticleTitle));
}

function articleContentReason({ result, contentFound, article }) {
  if (contentFound) {
    return "";
  }
  if (result?.message) {
    return result.message;
  }
  if (article) {
    return "article not matched";
  }
  return "content not found";
}

function failureText(value) {
  const lines = [
    value.reason || "content not found",
    value.sourceUrl ? `Source: ${value.sourceUrl}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}

function normalizeArticleText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFF0D]/gu, "-")
    .replace(/\u30CE/g, "\u306e")
    .replace(/\u4E4B/g, "\u306e");
}

function canonicalArticleNumber(value) {
  const text = normalizeArticleText(value);
  const patterns = [
    /^\u7B2C?(.+?)_(.+?)(?:\u6761)?$/u,
    /^\u7B2C?(.+?)-(.+?)(?:\u6761)?$/u,
    /^\u7B2C?(.+?)\u6761\u306e(.+?)$/u,
    /^\u7B2C?(.+?)\u306e(.+?)\u6761$/u,
    /^\u7B2C?(.+?)\u306e(.+?)$/u,
    /^\u7B2C?(.+?)\u6761$/u,
    /^\u7B2C?(.+?)$/u
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const base = parseArticleNumber(match[1]);
    const branch = match[2] ? parseArticleNumber(match[2]) : "";
    if (!base || (match[2] && !branch)) {
      continue;
    }
    return branch ? `${base}_${branch}` : base;
  }
  return "";
}

function parseArticleNumber(value) {
  const text = normalizeArticleText(value).replace(/^\u7B2C/u, "").replace(/\u6761$/u, "");
  if (/^\d+$/.test(text)) {
    return String(Number(text));
  }
  if (!/^[\u3007\u96F6\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341\u767E\u5343\u4E07]+$/u.test(text)) {
    return "";
  }
  return String(parseJapaneseNumber(text));
}

function parseJapaneseNumber(text) {
  if (!/[\u5341\u767E\u5343\u4E07]/u.test(text)) {
    return Number([...text].map((char) => japaneseDigit(char)).join(""));
  }
  const parts = text.split("\u4E07");
  if (parts.length > 1) {
    const high = parts[0] ? parseJapaneseNumberBelow10000(parts[0]) : 1;
    const low = parts[1] ? parseJapaneseNumberBelow10000(parts[1]) : 0;
    return high * 10000 + low;
  }
  return parseJapaneseNumberBelow10000(text);
}

function parseJapaneseNumberBelow10000(text) {
  const units = new Map([
    ["\u5343", 1000],
    ["\u767E", 100],
    ["\u5341", 10]
  ]);
  let total = 0;
  let current = 0;
  for (const char of text) {
    if (units.has(char)) {
      total += (current || 1) * units.get(char);
      current = 0;
      continue;
    }
    current = japaneseDigit(char);
  }
  return total + current;
}

function japaneseDigit(char) {
  const digits = new Map([
    ["\u3007", 0],
    ["\u96F6", 0],
    ["\u4E00", 1],
    ["\u4E8C", 2],
    ["\u4E09", 3],
    ["\u56DB", 4],
    ["\u4E94", 5],
    ["\u516D", 6],
    ["\u4E03", 7],
    ["\u516B", 8],
    ["\u4E5D", 9]
  ]);
  return digits.get(char);
}
