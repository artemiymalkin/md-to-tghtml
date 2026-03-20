import MarkdownIt from "markdown-it";

export type MarkdownTableMode = "off" | "bullets" | "code";

export type TelegramFormattedChunk = {
  html: string;
  text: string;
};

type MarkdownToken = {
  type: string;
  content?: string;
  children?: MarkdownToken[];
  attrs?: [string, string][];
  attrGet?: (name: string) => string | null;
};

export type MarkdownStyle =
  | "bold"
  | "italic"
  | "strikethrough"
  | "code"
  | "code_block"
  | "spoiler"
  | "blockquote";

export type MarkdownStyleSpan = {
  start: number;
  end: number;
  style: MarkdownStyle;
};

export type MarkdownLinkSpan = {
  start: number;
  end: number;
  href: string;
};

export type MarkdownIR = {
  text: string;
  styles: MarkdownStyleSpan[];
  links: MarkdownLinkSpan[];
};

export type RenderStyleMarker = {
  open: string;
  close: string;
};

export type RenderStyleMap = Partial<Record<MarkdownStyle, RenderStyleMarker>>;

export type RenderLink = {
  start: number;
  end: number;
  open: string;
  close: string;
};

export type RenderOptions = {
  styleMarkers: RenderStyleMap;
  escapeText: (text: string) => string;
  buildLink?: (link: MarkdownLinkSpan, text: string) => RenderLink | null;
};

type ListState = {
  type: "bullet" | "ordered";
  index: number;
};

type LinkState = {
  href: string;
  labelStart: number;
};

type RenderEnv = {
  listStack: ListState[];
};

type OpenStyle = {
  style: MarkdownStyle;
  start: number;
};

type RenderTarget = {
  text: string;
  styles: MarkdownStyleSpan[];
  openStyles: OpenStyle[];
  links: MarkdownLinkSpan[];
  linkStack: LinkState[];
};

type TableCell = {
  text: string;
  styles: MarkdownStyleSpan[];
  links: MarkdownLinkSpan[];
};

type TableState = {
  headers: TableCell[];
  rows: TableCell[][];
  currentRow: TableCell[];
  currentCell: RenderTarget | null;
  inHeader: boolean;
};

type RenderState = RenderTarget & {
  env: RenderEnv;
  headingStyle: "none" | "bold";
  blockquotePrefix: string;
  enableSpoilers: boolean;
  tableMode: MarkdownTableMode;
  table: TableState | null;
  hasTables: boolean;
};

export type MarkdownParseOptions = {
  linkify?: boolean;
  enableSpoilers?: boolean;
  headingStyle?: "none" | "bold";
  blockquotePrefix?: string;
  autolink?: boolean;
  tableMode?: MarkdownTableMode;
};

function chunkTextByBreakResolver(
  text: string,
  limit: number,
  resolveBreakIndex: (window: string) => number,
): string[] {
  if (!text) {
    return [];
  }
  if (limit <= 0 || text.length <= limit) {
    return [text];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    const candidateBreak = resolveBreakIndex(window);
    const breakIdx =
      Number.isFinite(candidateBreak) && candidateBreak > 0 && candidateBreak <= limit
        ? candidateBreak
        : limit;
    const rawChunk = remaining.slice(0, breakIdx);
    const chunk = rawChunk.trimEnd();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    const brokeOnSeparator = breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
    const nextStart = Math.min(remaining.length, breakIdx + (brokeOnSeparator ? 1 : 0));
    remaining = remaining.slice(nextStart).trimStart();
  }
  if (remaining.length) {
    chunks.push(remaining);
  }
  return chunks;
}

function scanParenAwareBreakpoints(
  text: string,
  start: number,
  end: number,
): { lastNewline: number; lastWhitespace: number } {
  let lastNewline = -1;
  let lastWhitespace = -1;
  let depth = 0;

  for (let i = start; i < end; i++) {
    const char = text[i];
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth !== 0) {
      continue;
    }
    if (char === "\n") {
      lastNewline = i;
    } else if (/\s/.test(char)) {
      lastWhitespace = i;
    }
  }

  return { lastNewline, lastWhitespace };
}

function chunkText(text: string, limit: number): string[] {
  if (!text) {
    return [];
  }
  if (limit <= 0 || text.length <= limit) {
    return [text];
  }
  return chunkTextByBreakResolver(text, limit, (window) => {
    const { lastNewline, lastWhitespace } = scanParenAwareBreakpoints(window, 0, window.length);
    return lastNewline > 0 ? lastNewline : lastWhitespace;
  });
}

function createMarkdownIt(options: MarkdownParseOptions): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: options.linkify ?? true,
    breaks: false,
    typographer: false,
  });
  md.enable("strikethrough");
  if (options.tableMode && options.tableMode !== "off") {
    md.enable("table");
  } else {
    md.disable("table");
  }
  if (options.autolink === false) {
    md.disable("autolink");
  }
  return md;
}

function getAttr(token: MarkdownToken, name: string): string | null {
  if (token.attrGet) {
    return token.attrGet(name);
  }
  if (token.attrs) {
    for (const [key, value] of token.attrs) {
      if (key === name) {
        return value;
      }
    }
  }
  return null;
}

function createTextToken(base: MarkdownToken, content: string): MarkdownToken {
  return { ...base, type: "text", content, children: undefined };
}

function applySpoilerTokens(tokens: MarkdownToken[]): void {
  for (const token of tokens) {
    if (token.children && token.children.length > 0) {
      token.children = injectSpoilersIntoInline(token.children);
    }
  }
}

function injectSpoilersIntoInline(tokens: MarkdownToken[]): MarkdownToken[] {
  let totalDelims = 0;
  for (const token of tokens) {
    if (token.type !== "text") {
      continue;
    }
    const content = token.content ?? "";
    let i = 0;
    while (i < content.length) {
      const next = content.indexOf("||", i);
      if (next === -1) {
        break;
      }
      totalDelims += 1;
      i = next + 2;
    }
  }

  if (totalDelims < 2) {
    return tokens;
  }
  const usableDelims = totalDelims - (totalDelims % 2);

  const result: MarkdownToken[] = [];
  const state = { spoilerOpen: false };
  let consumedDelims = 0;

  for (const token of tokens) {
    if (token.type !== "text") {
      result.push(token);
      continue;
    }

    const content = token.content ?? "";
    if (!content.includes("||")) {
      result.push(token);
      continue;
    }

    let index = 0;
    while (index < content.length) {
      const next = content.indexOf("||", index);
      if (next === -1) {
        if (index < content.length) {
          result.push(createTextToken(token, content.slice(index)));
        }
        break;
      }
      if (consumedDelims >= usableDelims) {
        result.push(createTextToken(token, content.slice(index)));
        break;
      }
      if (next > index) {
        result.push(createTextToken(token, content.slice(index, next)));
      }
      consumedDelims += 1;
      state.spoilerOpen = !state.spoilerOpen;
      result.push({
        type: state.spoilerOpen ? "spoiler_open" : "spoiler_close",
      });
      index = next + 2;
    }
  }

  return result;
}

function initRenderTarget(): RenderTarget {
  return {
    text: "",
    styles: [],
    openStyles: [],
    links: [],
    linkStack: [],
  };
}

function resolveRenderTarget(state: RenderState): RenderTarget {
  return state.table?.currentCell ?? state;
}

function appendText(state: RenderState, value: string) {
  if (!value) {
    return;
  }
  const target = resolveRenderTarget(state);
  target.text += value;
}

function openStyle(state: RenderState, style: MarkdownStyle) {
  const target = resolveRenderTarget(state);
  target.openStyles.push({ style, start: target.text.length });
}

function closeStyle(state: RenderState, style: MarkdownStyle) {
  const target = resolveRenderTarget(state);
  for (let i = target.openStyles.length - 1; i >= 0; i -= 1) {
    if (target.openStyles[i]?.style === style) {
      const start = target.openStyles[i].start;
      target.openStyles.splice(i, 1);
      const end = target.text.length;
      if (end > start) {
        target.styles.push({ start, end, style });
      }
      return;
    }
  }
}

function appendParagraphSeparator(state: RenderState) {
  if (state.env.listStack.length > 0) {
    return;
  }
  if (state.table) {
    return;
  }
  state.text += "\n\n";
}

function appendListPrefix(state: RenderState) {
  const stack = state.env.listStack;
  const top = stack[stack.length - 1];
  if (!top) {
    return;
  }
  top.index += 1;
  const indent = "  ".repeat(Math.max(0, stack.length - 1));
  const prefix = top.type === "ordered" ? `${top.index}. ` : "• ";
  state.text += `${indent}${prefix}`;
}

function renderInlineCode(state: RenderState, content: string) {
  if (!content) {
    return;
  }
  const target = resolveRenderTarget(state);
  const start = target.text.length;
  target.text += content;
  target.styles.push({ start, end: start + content.length, style: "code" });
}

function renderCodeBlock(state: RenderState, content: string) {
  let code = content ?? "";
  if (!code.endsWith("\n")) {
    code = `${code}\n`;
  }
  const target = resolveRenderTarget(state);
  const start = target.text.length;
  target.text += code;
  target.styles.push({ start, end: start + code.length, style: "code_block" });
  if (state.env.listStack.length === 0) {
    target.text += "\n";
  }
}

function handleLinkClose(state: RenderState) {
  const target = resolveRenderTarget(state);
  const link = target.linkStack.pop();
  if (!link?.href) {
    return;
  }
  const href = link.href.trim();
  if (!href) {
    return;
  }
  const start = link.labelStart;
  const end = target.text.length;
  target.links.push({ start, end, href });
}

function initTableState(): TableState {
  return {
    headers: [],
    rows: [],
    currentRow: [],
    currentCell: null,
    inHeader: false,
  };
}

function finishTableCell(cell: RenderTarget): TableCell {
  closeRemainingStyles(cell);
  return {
    text: cell.text,
    styles: cell.styles,
    links: cell.links,
  };
}

function trimCell(cell: TableCell): TableCell {
  const text = cell.text;
  let start = 0;
  let end = text.length;
  while (start < end && /\s/.test(text[start] ?? "")) {
    start += 1;
  }
  while (end > start && /\s/.test(text[end - 1] ?? "")) {
    end -= 1;
  }
  if (start === 0 && end === text.length) {
    return cell;
  }
  const trimmedText = text.slice(start, end);
  const trimmedLength = trimmedText.length;
  const trimmedStyles: MarkdownStyleSpan[] = [];
  for (const span of cell.styles) {
    const sliceStart = Math.max(0, span.start - start);
    const sliceEnd = Math.min(trimmedLength, span.end - start);
    if (sliceEnd > sliceStart) {
      trimmedStyles.push({ start: sliceStart, end: sliceEnd, style: span.style });
    }
  }
  const trimmedLinks: MarkdownLinkSpan[] = [];
  for (const span of cell.links) {
    const sliceStart = Math.max(0, span.start - start);
    const sliceEnd = Math.min(trimmedLength, span.end - start);
    if (sliceEnd > sliceStart) {
      trimmedLinks.push({ start: sliceStart, end: sliceEnd, href: span.href });
    }
  }
  return { text: trimmedText, styles: trimmedStyles, links: trimmedLinks };
}

function appendCell(state: RenderState, cell: TableCell) {
  if (!cell.text) {
    return;
  }
  const start = state.text.length;
  state.text += cell.text;
  for (const span of cell.styles) {
    state.styles.push({
      start: start + span.start,
      end: start + span.end,
      style: span.style,
    });
  }
  for (const link of cell.links) {
    state.links.push({
      start: start + link.start,
      end: start + link.end,
      href: link.href,
    });
  }
}

function appendCellTextOnly(state: RenderState, cell: TableCell) {
  if (!cell.text) {
    return;
  }
  state.text += cell.text;
}

function appendTableBulletValue(
  state: RenderState,
  params: {
    header?: TableCell;
    value?: TableCell;
    columnIndex: number;
    includeColumnFallback: boolean;
  },
) {
  const { header, value, columnIndex, includeColumnFallback } = params;
  if (!value?.text) {
    return;
  }
  state.text += "• ";
  if (header?.text) {
    appendCell(state, header);
    state.text += ": ";
  } else if (includeColumnFallback) {
    state.text += `Column ${columnIndex}: `;
  }
  appendCell(state, value);
  state.text += "\n";
}

function renderTableAsBullets(state: RenderState) {
  if (!state.table) {
    return;
  }
  const headers = state.table.headers.map(trimCell);
  const rows = state.table.rows.map((row) => row.map(trimCell));

  if (headers.length === 0 && rows.length === 0) {
    return;
  }

  const useFirstColAsLabel = headers.length > 1 && rows.length > 0;

  if (useFirstColAsLabel) {
    for (const row of rows) {
      if (row.length === 0) {
        continue;
      }

      const rowLabel = row[0];
      if (rowLabel?.text) {
        const labelStart = state.text.length;
        appendCell(state, rowLabel);
        const labelEnd = state.text.length;
        if (labelEnd > labelStart) {
          state.styles.push({ start: labelStart, end: labelEnd, style: "bold" });
        }
        state.text += "\n";
      }

      for (let i = 1; i < row.length; i++) {
        appendTableBulletValue(state, {
          header: headers[i],
          value: row[i],
          columnIndex: i,
          includeColumnFallback: true,
        });
      }
      state.text += "\n";
    }
  } else {
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        appendTableBulletValue(state, {
          header: headers[i],
          value: row[i],
          columnIndex: i,
          includeColumnFallback: false,
        });
      }
      state.text += "\n";
    }
  }
}

function renderTableAsCode(state: RenderState) {
  if (!state.table) {
    return;
  }
  const headers = state.table.headers.map(trimCell);
  const rows = state.table.rows.map((row) => row.map(trimCell));

  const columnCount = Math.max(headers.length, ...rows.map((row) => row.length));
  if (columnCount === 0) {
    return;
  }

  const widths = Array.from({ length: columnCount }, () => 0);
  const updateWidths = (cells: TableCell[]) => {
    for (let i = 0; i < columnCount; i += 1) {
      const cell = cells[i];
      const width = cell?.text.length ?? 0;
      if (widths[i] < width) {
        widths[i] = width;
      }
    }
  };
  updateWidths(headers);
  for (const row of rows) {
    updateWidths(row);
  }

  const codeStart = state.text.length;

  const appendRow = (cells: TableCell[]) => {
    state.text += "|";
    for (let i = 0; i < columnCount; i += 1) {
      state.text += " ";
      const cell = cells[i];
      if (cell) {
        appendCellTextOnly(state, cell);
      }
      const pad = widths[i] - (cell?.text.length ?? 0);
      if (pad > 0) {
        state.text += " ".repeat(pad);
      }
      state.text += " |";
    }
    state.text += "\n";
  };

  const appendDivider = () => {
    state.text += "|";
    for (let i = 0; i < columnCount; i += 1) {
      const dashCount = Math.max(3, widths[i]);
      state.text += ` ${"-".repeat(dashCount)} |`;
    }
    state.text += "\n";
  };

  appendRow(headers);
  appendDivider();
  for (const row of rows) {
    appendRow(row);
  }

  const codeEnd = state.text.length;
  if (codeEnd > codeStart) {
    state.styles.push({ start: codeStart, end: codeEnd, style: "code_block" });
  }
  if (state.env.listStack.length === 0) {
    state.text += "\n";
  }
}

function renderTokens(tokens: MarkdownToken[], state: RenderState): void {
  for (const token of tokens) {
    switch (token.type) {
      case "inline":
        if (token.children) {
          renderTokens(token.children, state);
        }
        break;
      case "text":
        appendText(state, token.content ?? "");
        break;
      case "em_open":
        openStyle(state, "italic");
        break;
      case "em_close":
        closeStyle(state, "italic");
        break;
      case "strong_open":
        openStyle(state, "bold");
        break;
      case "strong_close":
        closeStyle(state, "bold");
        break;
      case "s_open":
        openStyle(state, "strikethrough");
        break;
      case "s_close":
        closeStyle(state, "strikethrough");
        break;
      case "code_inline":
        renderInlineCode(state, token.content ?? "");
        break;
      case "spoiler_open":
        if (state.enableSpoilers) {
          openStyle(state, "spoiler");
        }
        break;
      case "spoiler_close":
        if (state.enableSpoilers) {
          closeStyle(state, "spoiler");
        }
        break;
      case "link_open": {
        const href = getAttr(token, "href") ?? "";
        const target = resolveRenderTarget(state);
        target.linkStack.push({ href, labelStart: target.text.length });
        break;
      }
      case "link_close":
        handleLinkClose(state);
        break;
      case "image":
        appendText(state, token.content ?? "");
        break;
      case "softbreak":
      case "hardbreak":
        appendText(state, "\n");
        break;
      case "paragraph_close":
        appendParagraphSeparator(state);
        break;
      case "heading_open":
        if (state.headingStyle === "bold") {
          openStyle(state, "bold");
        }
        break;
      case "heading_close":
        if (state.headingStyle === "bold") {
          closeStyle(state, "bold");
        }
        appendParagraphSeparator(state);
        break;
      case "blockquote_open":
        if (state.blockquotePrefix) {
          state.text += state.blockquotePrefix;
        }
        openStyle(state, "blockquote");
        break;
      case "blockquote_close":
        closeStyle(state, "blockquote");
        break;
      case "bullet_list_open":
        if (state.env.listStack.length > 0) {
          state.text += "\n";
        }
        state.env.listStack.push({ type: "bullet", index: 0 });
        break;
      case "bullet_list_close":
        state.env.listStack.pop();
        if (state.env.listStack.length === 0) {
          state.text += "\n";
        }
        break;
      case "ordered_list_open": {
        if (state.env.listStack.length > 0) {
          state.text += "\n";
        }
        const start = Number(getAttr(token, "start") ?? "1");
        state.env.listStack.push({ type: "ordered", index: start - 1 });
        break;
      }
      case "ordered_list_close":
        state.env.listStack.pop();
        if (state.env.listStack.length === 0) {
          state.text += "\n";
        }
        break;
      case "list_item_open":
        appendListPrefix(state);
        break;
      case "list_item_close":
        if (!state.text.endsWith("\n")) {
          state.text += "\n";
        }
        break;
      case "code_block":
      case "fence":
        renderCodeBlock(state, token.content ?? "");
        break;
      case "html_block":
      case "html_inline":
        appendText(state, token.content ?? "");
        break;
      case "table_open":
        if (state.tableMode !== "off") {
          state.table = initTableState();
          state.hasTables = true;
        }
        break;
      case "table_close":
        if (state.table) {
          if (state.tableMode === "bullets") {
            renderTableAsBullets(state);
          } else if (state.tableMode === "code") {
            renderTableAsCode(state);
          }
        }
        state.table = null;
        break;
      case "thead_open":
        if (state.table) {
          state.table.inHeader = true;
        }
        break;
      case "thead_close":
        if (state.table) {
          state.table.inHeader = false;
        }
        break;
      case "tbody_open":
      case "tbody_close":
        break;
      case "tr_open":
        if (state.table) {
          state.table.currentRow = [];
        }
        break;
      case "tr_close":
        if (state.table) {
          if (state.table.inHeader) {
            state.table.headers = state.table.currentRow;
          } else {
            state.table.rows.push(state.table.currentRow);
          }
          state.table.currentRow = [];
        }
        break;
      case "th_open":
      case "td_open":
        if (state.table) {
          state.table.currentCell = initRenderTarget();
        }
        break;
      case "th_close":
      case "td_close":
        if (state.table?.currentCell) {
          state.table.currentRow.push(finishTableCell(state.table.currentCell));
          state.table.currentCell = null;
        }
        break;
      case "hr":
        state.text += "───\n\n";
        break;
      default:
        if (token.children) {
          renderTokens(token.children, state);
        }
        break;
    }
  }
}

function closeRemainingStyles(target: RenderTarget) {
  for (let i = target.openStyles.length - 1; i >= 0; i -= 1) {
    const open = target.openStyles[i];
    const end = target.text.length;
    if (end > open.start) {
      target.styles.push({
        start: open.start,
        end,
        style: open.style,
      });
    }
  }
  target.openStyles = [];
}

function clampStyleSpans(spans: MarkdownStyleSpan[], maxLength: number): MarkdownStyleSpan[] {
  const clamped: MarkdownStyleSpan[] = [];
  for (const span of spans) {
    const start = Math.max(0, Math.min(span.start, maxLength));
    const end = Math.max(start, Math.min(span.end, maxLength));
    if (end > start) {
      clamped.push({ start, end, style: span.style });
    }
  }
  return clamped;
}

function clampLinkSpans(spans: MarkdownLinkSpan[], maxLength: number): MarkdownLinkSpan[] {
  const clamped: MarkdownLinkSpan[] = [];
  for (const span of spans) {
    const start = Math.max(0, Math.min(span.start, maxLength));
    const end = Math.max(start, Math.min(span.end, maxLength));
    if (end > start) {
      clamped.push({ start, end, href: span.href });
    }
  }
  return clamped;
}

function mergeStyleSpans(spans: MarkdownStyleSpan[]): MarkdownStyleSpan[] {
  const sorted = [...spans].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    if (a.end !== b.end) {
      return a.end - b.end;
    }
    return a.style.localeCompare(b.style);
  });

  const merged: MarkdownStyleSpan[] = [];
  for (const span of sorted) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.style === span.style &&
      (span.start < prev.end || (span.start === prev.end && span.style !== "blockquote"))
    ) {
      prev.end = Math.max(prev.end, span.end);
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

function resolveSliceBounds(
  span: { start: number; end: number },
  start: number,
  end: number,
): { start: number; end: number } | null {
  const sliceStart = Math.max(span.start, start);
  const sliceEnd = Math.min(span.end, end);
  if (sliceEnd <= sliceStart) {
    return null;
  }
  return { start: sliceStart, end: sliceEnd };
}

function sliceStyleSpans(spans: MarkdownStyleSpan[], start: number, end: number) {
  if (spans.length === 0) {
    return [];
  }
  const sliced: MarkdownStyleSpan[] = [];
  for (const span of spans) {
    const bounds = resolveSliceBounds(span, start, end);
    if (!bounds) {
      continue;
    }
    sliced.push({
      start: bounds.start - start,
      end: bounds.end - start,
      style: span.style,
    });
  }
  return mergeStyleSpans(sliced);
}

function sliceLinkSpans(spans: MarkdownLinkSpan[], start: number, end: number) {
  if (spans.length === 0) {
    return [];
  }
  const sliced: MarkdownLinkSpan[] = [];
  for (const span of spans) {
    const bounds = resolveSliceBounds(span, start, end);
    if (!bounds) {
      continue;
    }
    sliced.push({
      start: bounds.start - start,
      end: bounds.end - start,
      href: span.href,
    });
  }
  return sliced;
}

export function markdownToIR(markdown: string, options: MarkdownParseOptions = {}): MarkdownIR {
  const env: RenderEnv = { listStack: [] };
  const md = createMarkdownIt(options);
  const tokens = md.parse(markdown ?? "", env as unknown as object);
  if (options.enableSpoilers) {
    applySpoilerTokens(tokens as MarkdownToken[]);
  }

  const tableMode = options.tableMode ?? "off";

  const state: RenderState = {
    text: "",
    styles: [],
    openStyles: [],
    links: [],
    linkStack: [],
    env,
    headingStyle: options.headingStyle ?? "none",
    blockquotePrefix: options.blockquotePrefix ?? "",
    enableSpoilers: options.enableSpoilers ?? false,
    tableMode,
    table: null,
    hasTables: false,
  };

  renderTokens(tokens as MarkdownToken[], state);
  closeRemainingStyles(state);

  const trimmedText = state.text.trimEnd();
  const trimmedLength = trimmedText.length;
  let codeBlockEnd = 0;
  for (const span of state.styles) {
    if (span.style !== "code_block") {
      continue;
    }
    if (span.end > codeBlockEnd) {
      codeBlockEnd = span.end;
    }
  }
  const finalLength = Math.max(trimmedLength, codeBlockEnd);
  const finalText =
    finalLength === state.text.length ? state.text : state.text.slice(0, finalLength);

  return {
    text: finalText,
    styles: mergeStyleSpans(clampStyleSpans(state.styles, finalLength)),
    links: clampLinkSpans(state.links, finalLength),
  };
}

export function chunkMarkdownIR(ir: MarkdownIR, limit: number): MarkdownIR[] {
  if (!ir.text) {
    return [];
  }
  if (limit <= 0 || ir.text.length <= limit) {
    return [ir];
  }

  const chunks = chunkText(ir.text, limit);
  const results: MarkdownIR[] = [];
  let cursor = 0;

  chunks.forEach((chunk, index) => {
    if (!chunk) {
      return;
    }
    if (index > 0) {
      while (cursor < ir.text.length && /\s/.test(ir.text[cursor] ?? "")) {
        cursor += 1;
      }
    }
    const start = cursor;
    const end = Math.min(ir.text.length, start + chunk.length);
    results.push({
      text: chunk,
      styles: sliceStyleSpans(ir.styles, start, end),
      links: sliceLinkSpans(ir.links, start, end),
    });
    cursor = end;
  });

  return results;
}

const STYLE_ORDER: MarkdownStyle[] = [
  "blockquote",
  "code_block",
  "code",
  "bold",
  "italic",
  "strikethrough",
  "spoiler",
];

const STYLE_RANK = new Map<MarkdownStyle, number>(STYLE_ORDER.map((style, index) => [style, index]));

function sortStyleSpans(spans: MarkdownStyleSpan[]): MarkdownStyleSpan[] {
  return [...spans].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    if (a.end !== b.end) {
      return b.end - a.end;
    }
    return (STYLE_RANK.get(a.style) ?? 0) - (STYLE_RANK.get(b.style) ?? 0);
  });
}

export function renderMarkdownWithMarkers(ir: MarkdownIR, options: RenderOptions): string {
  const text = ir.text ?? "";
  if (!text) {
    return "";
  }

  const styleMarkers = options.styleMarkers;
  const styled = sortStyleSpans(ir.styles.filter((span) => Boolean(styleMarkers[span.style])));

  const boundaries = new Set<number>();
  boundaries.add(0);
  boundaries.add(text.length);

  const startsAt = new Map<number, MarkdownStyleSpan[]>();
  for (const span of styled) {
    if (span.start === span.end) {
      continue;
    }
    boundaries.add(span.start);
    boundaries.add(span.end);
    const bucket = startsAt.get(span.start);
    if (bucket) {
      bucket.push(span);
    } else {
      startsAt.set(span.start, [span]);
    }
  }
  for (const spans of startsAt.values()) {
    spans.sort((a, b) => {
      if (a.end !== b.end) {
        return b.end - a.end;
      }
      return (STYLE_RANK.get(a.style) ?? 0) - (STYLE_RANK.get(b.style) ?? 0);
    });
  }

  const linkStarts = new Map<number, RenderLink[]>();
  if (options.buildLink) {
    for (const link of ir.links) {
      if (link.start === link.end) {
        continue;
      }
      const rendered = options.buildLink(link, text);
      if (!rendered) {
        continue;
      }
      boundaries.add(rendered.start);
      boundaries.add(rendered.end);
      const openBucket = linkStarts.get(rendered.start);
      if (openBucket) {
        openBucket.push(rendered);
      } else {
        linkStarts.set(rendered.start, [rendered]);
      }
    }
  }

  const points = [...boundaries].sort((a, b) => a - b);
  const stack: { close: string; end: number }[] = [];
  type OpeningItem =
    | { end: number; open: string; close: string; kind: "link"; index: number }
    | {
        end: number;
        open: string;
        close: string;
        kind: "style";
        style: MarkdownStyle;
        index: number;
      };
  let out = "";

  for (let i = 0; i < points.length; i += 1) {
    const pos = points[i];

    while (stack.length && stack[stack.length - 1]?.end === pos) {
      const item = stack.pop();
      if (item) {
        out += item.close;
      }
    }

    const openingItems: OpeningItem[] = [];

    const openingLinks = linkStarts.get(pos);
    if (openingLinks && openingLinks.length > 0) {
      for (const [index, link] of openingLinks.entries()) {
        openingItems.push({
          end: link.end,
          open: link.open,
          close: link.close,
          kind: "link",
          index,
        });
      }
    }

    const openingStyles = startsAt.get(pos);
    if (openingStyles) {
      for (const [index, span] of openingStyles.entries()) {
        const marker = styleMarkers[span.style];
        if (!marker) {
          continue;
        }
        openingItems.push({
          end: span.end,
          open: marker.open,
          close: marker.close,
          kind: "style",
          style: span.style,
          index,
        });
      }
    }

    if (openingItems.length > 0) {
      openingItems.sort((a, b) => {
        if (a.end !== b.end) {
          return b.end - a.end;
        }
        if (a.kind !== b.kind) {
          return a.kind === "link" ? -1 : 1;
        }
        if (a.kind === "style" && b.kind === "style") {
          return (STYLE_RANK.get(a.style) ?? 0) - (STYLE_RANK.get(b.style) ?? 0);
        }
        return a.index - b.index;
      });

      for (const item of openingItems) {
        out += item.open;
        stack.push({ close: item.close, end: item.end });
      }
    }

    const next = points[i + 1];
    if (next === undefined) {
      break;
    }
    if (next > pos) {
      out += options.escapeText(text.slice(pos, next));
    }
  }

  return out;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

const FILE_EXTENSIONS_WITH_TLD = new Set(["md", "go", "py", "pl", "sh", "am", "at", "be", "cc"]);

function isAutoLinkedFileRef(href: string, label: string): boolean {
  const stripped = href.replace(/^https?:\/\//i, "");
  if (stripped !== label) {
    return false;
  }
  const dotIndex = label.lastIndexOf(".");
  if (dotIndex < 1) {
    return false;
  }
  const ext = label.slice(dotIndex + 1).toLowerCase();
  if (!FILE_EXTENSIONS_WITH_TLD.has(ext)) {
    return false;
  }
  const segments = label.split("/");
  if (segments.length > 1) {
    for (let i = 0; i < segments.length - 1; i++) {
      if (segments[i].includes(".")) {
        return false;
      }
    }
  }
  return true;
}

function buildTelegramLink(link: MarkdownLinkSpan, text: string) {
  const href = link.href.trim();
  if (!href) {
    return null;
  }
  if (link.start === link.end) {
    return null;
  }
  const label = text.slice(link.start, link.end);
  if (isAutoLinkedFileRef(href, label)) {
    return null;
  }
  const safeHref = escapeHtmlAttr(href);
  return {
    start: link.start,
    end: link.end,
    open: `<a href="${safeHref}">`,
    close: "</a>",
  };
}

function renderTelegramHtml(ir: MarkdownIR): string {
  return renderMarkdownWithMarkers(ir, {
    styleMarkers: {
      bold: { open: "<b>", close: "</b>" },
      italic: { open: "<i>", close: "</i>" },
      strikethrough: { open: "<s>", close: "</s>" },
      code: { open: "<code>", close: "</code>" },
      code_block: { open: "<pre><code>", close: "</code></pre>" },
      spoiler: { open: "<tg-spoiler>", close: "</tg-spoiler>" },
      blockquote: { open: "<blockquote>", close: "</blockquote>" },
    },
    escapeText: escapeHtml,
    buildLink: buildTelegramLink,
  });
}

export function markdownToTelegramHtml(
  markdown: string,
  options: { tableMode?: MarkdownTableMode; wrapFileRefs?: boolean } = {},
): string {
  const ir = markdownToIR(markdown ?? "", {
    linkify: true,
    enableSpoilers: true,
    headingStyle: "none",
    blockquotePrefix: "",
    tableMode: options.tableMode,
  });
  const html = renderTelegramHtml(ir);
  if (options.wrapFileRefs !== false) {
    return wrapFileReferencesInHtml(html);
  }
  return html;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const FILE_EXTENSIONS_PATTERN = Array.from(FILE_EXTENSIONS_WITH_TLD).map(escapeRegex).join("|");
const AUTO_LINKED_ANCHOR_PATTERN = /<a\s+href="https?:\/\/([^"]+)"[^>]*>\1<\/a>/gi;
const FILE_REFERENCE_PATTERN = new RegExp(
  `(^|[^a-zA-Z0-9_\\-/])([a-zA-Z0-9_.\\-./]+\\.(?:${FILE_EXTENSIONS_PATTERN}))(?=$|[^a-zA-Z0-9_\\-/])`,
  "gi",
);
const ORPHANED_TLD_PATTERN = new RegExp(
  `([^a-zA-Z0-9]|^)([A-Za-z]\\.(?:${FILE_EXTENSIONS_PATTERN}))(?=[^a-zA-Z0-9/]|$)`,
  "g",
);
const HTML_TAG_PATTERN = /(<\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?>/gi;

function wrapStandaloneFileRef(match: string, prefix: string, filename: string): string {
  if (filename.startsWith("//")) {
    return match;
  }
  if (/https?:\/\/$/i.test(prefix)) {
    return match;
  }
  return `${prefix}<code>${escapeHtml(filename)}</code>`;
}

function wrapSegmentFileRefs(
  text: string,
  codeDepth: number,
  preDepth: number,
  anchorDepth: number,
): string {
  if (!text || codeDepth > 0 || preDepth > 0 || anchorDepth > 0) {
    return text;
  }
  const wrappedStandalone = text.replace(FILE_REFERENCE_PATTERN, wrapStandaloneFileRef);
  return wrappedStandalone.replace(ORPHANED_TLD_PATTERN, (match, prefix: string, tld: string) =>
    prefix === ">" ? match : `${prefix}<code>${escapeHtml(tld)}</code>`,
  );
}

export function wrapFileReferencesInHtml(html: string): string {
  AUTO_LINKED_ANCHOR_PATTERN.lastIndex = 0;
  const deLinkified = html.replace(AUTO_LINKED_ANCHOR_PATTERN, (_match, label: string) => {
    if (!isAutoLinkedFileRef(`http://${label}`, label)) {
      return _match;
    }
    return `<code>${escapeHtml(label)}</code>`;
  });

  let codeDepth = 0;
  let preDepth = 0;
  let anchorDepth = 0;
  let result = "";
  let lastIndex = 0;

  HTML_TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = HTML_TAG_PATTERN.exec(deLinkified)) !== null) {
    const tagStart = match.index;
    const tagEnd = HTML_TAG_PATTERN.lastIndex;
    const isClosing = match[1] === "</";
    const tagName = match[2].toLowerCase();

    const textBefore = deLinkified.slice(lastIndex, tagStart);
    result += wrapSegmentFileRefs(textBefore, codeDepth, preDepth, anchorDepth);

    if (tagName === "code") {
      codeDepth = isClosing ? Math.max(0, codeDepth - 1) : codeDepth + 1;
    } else if (tagName === "pre") {
      preDepth = isClosing ? Math.max(0, preDepth - 1) : preDepth + 1;
    } else if (tagName === "a") {
      anchorDepth = isClosing ? Math.max(0, anchorDepth - 1) : anchorDepth + 1;
    }

    result += deLinkified.slice(tagStart, tagEnd);
    lastIndex = tagEnd;
  }

  const remainingText = deLinkified.slice(lastIndex);
  result += wrapSegmentFileRefs(remainingText, codeDepth, preDepth, anchorDepth);

  return result;
}

export function renderTelegramHtmlText(
  text: string,
  options: { textMode?: "markdown" | "html"; tableMode?: MarkdownTableMode } = {},
): string {
  const textMode = options.textMode ?? "markdown";
  if (textMode === "html") {
    return text;
  }
  return markdownToTelegramHtml(text, { tableMode: options.tableMode });
}

type TelegramHtmlTag = {
  name: string;
  openTag: string;
  closeTag: string;
};

const TELEGRAM_SELF_CLOSING_HTML_TAGS = new Set(["br"]);

function buildTelegramHtmlOpenPrefix(tags: TelegramHtmlTag[]): string {
  return tags.map((tag) => tag.openTag).join("");
}

function buildTelegramHtmlCloseSuffix(tags: TelegramHtmlTag[]): string {
  return tags
    .slice()
    .reverse()
    .map((tag) => tag.closeTag)
    .join("");
}

function buildTelegramHtmlCloseSuffixLength(tags: TelegramHtmlTag[]): number {
  return tags.reduce((total, tag) => total + tag.closeTag.length, 0);
}

function findTelegramHtmlEntityEnd(text: string, start: number): number {
  if (text[start] !== "&") {
    return -1;
  }
  let index = start + 1;
  if (index >= text.length) {
    return -1;
  }
  if (text[index] === "#") {
    index += 1;
    if (index >= text.length) {
      return -1;
    }
    const isHex = text[index] === "x" || text[index] === "X";
    if (isHex) {
      index += 1;
      const hexStart = index;
      while (/[0-9A-Fa-f]/.test(text[index] ?? "")) {
        index += 1;
      }
      if (index === hexStart) {
        return -1;
      }
    } else {
      const digitStart = index;
      while (/[0-9]/.test(text[index] ?? "")) {
        index += 1;
      }
      if (index === digitStart) {
        return -1;
      }
    }
  } else {
    const nameStart = index;
    while (/[A-Za-z0-9]/.test(text[index] ?? "")) {
      index += 1;
    }
    if (index === nameStart) {
      return -1;
    }
  }
  return text[index] === ";" ? index : -1;
}

function findTelegramHtmlSafeSplitIndex(text: string, maxLength: number): number {
  if (text.length <= maxLength) {
    return text.length;
  }
  const normalizedMaxLength = Math.max(1, Math.floor(maxLength));
  const lastAmpersand = text.lastIndexOf("&", normalizedMaxLength - 1);
  if (lastAmpersand === -1) {
    return normalizedMaxLength;
  }
  const lastSemicolon = text.lastIndexOf(";", normalizedMaxLength - 1);
  if (lastAmpersand < lastSemicolon) {
    return normalizedMaxLength;
  }
  const entityEnd = findTelegramHtmlEntityEnd(text, lastAmpersand);
  if (entityEnd === -1 || entityEnd < normalizedMaxLength) {
    return normalizedMaxLength;
  }
  return lastAmpersand;
}

function popTelegramHtmlTag(tags: TelegramHtmlTag[], name: string): void {
  for (let index = tags.length - 1; index >= 0; index -= 1) {
    if (tags[index]?.name === name) {
      tags.splice(index, 1);
      return;
    }
  }
}

export function splitTelegramHtmlChunks(html: string, limit: number): string[] {
  if (!html) {
    return [];
  }
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (html.length <= normalizedLimit) {
    return [html];
  }

  const chunks: string[] = [];
  const openTags: TelegramHtmlTag[] = [];
  let current = "";
  let chunkHasPayload = false;

  const resetCurrent = () => {
    current = buildTelegramHtmlOpenPrefix(openTags);
    chunkHasPayload = false;
  };

  const flushCurrent = () => {
    if (!chunkHasPayload) {
      return;
    }
    chunks.push(`${current}${buildTelegramHtmlCloseSuffix(openTags)}`);
    resetCurrent();
  };

  const appendText = (segment: string) => {
    let remaining = segment;
    while (remaining.length > 0) {
      const available =
        normalizedLimit - current.length - buildTelegramHtmlCloseSuffixLength(openTags);
      if (available <= 0) {
        if (!chunkHasPayload) {
          throw new Error(
            `Telegram HTML chunk limit exceeded by tag overhead (limit=${normalizedLimit})`,
          );
        }
        flushCurrent();
        continue;
      }
      if (remaining.length <= available) {
        current += remaining;
        chunkHasPayload = true;
        break;
      }
      const splitAt = findTelegramHtmlSafeSplitIndex(remaining, available);
      if (splitAt <= 0) {
        if (!chunkHasPayload) {
          throw new Error(
            `Telegram HTML chunk limit exceeded by leading entity (limit=${normalizedLimit})`,
          );
        }
        flushCurrent();
        continue;
      }
      current += remaining.slice(0, splitAt);
      chunkHasPayload = true;
      remaining = remaining.slice(splitAt);
      flushCurrent();
    }
  };

  resetCurrent();
  HTML_TAG_PATTERN.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HTML_TAG_PATTERN.exec(html)) !== null) {
    const tagStart = match.index;
    const tagEnd = HTML_TAG_PATTERN.lastIndex;
    appendText(html.slice(lastIndex, tagStart));

    const rawTag = match[0];
    const isClosing = match[1] === "</";
    const tagName = match[2].toLowerCase();
    const isSelfClosing =
      !isClosing &&
      (TELEGRAM_SELF_CLOSING_HTML_TAGS.has(tagName) || rawTag.trimEnd().endsWith("/>"));

    if (!isClosing) {
      const nextCloseLength = isSelfClosing ? 0 : `</${tagName}>`.length;
      if (
        chunkHasPayload &&
        current.length +
          rawTag.length +
          buildTelegramHtmlCloseSuffixLength(openTags) +
          nextCloseLength >
          normalizedLimit
      ) {
        flushCurrent();
      }
    }

    current += rawTag;
    if (isSelfClosing) {
      chunkHasPayload = true;
    }
    if (isClosing) {
      popTelegramHtmlTag(openTags, tagName);
    } else if (!isSelfClosing) {
      openTags.push({
        name: tagName,
        openTag: rawTag,
        closeTag: `</${tagName}>`,
      });
    }
    lastIndex = tagEnd;
  }

  appendText(html.slice(lastIndex));
  flushCurrent();
  return chunks.length > 0 ? chunks : [html];
}

function splitTelegramChunkByHtmlLimit(
  chunk: MarkdownIR,
  htmlLimit: number,
  renderedHtmlLength: number,
): MarkdownIR[] {
  const currentTextLength = chunk.text.length;
  if (currentTextLength <= 1) {
    return [chunk];
  }
  const proportionalLimit = Math.floor(
    (currentTextLength * htmlLimit) / Math.max(renderedHtmlLength, 1),
  );
  const candidateLimit = Math.min(currentTextLength - 1, proportionalLimit);
  const splitLimit =
    Number.isFinite(candidateLimit) && candidateLimit > 0
      ? candidateLimit
      : Math.max(1, Math.floor(currentTextLength / 2));
  const split = splitMarkdownIRPreserveWhitespace(chunk, splitLimit);
  if (split.length > 1) {
    return split;
  }
  return splitMarkdownIRPreserveWhitespace(chunk, Math.max(1, Math.floor(currentTextLength / 2)));
}

function sliceMarkdownIR(ir: MarkdownIR, start: number, end: number): MarkdownIR {
  return {
    text: ir.text.slice(start, end),
    styles: sliceStyleSpans(ir.styles, start, end),
    links: sliceLinkSpans(ir.links, start, end),
  };
}

function mergeAdjacentStyleSpans(styles: MarkdownIR["styles"]): MarkdownIR["styles"] {
  const merged: MarkdownIR["styles"] = [];
  for (const span of styles) {
    const last = merged.at(-1);
    if (last && last.style === span.style && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

function mergeAdjacentLinkSpans(links: MarkdownIR["links"]): MarkdownIR["links"] {
  const merged: MarkdownIR["links"] = [];
  for (const link of links) {
    const last = merged.at(-1);
    if (last && last.href === link.href && link.start <= last.end) {
      last.end = Math.max(last.end, link.end);
      continue;
    }
    merged.push({ ...link });
  }
  return merged;
}

function mergeMarkdownIRChunks(left: MarkdownIR, right: MarkdownIR): MarkdownIR {
  const offset = left.text.length;
  return {
    text: left.text + right.text,
    styles: mergeAdjacentStyleSpans([
      ...left.styles,
      ...right.styles.map((span) => ({
        ...span,
        start: span.start + offset,
        end: span.end + offset,
      })),
    ]),
    links: mergeAdjacentLinkSpans([
      ...left.links,
      ...right.links.map((link) => ({
        ...link,
        start: link.start + offset,
        end: link.end + offset,
      })),
    ]),
  };
}

function renderTelegramChunkHtml(ir: MarkdownIR): string {
  return wrapFileReferencesInHtml(renderTelegramHtml(ir));
}

function findMarkdownIRPreservedSplitIndex(text: string, start: number, limit: number): number {
  const maxEnd = Math.min(text.length, start + limit);
  if (maxEnd >= text.length) {
    return text.length;
  }

  let lastOutsideParenNewlineBreak = -1;
  let lastOutsideParenWhitespaceBreak = -1;
  let lastOutsideParenWhitespaceRunStart = -1;
  let lastAnyNewlineBreak = -1;
  let lastAnyWhitespaceBreak = -1;
  let lastAnyWhitespaceRunStart = -1;
  let parenDepth = 0;
  let sawNonWhitespace = false;

  for (let index = start; index < maxEnd; index += 1) {
    const char = text[index];
    if (char === "(") {
      sawNonWhitespace = true;
      parenDepth += 1;
      continue;
    }
    if (char === ")" && parenDepth > 0) {
      sawNonWhitespace = true;
      parenDepth -= 1;
      continue;
    }
    if (!/\s/.test(char)) {
      sawNonWhitespace = true;
      continue;
    }
    if (!sawNonWhitespace) {
      continue;
    }
    if (char === "\n") {
      lastAnyNewlineBreak = index + 1;
      if (parenDepth === 0) {
        lastOutsideParenNewlineBreak = index + 1;
      }
      continue;
    }
    const whitespaceRunStart =
      index === start || !/\s/.test(text[index - 1] ?? "") ? index : lastAnyWhitespaceRunStart;
    lastAnyWhitespaceBreak = index + 1;
    lastAnyWhitespaceRunStart = whitespaceRunStart;
    if (parenDepth === 0) {
      lastOutsideParenWhitespaceBreak = index + 1;
      lastOutsideParenWhitespaceRunStart = whitespaceRunStart;
    }
  }

  const resolveWhitespaceBreak = (breakIndex: number, runStart: number): number => {
    if (breakIndex <= start) {
      return breakIndex;
    }
    if (runStart <= start) {
      return breakIndex;
    }
    return /\s/.test(text[breakIndex] ?? "") ? runStart : breakIndex;
  };

  if (lastOutsideParenNewlineBreak > start) {
    return lastOutsideParenNewlineBreak;
  }
  if (lastOutsideParenWhitespaceBreak > start) {
    return resolveWhitespaceBreak(
      lastOutsideParenWhitespaceBreak,
      lastOutsideParenWhitespaceRunStart,
    );
  }
  if (lastAnyNewlineBreak > start) {
    return lastAnyNewlineBreak;
  }
  if (lastAnyWhitespaceBreak > start) {
    return resolveWhitespaceBreak(lastAnyWhitespaceBreak, lastAnyWhitespaceRunStart);
  }
  return maxEnd;
}

function splitMarkdownIRPreserveWhitespace(ir: MarkdownIR, limit: number): MarkdownIR[] {
  if (!ir.text) {
    return [];
  }
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (normalizedLimit <= 0 || ir.text.length <= normalizedLimit) {
    return [ir];
  }
  const chunks: MarkdownIR[] = [];
  let cursor = 0;
  while (cursor < ir.text.length) {
    const end = findMarkdownIRPreservedSplitIndex(ir.text, cursor, normalizedLimit);
    chunks.push({
      text: ir.text.slice(cursor, end),
      styles: sliceStyleSpans(ir.styles, cursor, end),
      links: sliceLinkSpans(ir.links, cursor, end),
    });
    cursor = end;
  }
  return chunks;
}

function coalesceWhitespaceOnlyMarkdownIRChunks(chunks: MarkdownIR[], limit: number): MarkdownIR[] {
  const coalesced: MarkdownIR[] = [];
  let index = 0;

  while (index < chunks.length) {
    const chunk = chunks[index];
    if (!chunk) {
      index += 1;
      continue;
    }
    if (chunk.text.trim().length > 0) {
      coalesced.push(chunk);
      index += 1;
      continue;
    }

    const prev = coalesced.at(-1);
    const next = chunks[index + 1];
    const chunkLength = chunk.text.length;

    const canMergePrev = (candidate: MarkdownIR) =>
      renderTelegramChunkHtml(candidate).length <= limit;
    const canMergeNext = (candidate: MarkdownIR) =>
      renderTelegramChunkHtml(candidate).length <= limit;

    if (prev) {
      const mergedPrev = mergeMarkdownIRChunks(prev, chunk);
      if (canMergePrev(mergedPrev)) {
        coalesced[coalesced.length - 1] = mergedPrev;
        index += 1;
        continue;
      }
    }

    if (next) {
      const mergedNext = mergeMarkdownIRChunks(chunk, next);
      if (canMergeNext(mergedNext)) {
        chunks[index + 1] = mergedNext;
        index += 1;
        continue;
      }
    }

    if (prev && next) {
      for (let prefixLength = chunkLength - 1; prefixLength >= 1; prefixLength -= 1) {
        const prefix = sliceMarkdownIR(chunk, 0, prefixLength);
        const suffix = sliceMarkdownIR(chunk, prefixLength, chunkLength);
        const mergedPrev = mergeMarkdownIRChunks(prev, prefix);
        const mergedNext = mergeMarkdownIRChunks(suffix, next);
        if (canMergePrev(mergedPrev) && canMergeNext(mergedNext)) {
          coalesced[coalesced.length - 1] = mergedPrev;
          chunks[index + 1] = mergedNext;
          break;
        }
      }
    }

    index += 1;
  }

  return coalesced;
}

function renderTelegramChunksWithinHtmlLimit(
  ir: MarkdownIR,
  limit: number,
): TelegramFormattedChunk[] {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const pending = chunkMarkdownIR(ir, normalizedLimit);
  const finalized: MarkdownIR[] = [];
  while (pending.length > 0) {
    const chunk = pending.shift();
    if (!chunk) {
      continue;
    }
    const html = renderTelegramChunkHtml(chunk);
    if (html.length <= normalizedLimit || chunk.text.length <= 1) {
      finalized.push(chunk);
      continue;
    }
    const split = splitTelegramChunkByHtmlLimit(chunk, normalizedLimit, html.length);
    if (split.length <= 1) {
      finalized.push(chunk);
      continue;
    }
    pending.unshift(...split);
  }
  return coalesceWhitespaceOnlyMarkdownIRChunks(finalized, normalizedLimit).map((chunk) => ({
    html: renderTelegramChunkHtml(chunk),
    text: chunk.text,
  }));
}

export function markdownToTelegramChunks(
  markdown: string,
  limit: number,
  options: { tableMode?: MarkdownTableMode } = {},
): TelegramFormattedChunk[] {
  const ir = markdownToIR(markdown ?? "", {
    linkify: true,
    enableSpoilers: true,
    headingStyle: "none",
    blockquotePrefix: "",
    tableMode: options.tableMode,
  });
  return renderTelegramChunksWithinHtmlLimit(ir, limit);
}

export function markdownToTelegramHtmlChunks(markdown: string, limit: number): string[] {
  return markdownToTelegramChunks(markdown, limit).map((chunk) => chunk.html);
}
