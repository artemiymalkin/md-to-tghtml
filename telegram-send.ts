import {
  markdownToTelegramChunks,
  renderTelegramHtmlText,
  splitTelegramHtmlChunks,
} from "./telegram-format";

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type TelegramMessage = {
  message_id?: number;
  chat?: { id?: number | string };
};

export type TelegramSendOptions = {
  token: string;
  chatId: string | number;
  textMode?: "markdown" | "html";
  plainText?: string;
  tableMode?: "off" | "bullets" | "code";
  disableNotification?: boolean;
  replyToMessageId?: number;
  messageThreadId?: number;
  linkPreview?: boolean;
};

type TelegramSendResult = {
  messageId: string;
  chatId: string;
};

const PARSE_ERR_RE = /can't parse entities|parse entities|find end of the entity/i;
const TELEGRAM_TEXT_LIMIT = 4000;

function isTelegramHtmlParseError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (typeof error === "string") {
    return PARSE_ERR_RE.test(error);
  }
  if (error instanceof Error) {
    return PARSE_ERR_RE.test(error.message);
  }
  return PARSE_ERR_RE.test(String(error));
}

async function callTelegramApi<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as TelegramApiResponse<T>;
  if (!data.ok) {
    const detail = data.description ?? `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return data.result as T;
}

function resolveMessageId(result: TelegramMessage, context: string): string {
  const messageId = result?.message_id;
  if (typeof messageId === "number" && Number.isFinite(messageId)) {
    return String(Math.trunc(messageId));
  }
  throw new Error(`Telegram ${context} returned no message_id`);
}

function splitTelegramPlainTextChunks(text: string, limit: number): string[] {
  if (!text) {
    return [];
  }
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += normalizedLimit) {
    chunks.push(text.slice(start, start + normalizedLimit));
  }
  return chunks;
}

function splitTelegramPlainTextFallback(text: string, chunkCount: number, limit: number): string[] {
  if (!text) {
    return [];
  }
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const fixedChunks = splitTelegramPlainTextChunks(text, normalizedLimit);
  if (chunkCount <= 1 || fixedChunks.length >= chunkCount) {
    return fixedChunks;
  }
  const chunks: string[] = [];
  let offset = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    const remainingChars = text.length - offset;
    const remainingChunks = chunkCount - index;
    const nextChunkLength =
      remainingChunks === 1
        ? remainingChars
        : Math.min(normalizedLimit, Math.ceil(remainingChars / remainingChunks));
    chunks.push(text.slice(offset, offset + nextChunkLength));
    offset += nextChunkLength;
  }
  return chunks;
}

async function sendMessageChunk(params: {
  token: string;
  chatId: string | number;
  htmlText?: string;
  plainText: string;
  options: Omit<TelegramSendOptions, "token" | "chatId">;
}): Promise<TelegramMessage> {
  const basePayload: Record<string, unknown> = {
    chat_id: params.chatId,
    ...(params.options.disableNotification ? { disable_notification: true } : {}),
    ...(params.options.replyToMessageId != null
      ? { reply_to_message_id: Math.trunc(params.options.replyToMessageId) }
      : {}),
    ...(params.options.messageThreadId != null
      ? { message_thread_id: Math.trunc(params.options.messageThreadId) }
      : {}),
    ...(params.options.linkPreview === false
      ? { link_preview_options: { is_disabled: true } }
      : {}),
  };

  const requestPlain = () =>
    callTelegramApi<TelegramMessage>(params.token, "sendMessage", {
      ...basePayload,
      text: params.plainText,
    });

  if (!params.htmlText) {
    return requestPlain();
  }

  try {
    return await callTelegramApi<TelegramMessage>(params.token, "sendMessage", {
      ...basePayload,
      text: params.htmlText,
      parse_mode: "HTML",
    });
  } catch (error) {
    if (!isTelegramHtmlParseError(error)) {
      throw error;
    }
    return await requestPlain();
  }
}

export async function sendTelegramMessage(
  text: string,
  opts: TelegramSendOptions,
): Promise<TelegramSendResult> {
  const trimmed = text?.trim();
  if (!trimmed) {
    throw new Error("Telegram message must be non-empty");
  }

  const textMode = opts.textMode ?? "markdown";
  const sendOptions = {
    textMode,
    plainText: opts.plainText,
    tableMode: opts.tableMode,
    disableNotification: opts.disableNotification,
    replyToMessageId: opts.replyToMessageId,
    messageThreadId: opts.messageThreadId,
    linkPreview: opts.linkPreview,
  };

  type TelegramTextChunk = { plainText: string; htmlText?: string };
  let chunks: TelegramTextChunk[] = [];

  if (textMode === "html") {
    const htmlChunks = splitTelegramHtmlChunks(text, TELEGRAM_TEXT_LIMIT);
    const fallbackText = opts.plainText ?? text;
    const plainTextChunks = splitTelegramPlainTextFallback(
      fallbackText,
      htmlChunks.length,
      TELEGRAM_TEXT_LIMIT,
    );
    chunks = htmlChunks.map((htmlText, index) => ({
      htmlText,
      plainText: plainTextChunks[index] ?? fallbackText,
    }));
  } else {
    const formattedChunks = markdownToTelegramChunks(text, TELEGRAM_TEXT_LIMIT, {
      tableMode: opts.tableMode,
    });
    chunks = formattedChunks.map((chunk) => ({
      htmlText: chunk.html,
      plainText: opts.plainText ?? chunk.text,
    }));
  }

  let lastMessageId = "";
  let lastChatId = String(opts.chatId);
  for (const chunk of chunks) {
    const result = await sendMessageChunk({
      token: opts.token,
      chatId: opts.chatId,
      htmlText: chunk.htmlText,
      plainText: chunk.plainText,
      options: sendOptions,
    });
    lastMessageId = resolveMessageId(result, "sendMessage");
    lastChatId = String(result?.chat?.id ?? opts.chatId);
  }

  return { messageId: lastMessageId, chatId: lastChatId };
}

export function renderTelegramTextPreview(
  text: string,
  opts: { textMode?: "markdown" | "html"; tableMode?: "off" | "bullets" | "code" } = {},
): string {
  return renderTelegramHtmlText(text, {
    textMode: opts.textMode,
    tableMode: opts.tableMode,
  });
}
