import { useMemo } from 'react';

// Minimal, dependency-free Markdown → React for the impact chat. Builds real
// elements (no HTML injection / no dangerouslySetInnerHTML), covering the subset
// the model emits: headings, bold, italic, inline + fenced code, lists, links,
// blockquotes, hr, paragraphs. Underscore emphasis is intentionally NOT parsed
// so snake_case identifiers (auth_service) render literally.

// Inline: `code`, **bold**, *italic*, [text](url).
function inline(text, kp) {
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  const nodes = [];
  let last = 0, m, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      nodes.push(<code key={`${kp}-${k++}`} className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      nodes.push(<strong key={`${kp}-${k++}`} className="font-semibold">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*')) {
      nodes.push(<em key={`${kp}-${k++}`}>{tok.slice(1, -1)}</em>);
    } else {
      const mm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/);
      nodes.push(<a key={`${kp}-${k++}`} href={mm[2]} target="_blank" rel="noreferrer" className="underline text-emerald-600 dark:text-emerald-400 break-all">{mm[1]}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const H = { 1: 'text-base font-semibold', 2: 'text-sm font-semibold', 3: 'text-sm font-semibold' };

function parseBlocks(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0, key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      out.push(<pre key={key++} className="my-1.5 p-2 rounded-lg bg-gray-900 text-gray-100 text-xs font-mono overflow-x-auto whitespace-pre">{buf.join('\n')}</pre>);
      continue;
    }

    if (/^\s*$/.test(line)) { i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const Tag = `h${Math.min(lvl, 6)}`;
      out.push(<Tag key={key++} className={`${H[lvl] || 'text-sm font-semibold'} mt-1`}>{inline(h[2], `h${key}`)}</Tag>);
      i++; continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={key++} className="my-2 border-gray-200 dark:border-gray-700" />);
      i++; continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(<blockquote key={key++} className="border-l-2 border-gray-300 dark:border-gray-600 pl-2.5 text-gray-500 dark:text-gray-400">{inline(buf.join(' '), `bq${key}`)}</blockquote>);
      continue;
    }

    const li = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (li) {
      const ordered = /\d+\./.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const mm = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!mm) break;
        items.push(mm[3]);
        i++;
      }
      const Tag = ordered ? 'ol' : 'ul';
      out.push(
        <Tag key={key++} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-0.5`}>
          {items.map((it, idx) => <li key={idx}>{inline(it, `li${key}-${idx}`)}</li>)}
        </Tag>
      );
      continue;
    }

    // paragraph — gather until a blank line or the next block start
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s|^```|^\s*>|^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(<p key={key++} className="leading-relaxed">{inline(buf.join(' '), `p${key}`)}</p>);
  }
  return out;
}

export default function Markdown({ text, className = '' }) {
  const blocks = useMemo(() => parseBlocks(text || ''), [text]);
  return <div className={`space-y-2 ${className}`}>{blocks}</div>;
}
