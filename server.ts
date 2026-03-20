import http from "node:http";
import { markdownToTelegramHtml, renderTelegramHtmlText } from "./telegram-format";

type FormatRequest = {
  text?: string;
  textMode?: "markdown" | "html";
  tableMode?: "off" | "bullets" | "code";
};

const DEFAULT_PORT = 3000;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function normalizePort(value: string | undefined): number {
  if (!value) {
    return DEFAULT_PORT;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  if (req.method !== "POST" || url.pathname !== "/format") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  try {
    const rawBody = await readBody(req);
    const contentType = req.headers["content-type"] ?? "";

    let input: FormatRequest;
    if (contentType.includes("application/json")) {
      input = JSON.parse(rawBody) as FormatRequest;
    } else {
      input = { text: rawBody };
    }

    const text = input.text ?? "";
    if (!text.trim()) {
      sendJson(res, 400, { error: "text is required" });
      return;
    }

    const textMode = input.textMode ?? "markdown";
    const tableMode = input.tableMode ?? "code";

    const html =
      textMode === "markdown"
        ? markdownToTelegramHtml(text, { tableMode })
        : renderTelegramHtmlText(text, { textMode, tableMode });

    sendJson(res, 200, { html });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { error: message });
  }
});

const port = normalizePort(process.env.PORT);
server.listen(port, () => {
  console.log(`telegram-format server listening on ${port}`);
});
