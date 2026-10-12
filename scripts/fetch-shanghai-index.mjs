// 只读探针：抓取上证指数双源行情并打印，不写任何文件。
// 解析与交叉核验逻辑与 Worker 定时任务、scripts/refresh-index.mjs 共用。
import { fetchIndexQuote } from "../lib/index-quote.ts";

console.log(JSON.stringify(await fetchIndexQuote(), null, 2));
