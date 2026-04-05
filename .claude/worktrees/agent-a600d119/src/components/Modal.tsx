import { useEffect, useCallback } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  titleIcon?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  stickyHeader?: React.ReactNode;
  footer?: React.ReactNode;
  centerTitle?: boolean;
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
};

export function Modal({
  isOpen,
  onClose,
  title,
  titleIcon,
  children,
  maxWidth = '2xl',
  stickyHeader,
  footer,
  centerTitle = false,
}: ModalProps) {
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] overflow-hidden">
      {/* Backdrop with blur */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-md transition-opacity duration-200 ease-out"
        onClick={onClose}
      />

      {/* Modal container */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div
          className={`relative w-full ${maxWidthClasses[maxWidth]} max-h-[90vh] bg-white rounded-xl flex flex-col overflow-hidden shadow-modal`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className={`flex-shrink-0 flex items-center ${centerTitle ? 'justify-center relative' : 'justify-between'} p-6 border-b border-vercel-gray-100 bg-white`}>
            {centerTitle && (
              <button
                onClick={onClose}
                className="absolute left-6 p-1 rounded-md hover:bg-vercel-gray-50 transition-colors duration-200 ease-out focus:ring-1 focus:ring-black focus:outline-none"
              >
                <svg
                  className="w-5 h-5 text-vercel-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
            <div className="flex items-center gap-3">
              {titleIcon}
              <h2 className="text-lg font-semibold text-vercel-gray-600">{title}</h2>
            </div>
            {!centerTitle && (
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-vercel-gray-50 transition-colors duration-200 ease-out focus:ring-1 focus:ring-black focus:outline-none"
              >
                <svg
                  className="w-5 h-5 text-vercel-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>

          {/* Optional Sticky Header Section (for summary cards, etc.) */}
          {stickyHeader && (
            <div className="flex-shrink-0 p-6 pb-0 bg-white border-b border-vercel-gray-100">
              {stickyHeader}
            </div>
          )}

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-8 scrollbar-thin">{children}</div>

          {/* Footer - Optional action buttons area */}
          {footer && (
            <div className="flex-shrink-0 flex items-center justify-end gap-3 px-8 py-4 border-t border-vercel-gray-100 bg-vercel-gray-50">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
