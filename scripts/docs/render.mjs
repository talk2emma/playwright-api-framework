/**
 * Block renderer shared by the multi-page site, the print sheet and the
 * published artifact, so all three outputs are generated from one content
 * source and can never disagree with each other.
 */
import { highlight, detectLanguage, LANGUAGE_LABEL } from './highlight.mjs';

/** Renders a syntax-highlighted code block with its language labelled. */
function codeBlock(text, { caption, lang } = {}) {
  const language = lang ?? detectLanguage(text);
  const label = LANGUAGE_LABEL[language] ?? language;
  return (
    `<figure class="code" data-lang="${esc(language)}">` +
    `<figcaption><span>${esc(caption ?? '')}</span><span class="lang">${esc(label)}</span></figcaption>` +
    `<pre><code>${highlight(text, language)}</code></pre></figure>`
  );
}

export function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline markup: `code`, **bold**, [text](href). */
export function inline(text = '') {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderBlock(block) {
  switch (block.type) {
    case 'h2':
      return `<h2 id="${slug(block.text)}">${inline(block.text)}</h2>`;
    case 'h3':
      return `<h3 id="${slug(block.text)}">${inline(block.text)}</h3>`;
    case 'p':
      return `<p>${inline(block.text)}</p>`;
    case 'ul':
      return `<ul>${block.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
    case 'ol':
      return `<ol>${block.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ol>`;
    case 'code':
      return codeBlock(block.text, { caption: block.caption, lang: block.lang });
    case 'note':
      return `<aside class="callout note"><span class="callout-tag">Note</span><div>${inline(block.text)}</div></aside>`;
    case 'warn':
      return `<aside class="callout warn"><span class="callout-tag">Careful</span><div>${inline(block.text)}</div></aside>`;
    case 'rule':
      return `<aside class="callout rule"><span class="callout-tag">Rule</span><div>${inline(block.text)}</div></aside>`;
    case 'table':
      return `<div class="table-wrap"><table><thead><tr>${block.head
        .map((h) => `<th>${inline(h)}</th>`)
        .join('')}</tr></thead><tbody>${block.rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`;
    case 'steps':
      return `<ol class="steps">${block.items
        .map(
          (s) =>
            `<li><p>${inline(s.text)}</p>${
              s.code ? `<pre><code>${highlight(s.code)}</code></pre>` : ''
            }</li>`,
        )
        .join('')}</ol>`;
    case 'tree':
      return `<pre class="tree"><code>${esc(block.text)}</code></pre>`;
    default:
      throw new Error(`Unknown block type: ${block.type}`);
  }
}

export function renderBlocks(blocks = []) {
  return blocks.map(renderBlock).join('\n');
}

export function slug(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function fileAnchor(filePath) {
  return `f-${slug(filePath)}`;
}

/** Renders the auto-extracted API surface of one source file. */
function renderApi(entry) {
  if (!entry || !entry.exports?.length) return '';
  const parts = [];
  for (const item of entry.exports) {
    if (item.kind === 'class') {
      const members = (item.members ?? []).filter((m) => m.name !== 'constructor');
      parts.push(
        `<div class="api-item"><div class="api-head"><span class="badge badge-class">class</span><code>${esc(
          item.name,
        )}</code>${item.heritage ? `<span class="api-heritage">${esc(item.heritage)}</span>` : ''}</div>` +
          (item.doc ? `<p class="api-doc">${inline(item.doc)}</p>` : '') +
          (members.length
            ? `<table class="api-members"><tbody>${members
                .map(
                  (m) =>
                    `<tr><td><code>${highlight(m.signature, 'ts')}</code></td><td>${inline(m.doc ?? '')}</td></tr>`,
                )
                .join('')}</tbody></table>`
            : '') +
          `</div>`,
      );
    } else if (item.kind === 'function') {
      parts.push(
        `<div class="api-item"><div class="api-head"><span class="badge badge-fn">function</span><code>${highlight(
          item.signature,
          'ts',
        )}</code></div>${item.doc ? `<p class="api-doc">${inline(item.doc)}</p>` : ''}</div>`,
      );
    } else if (item.kind === 'interface') {
      parts.push(
        `<div class="api-item"><div class="api-head"><span class="badge badge-type">interface</span><code>${esc(
          item.name,
        )}</code></div>${item.doc ? `<p class="api-doc">${inline(item.doc)}</p>` : ''}${
          item.members?.length
            ? `<pre class="api-shape"><code>${highlight(item.members.join('\n'), 'ts')}</code></pre>`
            : ''
        }</div>`,
      );
    } else if (item.kind === 'type') {
      parts.push(
        `<div class="api-item"><div class="api-head"><span class="badge badge-type">type</span><code>${esc(
          item.name,
        )}</code></div>${item.doc ? `<p class="api-doc">${inline(item.doc)}</p>` : ''}<pre class="api-shape"><code>${highlight(
          item.definition ?? '',
          'ts',
        )}</code></pre></div>`,
      );
    } else if (item.kind === 'const') {
      parts.push(
        `<div class="api-item"><div class="api-head"><span class="badge badge-const">const</span><code>${esc(
          item.name,
        )}</code></div>${item.doc ? `<p class="api-doc">${inline(item.doc)}</p>` : ''}</div>`,
      );
    } else if (item.kind === 're-export') {
      parts.push(
        `<div class="api-item"><div class="api-head"><span class="badge badge-const">re-export</span><code>${esc(
          item.name,
        )}</code><span class="api-heritage">from ${esc(item.from)}</span></div></div>`,
      );
    }
  }
  return `<details class="api"><summary>API surface (${entry.exports.length} export${
    entry.exports.length === 1 ? '' : 's'
  })</summary>${parts.join('')}</details>`;
}

/** Renders one documented file: purpose, change guidance and API. */
export function renderFileEntry(filePath, doc, apiEntry) {
  const meta = [];
  if (apiEntry?.lines) meta.push(`${apiEntry.lines} lines`);
  if (apiEntry?.exports?.length) meta.push(`${apiEntry.exports.length} exports`);

  return `
<section class="file" id="${fileAnchor(filePath)}">
  <header class="file-head">
    <h3><code>${esc(filePath)}</code></h3>
    ${meta.length ? `<span class="file-meta">${meta.join(' &middot; ')}</span>` : ''}
  </header>
  <p class="file-purpose">${inline(doc.purpose)}</p>
  ${doc.blocks ? renderBlocks(doc.blocks) : ''}
  ${
    doc.changeWhen?.length
      ? `<div class="change"><h4>When you need to change it</h4><ul>${doc.changeWhen
          .map((c) => `<li>${inline(c)}</li>`)
          .join('')}</ul></div>`
      : ''
  }
  ${
    doc.changeHow?.length
      ? `<div class="change"><h4>How to change it</h4>${renderBlock({ type: 'steps', items: doc.changeHow })}</div>`
      : ''
  }
  ${doc.why ? `<div class="change why"><h4>Why the change belongs here</h4><p>${inline(doc.why)}</p></div>` : ''}
  ${
    doc.gotchas?.length
      ? `<div class="change gotcha"><h4>Watch out for</h4><ul>${doc.gotchas
          .map((g) => `<li>${inline(g)}</li>`)
          .join('')}</ul></div>`
      : ''
  }
  ${doc.related?.length ? `<p class="related">Related: ${doc.related.map((r) => `<code>${esc(r)}</code>`).join(' &middot; ')}</p>` : ''}
  ${renderApi(apiEntry)}
</section>`;
}
