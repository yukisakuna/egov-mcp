# egov-mcp

AI エージェントから e-Gov 法令 API Version 1 を使うための MCP サーバーです。法令名一覧、法令本文、条文、更新法令一覧を標準入出力の MCP 道具として提供します。

参照した公開資料: https://laws.e-gov.go.jp/docs/law-data-basic/8529371-law-api-v1/

## 使い方

```powershell
npm install
npm start
```

Codex や Claude Desktop などの MCP 設定では、この作業場所を `cwd` にして `node ./src/server.js` を起動します。

```json
{
  "mcpServers": {
    "egov": {
      "command": "node",
      "args": ["./src/server.js"],
      "cwd": "C:\\Users\\nnyaa\\Downloads\\egov"
    }
  }
}
```

## 道具

`search_laws`

法令名、法令番号、法令 ID、公布日で現行法令を検索します。`category` は `all`、`acts`、`orders`、`ministerial_orders` を指定できます。

`get_law`

法令 ID または法令番号で現行法令の全文を取得します。`format` は `text`、`xml`、`json` を指定できます。画像データは本文取得時に存在を示し、JSON 形式では中身を省きます。

`get_article`

法令 ID または法令番号と、条、項、別表の条件で条文を取得します。`format` は `text`、`xml`、`json` を指定できます。

`get_updated_laws`

指定日の更新法令一覧を取得します。日付は `YYYYMMDD` または `YYYY-MM-DD` で指定します。e-Gov 側の仕様上、2020-11-24 以降かつ未来でない日付が対象です。

## 確認

```powershell
npm test
node -e "import('./src/egovClient.js').then(async m => console.log(JSON.stringify(await m.searchLaws({query:'行政手続法', category:'acts', limit:3}), null, 2)))"
node -e "import('./src/egovClient.js').then(async m => console.log((await m.getArticle({law_id:'405AC0000000088', article:'1'})).text))"
```

## AIだと思いましたか？
はい, +rep codex
