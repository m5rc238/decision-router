// A small, dependency-free markdown renderer for the subset of CommonMark used
// by the project docs (eval_results_summary.md): ATX headings, ordered/unordered
// lists, pipe tables, fenced code, blockquotes, horizontal rules, **bold**,
// *italic* and `inline code`. Everything is HTML-escaped first.

import type { ReactNode } from 'react'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const INLINE_RX = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g

function inline(text: string): ReactNode[] {
  const safe = escapeHtml(text)
  const nodes: ReactNode[] = []
  let last = 0
  for (const m of safe.matchAll(INLINE_RX)) {
    const index = m.index ?? 0
    if (index > last) nodes.push(safe.slice(last, index))
    const tok = m[1]
    if (tok.startsWith('**') && tok.endsWith('**')) {
      nodes.push(
        <strong key={nodes.length} className="font-semibold text-base-content/90">
          {tok.slice(2, -2)}
        </strong>,
      )
    } else if (tok.startsWith('`') && tok.endsWith('`')) {
      nodes.push(
        <code key={nodes.length} className="rounded bg-base-300/50 px-1 py-0.5 font-mono text-[10.5px]">
          {tok.slice(1, -1)}
        </code>,
      )
    } else if (tok.startsWith('*') && tok.endsWith('*')) {
      nodes.push(<em key={nodes.length}>{tok.slice(1, -1)}</em>)
    }
    last = index + tok.length
  }
  if (last < safe.length) nodes.push(safe.slice(last))
  return nodes
}

const HR_RX = /^---+$/
const HEADING_RX = /^(#{1,6})\s+(.+)$/

function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return body.split('|').map((c) => c.trim())
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c) && !c.includes(' ') && !c.includes('**'))
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|')
}

const CELL_CLASS = 'border-b border-base-300/70 px-2.5 py-1.5 align-top text-[12px]'
const HEADER_CELL_CLASS = 'border-b border-base-300 px-2.5 py-1.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-base-content/60'

function renderMarkdown(md: string): ReactNode {
  const lines = md.split('\n')
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        buf.push(lines[i])
        i++
      }
      i++ // closing fence
      out.push(
        <pre key={out.length} className="my-2 overflow-x-auto rounded-lg border border-base-300 bg-base-200/50 px-3 py-2 font-mono text-[11px] leading-relaxed">
          <code>{escapeHtml(buf.join('\n'))}</code>
        </pre>,
      )
      continue
    }

    // Heading
    const h = line.match(HEADING_RX)
    if (h) {
      const level = h[1].length
      const cls =
        level === 1
          ? 'mb-1 mt-3 text-base font-bold tracking-tight text-base-content'
          : level === 2
            ? 'mb-1 mt-3 text-[12px] font-bold uppercase tracking-wider text-base-content/70'
            : 'mb-1 mt-2 text-xs font-bold text-base-content/70'
      out.push(
        <div key={out.length} className={cls}>
          {inline(h[2])}
        </div>,
      )
      i++
      continue
    }

    // Horizontal rule
    if (HR_RX.test(line.trim())) {
      out.push(<hr key={out.length} className="my-3 border-base-300/70" />)
      i++
      continue
    }

    // Blockquote
    if (line.trimStart().startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        buf.push(lines[i].trimStart().replace(/^>\s?/, ''))
        i++
      }
      out.push(
        <blockquote
          key={out.length}
          className="my-2 border-l-2 border-primary/40 pl-3 text-[12px] italic text-base-content/70"
        >
          {buf.map((b, j) => (
            <p key={j}>{inline(b)}</p>
          ))}
        </blockquote>,
      )
      continue
    }

    // Table
    if (isTableRow(line)) {
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]))
        i++
      }
      if (rows.length >= 2 && isSeparatorRow(rows[1])) {
        const head = rows[0]
        const body = rows.slice(2)
        out.push(
          <div key={out.length} className="my-2 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {head.map((c, ci) => (
                    <th key={ci} className={HEADER_CELL_CLASS}>
                      {inline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 1 ? 'bg-base-200/30' : undefined}>
                    {row.map((c, ci) => (
                      <td key={ci} className={CELL_CLASS}>
                        {inline(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        )
      } else {
        out.push(
          <p key={out.length} className="my-2 text-[12px] leading-relaxed">
            {rows.map((r, j) => (
              <span key={j} className="block">
                {inline(r.join(' | '))}
              </span>
            ))}
          </p>,
        )
      }
      continue
    }

    // Lists (ordered / unordered), grouped; indented continuation lines belong to
// the current item (the summary doc wraps list entries across lines).
    if (/^\s*[-*]\s+/.test(line.trimStart()) || /^\s*\d+\.\s+/.test(line.trimStart())) {
      const ordered = /^\s*\d+\.\s+/.test(line.trimStart())
      const items: string[] = []
      let current = ''
      while (i < lines.length) {
        const l = lines[i]
        const t = l.trimStart()
        if (/^[-*]\s+|^\d+\.\s+/.test(t)) {
          if (current !== '') items.push(current)
          current = t.replace(/^[-*]\s+|^\d+\.\s+/, '')
          i++
          continue
        }
        if (l.startsWith(' ') && t !== '' && !HEADING_RX.test(t) && !isTableRow(t)) {
          current = current === '' ? t : `${current} ${t}`
          i++
          continue
        }
        break
      }
      if (current !== '') items.push(current)
      out.push(
        <ul
          key={out.length}
          className={`my-2 flex flex-col gap-1 text-[12px] leading-relaxed ${ordered ? 'list-decimal pl-6' : 'list-disc pl-5'}`}
        >
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>,
      )
      continue
    }

    // Plain paragraph: consume consecutive text lines
    const buf: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !HEADING_RX.test(lines[i]) &&
      !HR_RX.test(lines[i].trim()) &&
      !isTableRow(lines[i]) &&
      !/^\s*[-*]\s+|^\s*\d+\.\s+/.test(lines[i].trimStart()) &&
      !lines[i].trimStart().startsWith('>') &&
      !lines[i].trimStart().startsWith('```')
    ) {
      buf.push(lines[i])
      i++
    }
    out.push(
      <p key={out.length} className="my-2 text-[12px] leading-relaxed text-base-content/80">
        {inline(buf.join(' '))}
      </p>,
    )
  }
  return out
}

export function Markdown({ text }: { text: string }) {
  return <div className="flex flex-col">{renderMarkdown(text)}</div>
}