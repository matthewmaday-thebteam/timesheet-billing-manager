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
        ${isActive ? 'text-[#000000]' : 'text-[#666666] hover:text-[#000000]'}
        hover:bg-[#F5F5F5]
        focus:outline-none focus:ring-1 focus:ring-black
      `}
    >
      {label}
      {/* Active indicator - 2px black bottom border */}
      <span
        className={`
          absolute left-0 right-0 -bottom-[9px] h-[2px] bg-[#000000]
          transition-all duration-200 ease-out
          ${isActive ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'}
        `}
        style={{ borderRadius: '1px 1px 0 0' }}
      />
    </button>
  );
}
