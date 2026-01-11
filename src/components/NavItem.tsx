interface NavItemProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

export function NavItem({ label, isActive, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`
        relative px-3 py-2 text-sm font-medium rounded-md
        transition-all duration-200 ease-out
        ${isActive ? 'text-vercel-gray-600' : 'text-vercel-gray-400 hover:text-vercel-gray-600'}
        hover:bg-vercel-gray-100
        focus:outline-none
      `}
    >
      {label}
      {/* Active indicator - 2px black bottom border */}
      <span
        className={`
          absolute left-0 right-0 -bottom-[9px] h-[2px] bg-vercel-gray-600
          transition-all duration-200 ease-out
          ${isActive ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'}
        `}
        style={{ borderRadius: '1px 1px 0 0' }}
      />
    </button>
  );
}
