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
  if (format === "xml") {
    return {
      result,
      sourceUrl: `${BASE_URL}${path}`,
      text: truncateText(xml, max_chars)
    };
  }
  if (format === "json") {
    return {
      result,
      sourceUrl: `${BASE_URL}${path}`,
      text: truncateText(JSON.stringify(removeImageData(app), null, 2), max_chars)
    };
  }
  const law = app?.LawFullText?.Law;
  const body = law?.LawBody;
  const title = collectText(body?.LawTitle);
  const lawNo = collectText(law?.LawNum) || collectText(app?.LawNum);
  const text = [
    `LawId: ${cleanText(app?.LawId) || cleanText(law_id_or_num)}`,
    lawNo ? `LawNo: ${lawNo}` : "",
    title ? `LawName: ${title}` : "",
    `Source: ${BASE_URL}${path}`,
    "",
    extractLines(app?.LawFullText)
  ]
    .filter((line) => line !== "")
    .join("\n");
  return {
    result,
    sourceUrl: `${BASE_URL}${path}`,
    lawId: cleanText(app?.LawId),
    lawNo,
    lawName: title,
    hasImageData: Boolean(app?.ImageData),
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
  const path = `/articles;${parts.join(";")}`;
  const { xml, data } = await requestXml(path);
  const app = data.DataRoot?.ApplData;
  const result = apiResult(data);
  if (format === "xml") {
    return {
      result,
      sourceUrl: `${BASE_URL}${path}`,
      text: truncateText(xml, max_chars)
    };
  }
  if (format === "json") {
    return {
      result,
      sourceUrl: `${BASE_URL}${path}`,
      text: truncateText(JSON.stringify(removeImageData(app), null, 2), max_chars)
    };
  }
  const lines = [
    `LawId: ${cleanText(app?.LawId) || ""}`,
    cleanText(app?.LawNum) ? `LawNo: ${cleanText(app.LawNum)}` : "",
    cleanText(app?.Article) ? `Article: ${cleanText(app.Article)}` : "",
    cleanText(app?.Paragraph) ? `Paragraph: ${cleanText(app.Paragraph)}` : "",
    cleanText(app?.AppdxTable) ? `AppdxTable: ${cleanText(app.AppdxTable)}` : "",
    `Source: ${BASE_URL}${path}`,
    "",
    extractLines(app?.LawContents || app?.AppdxTableTitleLists)
  ].filter((line) => line !== "");
  return {
    result,
    sourceUrl: `${BASE_URL}${path}`,
    lawId: cleanText(app?.LawId),
    lawNo: cleanText(app?.LawNum),
    article: cleanText(app?.Article),
    paragraph: cleanText(app?.Paragraph),
    appdxTable: cleanText(app?.AppdxTable),
    hasImageData: Boolean(app?.ImageData),
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

async function requestXml(path) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "user-agent": "egov-mcp/0.1"
    }
  });
  const xml = await response.text();
  if (!response.ok) {
    throw new EgovApiError(`e-Gov API returned HTTP ${response.status}`, {
      status: response.status,
      url,
      body: truncateText(xml, 1000)
    });
  }
  const data = parseXml(xml);
  const result = apiResult(data);
  if (result.code && result.code !== "0") {
    throw new EgovApiError(result.message || `e-Gov API returned result code ${result.code}`, {
      code: result.code,
      message: result.message,
      url
    });
  }
  return { xml, data };
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
