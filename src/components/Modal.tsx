import { useEffect, useCallback } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  stickyHeader?: React.ReactNode;
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
  children,
  maxWidth = '2xl',
  stickyHeader,
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
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop with blur */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ease-out"
        onClick={onClose}
      />

      {/* Modal container */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div
          className={`relative w-full ${maxWidthClasses[maxWidth]} max-h-[90vh] bg-[#FFFFFF] rounded-lg border border-[#EAEAEA] flex flex-col overflow-hidden`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header - Always Sticky */}
          <div className="flex-shrink-0 flex items-center justify-between p-6 border-b border-[#EAEAEA] bg-[#FFFFFF]">
            <h2 className="text-lg font-semibold text-[#000000]">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-[#FAFAFA] transition-colors duration-200 ease-out focus:ring-1 focus:ring-black focus:outline-none"
            >
              <svg
                className="w-5 h-5 text-[#666666]"
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
          </div>

          {/* Optional Sticky Header Section (for summary cards, etc.) */}
          {stickyHeader && (
            <div className="flex-shrink-0 p-6 pb-0 bg-[#FFFFFF] border-b border-[#EAEAEA]">
              {stickyHeader}
            </div>
          )}

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">{children}</div>
        </div>
      </div>
    </div>
  );
}
