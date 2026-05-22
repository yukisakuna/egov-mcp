import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) =>
    [
      "LawNameListInfo",
      "Article",
      "Paragraph",
      "Sentence",
      "Item",
      "Subitem1",
      "Subitem2",
      "Subitem3",
      "Subitem4",
      "Subitem5",
      "Subitem6",
      "Subitem7",
      "Subitem8",
      "Subitem9",
      "Subitem10",
      "Column",
      "Row",
      "Table",
      "AppdxTableTitle"
    ].includes(name)
});

const lineTags = new Set([
  "LawNum",
  "LawTitle",
  "ChapterTitle",
  "SectionTitle",
  "SubsectionTitle",
  "DivisionTitle",
  "ArticleCaption",
  "ArticleTitle",
  "ParagraphNum",
  "ItemTitle",
  "Subitem1Title",
  "Subitem2Title",
  "Subitem3Title",
  "Subitem4Title",
  "Subitem5Title",
  "Subitem6Title",
  "Subitem7Title",
  "Subitem8Title",
  "Subitem9Title",
  "Subitem10Title",
  "Sentence",
  "Column",
  "SupplProvisionLabel",
  "AppdxTableTitle",
  "TableStructTitle",
  "FigStructTitle",
  "RemarksLabel"
]);

const skipTags = new Set(["ImageData"]);

export function parseXml(xml) {
  return parser.parse(xml);
}

export function asArray(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function cleanText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function collectText(node) {
  const parts = [];
  walkText(node, parts);
  return cleanText(parts.join(""));
}

function walkText(node, parts) {
  if (node === undefined || node === null || node === "") {
    return;
  }
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    parts.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walkText(item, parts);
    }
    return;
  }
  if (typeof node !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_") || key === "#text" || key === ":@") {
      if (key === "#text") {
        walkText(value, parts);
      }
      continue;
    }
    if (skipTags.has(key)) {
      continue;
    }
    walkText(value, parts);
  }
}

export function extractLines(node) {
  const lines = [];
  walkLines(node, lines);
  return dedupeBlankLines(lines).join("\n");
}

function walkLines(node, lines) {
  if (node === undefined || node === null || node === "") {
    return;
  }
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    const text = cleanText(node);
    if (text) {
      lines.push(text);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walkLines(item, lines);
    }
    return;
  }
  if (typeof node !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_") || key === ":@") {
      continue;
    }
    if (skipTags.has(key)) {
      continue;
    }
    if (key === "#text") {
      const text = cleanText(value);
      if (text) {
        lines.push(text);
      }
      continue;
    }
    if (lineTags.has(key)) {
      const text = collectText(value);
      if (text) {
        lines.push(text);
      }
      continue;
    }
    walkLines(value, lines);
  }
}

function dedupeBlankLines(lines) {
  const out = [];
  for (const line of lines.map(cleanText).filter(Boolean)) {
    if (out[out.length - 1] !== line) {
      out.push(line);
    }
  }
  return out;
}

export function removeImageData(node) {
  if (Array.isArray(node)) {
    return node.map(removeImageData);
  }
  if (!node || typeof node !== "object") {
    return node;
  }
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "ImageData") {
      out.hasImageData = true;
      out.imageDataOmitted = true;
      continue;
    }
    out[key] = removeImageData(value);
  }
  return out;
}

export function truncateText(text, maxChars) {
  const value = String(text ?? "");
  if (!Number.isFinite(maxChars) || maxChars <= 0 || value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n\n[Output truncated to ${maxChars} characters. Increase max_chars to receive more.]`;
}
