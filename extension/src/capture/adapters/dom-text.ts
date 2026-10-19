/**
 * Converts a rendered chat message (DOM) into readable Markdown-style text.
 * It uses only nodeType numbers and Element APIs, so it runs in a page, a worker or jsdom.
 * Interface chrome (buttons, timestamps, screen-reader-only text) is dropped.
 */

const SKIP_TAGS = new Set(['script', 'style', 'svg', 'button', 'time', 'noscript', 'template']);

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure',
  'figcaption', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt',
  'dd', 'table', 'pre', 'hr', 'details', 'summary',
]);

interface Ctx {
  listDepth: number;
}

export function elementToText(root: Element): string {
  return tidy(renderChildren(root, { listDepth: 0 }, '\n\n'));
}

function tidy(text: string): string {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isExcluded(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return true;
  if (el.hasAttribute('data-find-omitted')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (/(?:^|\s)sr-only(?:\s|$)/.test(el.getAttribute('class') ?? '')) return true;
  const role = el.getAttribute('role');
  return role === 'status' || role === 'toolbar';
}

/** Text exactly as written, for code. Line-group elements always end with a newline. */
function rawText(node: Node): string {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      out += child.nodeValue ?? '';
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (isExcluded(el)) continue;
    if (el.tagName.toLowerCase() === 'br') {
      out += '\n';
      continue;
    }
    out += rawText(el);
    if (el.hasAttribute('data-code-line-group') && !out.endsWith('\n')) out += '\n';
  }
  return out;
}

function renderChildren(el: Element, ctx: Ctx, joiner: string): string {
  const blocks: string[] = [];
  let inline = '';
  const flush = (): void => {
    const text = inline.replace(/ *\n */g, '\n').replace(/^ +| +$/g, '');
    if (text) blocks.push(text);
    inline = '';
  };

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      inline += (child.nodeValue ?? '').replace(/\s+/g, ' ');
      continue;
    }
    if (child.nodeType !== 1) continue;
    const node = child as Element;
    if (isExcluded(node)) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') {
      inline += '\n';
      continue;
    }
    if (!BLOCK_TAGS.has(tag)) {
      inline += renderInline(node, ctx);
      continue;
    }
    flush();
    const rendered = renderBlock(node, tag, ctx);
    if (rendered) blocks.push(rendered);
  }
  flush();
  return blocks.join(joiner);
}

/** Inline content without trimming, so spaces between words survive. */
function inlineRaw(el: Element, ctx: Ctx): string {
  let out = '';
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      out += (child.nodeValue ?? '').replace(/\s+/g, ' ');
      continue;
    }
    if (child.nodeType !== 1) continue;
    const node = child as Element;
    if (isExcluded(node)) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') {
      out += '\n';
      continue;
    }
    out += BLOCK_TAGS.has(tag) ? `\n${renderBlock(node, tag, ctx)}\n` : renderInline(node, ctx);
  }
  return out;
}

function renderInline(node: Element, ctx: Ctx): string {
  switch (node.tagName.toLowerCase()) {
    case 'strong':
    case 'b': {
      const inner = inlineRaw(node, ctx).trim();
      return inner ? `**${inner}**` : '';
    }
    case 'em':
    case 'i': {
      const inner = inlineRaw(node, ctx).trim();
      return inner ? `*${inner}*` : '';
    }
    case 'code': {
      const raw = rawText(node);
      if (!raw) return '';
      const fence = raw.includes('`') ? '``' : '`';
      return `${fence}${raw}${fence}`;
    }
    case 'a': {
      const inner = inlineRaw(node, ctx).trim();
      const href = node.getAttribute('href') ?? '';
      if (!inner) return '';
      return /^https?:\/\//i.test(href) ? `[${inner}](${href})` : inner;
    }
    default:
      return inlineRaw(node, ctx);
  }
}

function renderBlock(node: Element, tag: string, ctx: Ctx): string {
  switch (tag) {
    case 'pre':
      return renderCodeBlock(node);
    case 'ul':
      return renderList(node, false, ctx);
    case 'ol':
      return renderList(node, true, ctx);
    case 'table':
      return renderTable(node, ctx);
    case 'hr':
      return '---';
    case 'blockquote': {
      const inner = renderChildren(node, ctx, '\n\n');
      if (!inner) return '';
      return inner
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const text = inlineRaw(node, ctx).trim();
      return text ? `${'#'.repeat(Number(tag.slice(1)))} ${text}` : '';
    }
    default:
      return renderChildren(node, ctx, '\n\n');
  }
}

function renderCodeBlock(pre: Element): string {
  const code = pre.querySelector('code') ?? pre;
  const language =
    /(?:^|\s)language-([A-Za-z0-9_+#.-]{1,30})(?:\s|$)/.exec(code.getAttribute('class') ?? '')?.[1] ??
    '';
  const body = rawText(code).replace(/\n+$/, '');
  // Use a longer fence than any backtick run inside the code.
  const longestRun = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${body}\n${fence}`;
}

function renderList(list: Element, ordered: boolean, ctx: Ctx): string {
  const indent = '  '.repeat(ctx.listDepth);
  const lines: string[] = [];
  let number = 0;
  for (const child of Array.from(list.children)) {
    if (isExcluded(child) || child.tagName.toLowerCase() !== 'li') continue;
    number += 1;
    const body = renderChildren(child, { listDepth: ctx.listDepth + 1 }, '\n');
    lines.push(`${indent}${ordered ? `${number}. ` : '- '}${body}`);
  }
  return lines.join('\n');
}

function renderTable(table: Element, ctx: Ctx): string {
  const rows: string[] = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(tr.children).filter((cell) => {
      const tag = cell.tagName.toLowerCase();
      return !isExcluded(cell) && (tag === 'td' || tag === 'th');
    });
    if (cells.length === 0) continue;
    const text = cells.map((cell) => inlineRaw(cell, ctx).replace(/\s*\n\s*/g, ' ').trim());
    rows.push(`| ${text.join(' | ')} |`);
  }
  return rows.join('\n');
}