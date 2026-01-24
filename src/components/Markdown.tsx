import { useMemo } from 'react';

interface MarkdownProps {
  content: string;
  className?: string;
}

/**
 * Lightweight markdown renderer for chat messages
 * Supports: **bold**, *italic*, - lists, numbered lists, line breaks
 */
export function Markdown({ content, className = '' }: MarkdownProps) {
  const rendered = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className={`markdown-content ${className}`}>
      {rendered}
    </div>
  );
}

interface ParsedBlock {
  type: 'paragraph' | 'list' | 'numbered-list';
  content: React.ReactNode[];
}

function parseMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const blocks: ParsedBlock[] = [];
  let currentList: string[] = [];
  let currentListType: 'bullet' | 'numbered' | null = null;
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        content: paragraphLines.map((line, i) => (
          <span key={i}>
            {parseInline(line)}
            {i < paragraphLines.length - 1 && <br />}
          </span>
        )),
      });
      paragraphLines = [];
    }
  };

  const flushList = () => {
    if (currentList.length > 0 && currentListType) {
      blocks.push({
        type: currentListType === 'bullet' ? 'list' : 'numbered-list',
        content: currentList.map((item, i) => (
          <li key={i} className="ml-4">
            {parseInline(item)}
          </li>
        )),
      });
      currentList = [];
      currentListType = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for bullet list item
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      if (currentListType !== 'bullet') {
        flushList();
        currentListType = 'bullet';
      }
      currentList.push(bulletMatch[1]);
      continue;
    }

    // Check for numbered list item
    const numberedMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (numberedMatch) {
      flushParagraph();
      if (currentListType !== 'numbered') {
        flushList();
        currentListType = 'numbered';
      }
      currentList.push(numberedMatch[2]);
      continue;
    }

    // Regular line - flush any pending list
    flushList();

    // Empty line creates paragraph break
    if (trimmed === '') {
      flushParagraph();
      continue;
    }

    paragraphLines.push(line);
  }

  // Flush remaining content
  flushList();
  flushParagraph();

  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === 'list') {
          return (
            <ul key={i} className="list-disc list-inside my-1 space-y-0.5">
              {block.content}
            </ul>
          );
        }
        if (block.type === 'numbered-list') {
          return (
            <ol key={i} className="list-decimal list-inside my-1 space-y-0.5">
              {block.content}
            </ol>
          );
        }
        return (
          <p key={i} className="my-1">
            {block.content}
          </p>
        );
      })}
    </>
  );
}

function parseInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIndex = 0;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)$/s);
    if (boldMatch) {
      if (boldMatch[1]) {
        parts.push(<span key={keyIndex++}>{parseInline(boldMatch[1])}</span>);
      }
      parts.push(
        <strong key={keyIndex++} className="font-semibold">
          {parseInline(boldMatch[2])}
        </strong>
      );
      remaining = boldMatch[3];
      continue;
    }

    // Italic: *text* (single asterisk, not followed by another)
    const italicMatch = remaining.match(/^(.*?)\*([^*]+?)\*(.*)$/s);
    if (italicMatch) {
      if (italicMatch[1]) {
        parts.push(<span key={keyIndex++}>{parseInline(italicMatch[1])}</span>);
      }
      parts.push(
        <em key={keyIndex++} className="italic">
          {parseInline(italicMatch[2])}
        </em>
      );
      remaining = italicMatch[3];
      continue;
    }

    // Inline code: `code`
    const codeMatch = remaining.match(/^(.*?)`([^`]+?)`(.*)$/s);
    if (codeMatch) {
      if (codeMatch[1]) {
        parts.push(<span key={keyIndex++}>{codeMatch[1]}</span>);
      }
      parts.push(
        <code key={keyIndex++} className="bg-vercel-gray-100 px-1 py-0.5 rounded text-xs font-mono">
          {codeMatch[2]}
        </code>
      );
      remaining = codeMatch[3];
      continue;
    }

    // No more patterns, add remaining text
    parts.push(<span key={keyIndex++}>{remaining}</span>);
    break;
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
