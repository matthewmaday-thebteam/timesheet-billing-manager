/**
 * LegalModal - Modal for displaying legal documents
 *
 * Displays Privacy Policy or Terms of Service content in a modal.
 * Supports markdown-like formatting.
 *
 * @official 2026-01-28
 * @category Molecule
 */

import React, { useEffect, useRef } from 'react';
import { Button } from './Button';

interface LegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
  version?: number;
  lastUpdated?: string;
}

export function LegalModal({
  isOpen,
  onClose,
  title,
  content,
  version,
  lastUpdated,
}: LegalModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Parse inline formatting (bold with **)
  const parseInlineFormatting = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let keyIndex = 0;

    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);

      if (boldMatch && boldMatch.index !== undefined) {
        // Add text before the bold
        if (boldMatch.index > 0) {
          parts.push(remaining.slice(0, boldMatch.index));
        }
        // Add the bold text
        parts.push(
          <strong key={keyIndex++} className="font-semibold text-vercel-gray-600">
            {boldMatch[1]}
          </strong>
        );
        remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
      } else {
        // No more bold, add the rest
        parts.push(remaining);
        break;
      }
    }

    return parts.length === 1 ? parts[0] : parts;
  };

  // Simple markdown-like rendering
  const renderContent = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactElement[] = [];
    let currentParagraph: string[] = [];

    const flushParagraph = () => {
      if (currentParagraph.length > 0) {
        elements.push(
          <p key={elements.length} className="mb-4 text-vercel-gray-400 leading-relaxed">
            {parseInlineFormatting(currentParagraph.join(' '))}
          </p>
        );
        currentParagraph = [];
      }
    };

    lines.forEach((line, index) => {
      const trimmed = line.trim();

      if (trimmed.startsWith('# ')) {
        flushParagraph();
        elements.push(
          <h1 key={index} className="text-xl font-bold text-vercel-gray-600 mb-4 mt-6 first:mt-0">
            {parseInlineFormatting(trimmed.slice(2))}
          </h1>
        );
      } else if (trimmed.startsWith('## ')) {
        flushParagraph();
        elements.push(
          <h2 key={index} className="text-lg font-semibold text-vercel-gray-600 mb-3 mt-5">
            {parseInlineFormatting(trimmed.slice(3))}
          </h2>
        );
      } else if (trimmed.startsWith('### ')) {
        flushParagraph();
        elements.push(
          <h3 key={index} className="text-base font-medium text-vercel-gray-600 mb-2 mt-4">
            {parseInlineFormatting(trimmed.slice(4))}
          </h3>
        );
      } else if (trimmed.startsWith('- ')) {
        flushParagraph();
        elements.push(
          <li key={index} className="ml-8 mb-1.5 text-vercel-gray-400 list-disc">
            {parseInlineFormatting(trimmed.slice(2))}
          </li>
        );
      } else if (trimmed.startsWith('*') && trimmed.endsWith('*') && !trimmed.includes('**')) {
        flushParagraph();
        elements.push(
          <p key={index} className="mb-4 text-vercel-gray-300 text-sm italic">
            {trimmed.slice(1, -1)}
          </p>
        );
      } else if (trimmed === '') {
        flushParagraph();
      } else {
        currentParagraph.push(trimmed);
      }
    });

    flushParagraph();
    return elements;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative bg-white rounded-lg shadow-modal max-w-[1075px] w-full mx-4 max-h-[80vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-vercel-gray-100">
          <div>
            <h2 id="legal-modal-title" className="text-xl font-semibold text-vercel-gray-600">
              {title}
            </h2>
            {version && (
              <p className="text-xs text-vercel-gray-300 mt-1 font-mono">
                Version {version}
                {lastUpdated && ` • Published ${new Date(lastUpdated).toLocaleDateString()}`}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-vercel-gray-300 hover:text-vercel-gray-600 transition-colors"
            aria-label="Close modal"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {renderContent(content)}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-vercel-gray-100">
          <Button variant="primary" onClick={onClose} className="w-full">
            I Understand
          </Button>
        </div>
      </div>
    </div>
  );
}
