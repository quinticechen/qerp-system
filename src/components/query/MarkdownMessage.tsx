import React from 'react';

function parseInline(text: string): React.ReactNode[] {
  // Handle **bold** and `code`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="bg-black/10 rounded px-1 py-0.5 text-xs font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

interface LineProps {
  text: string;
  index: number;
}

function Line({ text, index }: LineProps) {
  if (text === '---' || text === '***' || text === '___') {
    return <hr key={index} className="border-gray-200 my-2" />;
  }
  if (text.startsWith('### ')) {
    return <h3 key={index} className="font-semibold text-sm mt-3 mb-1">{parseInline(text.slice(4))}</h3>;
  }
  if (text.startsWith('## ')) {
    return <h2 key={index} className="font-semibold text-sm mt-3 mb-1">{parseInline(text.slice(3))}</h2>;
  }
  if (text.startsWith('# ')) {
    return <h1 key={index} className="font-semibold text-base mt-3 mb-1">{parseInline(text.slice(2))}</h1>;
  }
  if (text.startsWith('- ') || text.startsWith('* ')) {
    return (
      <div key={index} className="flex gap-2 my-0.5">
        <span className="mt-0.5 shrink-0">•</span>
        <span>{parseInline(text.slice(2))}</span>
      </div>
    );
  }
  const orderedMatch = text.match(/^(\d+)\.\s(.+)/);
  if (orderedMatch) {
    return (
      <div key={index} className="flex gap-2 my-0.5">
        <span className="shrink-0 tabular-nums">{orderedMatch[1]}.</span>
        <span>{parseInline(orderedMatch[2])}</span>
      </div>
    );
  }
  // Table row — render as monospace for alignment
  if (text.startsWith('|')) {
    const isHeader = false; // simplified
    const cells = text.split('|').filter((c) => c.trim() !== '');
    const isSeparator = cells.every((c) => /^[-: ]+$/.test(c));
    if (isSeparator) return null;
    return (
      <div key={index} className="flex gap-2 my-0.5 text-xs">
        {cells.map((cell, ci) => (
          <span key={ci} className="flex-1 min-w-0 truncate border-b border-gray-100 py-0.5">
            {parseInline(cell.trim())}
          </span>
        ))}
      </div>
    );
  }
  if (text.trim() === '') {
    return <div key={index} className="h-2" />;
  }
  return <p key={index} className="my-0.5 leading-relaxed">{parseInline(text)}</p>;
}

interface MarkdownMessageProps {
  content: string;
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  const lines = content.split('\n');
  return (
    <div className="text-sm space-y-0">
      {lines.map((line, i) => (
        <Line key={i} text={line} index={i} />
      ))}
    </div>
  );
}
