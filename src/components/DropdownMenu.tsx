import { useState, useRef, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface DropdownMenuItem {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  variant?: 'default' | 'danger';
}

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  trigger?: ReactNode;
  align?: 'left' | 'right';
}

export function DropdownMenu({ items, trigger, align = 'right' }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Calculate dropdown position
  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 144; // w-36 = 9rem = 144px

      setDropdownPosition({
        top: rect.bottom + 4,
        left: align === 'right' ? rect.right - menuWidth : rect.left,
      });
    }
  }, [align]);

  // Update position when opening and on scroll/resize
  useEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
    }
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedTrigger = triggerRef.current?.contains(target);
      const clickedDropdown = dropdownRef.current?.contains(target);

      if (!clickedTrigger && !clickedDropdown) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleItemClick = (item: DropdownMenuItem) => {
    setIsOpen(false);
    item.onClick();
  };

  const defaultTrigger = (
    <svg className="w-4 h-4 text-vercel-gray-400" fill="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );

  const dropdownContent = (
    <div
      ref={dropdownRef}
      className="bg-white rounded-lg overflow-hidden w-36"
      style={{
        position: 'fixed',
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        zIndex: 9999,
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.05)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="py-1">
        {items.map((item, index) => (
          <button
            key={index}
            type="button"
            onClick={() => handleItemClick(item)}
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
              item.variant === 'danger'
                ? 'text-error hover:bg-error-light'
                : 'text-vercel-gray-600 hover:bg-vercel-gray-50'
            }`}
          >
            {item.icon && (
              <span className={item.variant === 'danger' ? '' : 'text-vercel-gray-400'}>
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 rounded-md hover:bg-vercel-gray-100 transition-colors focus:outline-none"
        title="More actions"
      >
        {trigger || defaultTrigger}
      </button>

      {isOpen && createPortal(dropdownContent, document.body)}
    </>
  );
}
