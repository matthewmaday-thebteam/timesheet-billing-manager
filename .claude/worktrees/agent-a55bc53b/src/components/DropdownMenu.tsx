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
  /** Menu width in pixels (default: 144) */
  menuWidth?: number;
  /** If true, disables the trigger */
  disabled?: boolean;
  /** Trigger visual variant: 'icon' (minimal) or 'select' (bordered like Select atom) */
  triggerVariant?: 'icon' | 'select';
}

export function DropdownMenu({ items, trigger, align = 'right', menuWidth = 144, disabled = false, triggerVariant = 'icon' }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Calculate dropdown position
  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();

      setDropdownPosition({
        top: rect.bottom + 4,
        left: align === 'right' ? rect.right - menuWidth : rect.left,
      });
    }
  }, [align, menuWidth]);

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
      className="bg-white rounded-lg overflow-hidden shadow-vercel-dropdown backdrop-blur-sm"
      style={{
        position: 'fixed',
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: menuWidth,
        zIndex: 9999,
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
                ? 'text-bteam-brand hover:bg-bteam-brand-light'
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

  const triggerClasses = triggerVariant === 'select'
    ? `px-3 py-2 bg-white border border-vercel-gray-100 rounded-md text-sm text-left flex items-center gap-2 transition-colors duration-200 ease-out focus:ring-1 focus:ring-black focus:border-vercel-gray-600 focus:outline-none ${
        disabled ? 'bg-vercel-gray-50 cursor-not-allowed text-vercel-gray-300' : 'hover:border-vercel-gray-300 text-vercel-gray-600'
      }`
    : 'p-1.5 rounded-md hover:bg-vercel-gray-100 transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={triggerClasses}
        title="More actions"
      >
        {trigger || defaultTrigger}
      </button>

      {isOpen && createPortal(dropdownContent, document.body)}
    </>
  );
}
