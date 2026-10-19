// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { elementToText } from '../src/capture/adapters/dom-text';

function render(html: string): string {
  const root = document.createElement('div');
  root.innerHTML = html;
  return elementToText(root);
}

describe('elementToText', () => {
  it('collapses whitespace inside a paragraph', () => {
    expect(render('<p>Hello   world</p>')).toBe('Hello world');
  });

  it('separates paragraphs with a blank line', () => {
    expect(render('<p>A</p><p>B</p>')).toBe('A\n\nB');
  });

  it('keeps inline formatting as Markdown', () => {
    expect(render('<p>Say <strong>hi</strong> and <em>bye</em> with <code>x = 1</code>.</p>')).toBe(
      'Say **hi** and *bye* with `x = 1`.',
    );
  });

  it('renders bullet lists', () => {
    expect(render('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two');
  });

  it('renders numbered lists', () => {
    expect(render('<ol><li>a</li><li>b</li></ol>')).toBe('1. a\n2. b');
  });

  it('indents nested lists', () => {
    expect(render('<ul><li>a<ul><li>b</li></ul></li></ul>')).toBe('- a\n  - b');
  });

  it('renders code blocks with their language and exact whitespace', () => {
    expect(render('<pre><code class="language-python">def f():\n    return 1</code></pre>')).toBe(
      '```python\ndef f():\n    return 1\n```',
    );
  });

  it('puts each code line group on its own line', () => {
    const html =
      '<pre><code class="language-js"><span data-code-line-group=""><span>a</span></span><span data-code-line-group=""><span>b</span></span></code></pre>';
    expect(render(html)).toBe('```js\na\nb\n```');
  });

  it('uses a longer fence when the code contains backticks', () => {
    expect(render('<pre><code>use ``` fences</code></pre>')).toBe('````\nuse ``` fences\n````');
  });

  it('drops interface chrome', () => {
    const html =
      '<h2 class="sr-only">You said:</h2><p>Visible</p><button>Copy</button><span role="status" class="sr-only">Copied</span><div data-find-omitted="">python</div><time>2m ago</time>';
    expect(render(html)).toBe('Visible');
  });

  it('turns line breaks into newlines', () => {
    expect(render('<p>line one<br>line two</p>')).toBe('line one\nline two');
  });

  it('renders headings', () => {
    expect(render('<h1>One</h1><h3>Three</h3>')).toBe('# One\n\n### Three');
  });

  it('keeps http links and drops unsafe ones', () => {
    const html =
      '<p>See <a href="https://example.com/x">docs</a> and <a href="javascript:alert(1)">bad</a>.</p>';
    expect(render(html)).toBe('See [docs](https://example.com/x) and bad.');
  });

  it('renders simple tables', () => {
    expect(
      render('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'),
    ).toBe('| A | B |\n| 1 | 2 |');
  });

  it('prefixes block quotes', () => {
    expect(render('<blockquote><p>Quoted</p></blockquote>')).toBe('> Quoted');
  });

  it('skips aria-hidden content', () => {
    expect(render('<p>Keep<span aria-hidden="true">DROP</span></p>')).toBe('Keep');
  });

  it('returns an empty string for an empty element', () => {
    expect(render('')).toBe('');
  });

  it('collapses source-markup whitespace', () => {
    expect(render('<p>  a \n  b  </p>')).toBe('a b');
  });
});