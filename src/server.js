#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { EgovApiError, getArticle, getLaw, getUpdatedLaws, searchLaws } from "./egovClient.js";

const server = new McpServer({
  name: "egov-mcp",
  version: "0.1.0"
});

const formatSchema = z.enum(["text", "xml", "json"]).default("text");

server.tool(
  "search_laws",
  "Search current Japanese laws in the public e-Gov Law API by law name, law number, law ID, or promulgation date.",
  {
    query: z.string().optional().describe("Search text. Matches law name, law number, law ID, and promulgation date."),
    category: z
      .enum(["all", "acts", "orders", "ministerial_orders"])
      .default("all")
      .describe("all, acts, orders, or ministerial_orders."),
    limit: z.number().int().min(1).max(200).default(20),
    offset: z.number().int().min(0).default(0)
  },
  async (input) => jsonToolResult(await searchLaws(input))
);

server.tool(
  "get_law",
  "Get the current full text of a Japanese law from the public e-Gov Law API.",
  {
    law_id_or_num: z.string().min(1).describe("Law ID such as 405AC0000000088, or a Japanese law number."),
    format: formatSchema,
    max_chars: z.number().int().min(1000).max(200000).default(20000)
  },
  async (input) => textToolResult(await getLaw(input))
);

server.tool(
  "get_article",
  "Get article, paragraph, or appendix table content from a Japanese law.",
  {
    law_id: z.string().optional().describe("Law ID such as 405AC0000000088."),
    law_num: z.string().optional().describe("Japanese law number. Use law_id when available."),
    article: z.string().optional().describe("Article number, for example 1 or 第一条."),
    paragraph: z.string().optional().describe("Paragraph number."),
    appdx_table: z.string().optional().describe("Appendix table name or number."),
    format: formatSchema,
    max_chars: z.number().int().min(1000).max(200000).default(16000)
  },
  async (input) => textToolResult(await getArticle(input))
);

server.tool(
  "get_updated_laws",
  "Get laws updated on a date from the public e-Gov Law API.",
  {
    date: z.string().describe("YYYYMMDD or YYYY-MM-DD. e-Gov supports dates from 2020-11-24 through today."),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0)
  },
  async (input) => jsonToolResult(await getUpdatedLaws(input))
);

await server.connect(new StdioServerTransport());

function jsonToolResult(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ],
    structuredContent: value
  };
}

function textToolResult(value) {
  const result = {
    content: [
      {
        type: "text",
        text: value.text
      }
    ],
    structuredContent: Object.fromEntries(Object.entries(value).filter(([key]) => key !== "text"))
  };
  if (value.contentFound === false) {
    result.isError = true;
  }
  return result;
}

process.on("uncaughtException", (error) => {
  reportError(error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  reportError(reason);
  process.exit(1);
});

function reportError(error) {
  const payload =
    error instanceof EgovApiError
      ? { name: error.name, message: error.message, details: error.details }
      : { name: error?.name || "Error", message: error?.message || String(error) };
  console.error(JSON.stringify(payload));
}
