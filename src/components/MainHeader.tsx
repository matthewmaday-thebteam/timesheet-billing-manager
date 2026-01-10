import { Avatar } from './Avatar';

export function MainHeader() {
  return (
    <header className="h-14 bg-[#FFFFFF] border-b border-[#EAEAEA]">
      <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
        {/* Left: Breadcrumb / Project Switcher */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#666666]">Matthew Maday's projects</span>
          <span className="text-[#EAEAEA]">/</span>
          <span className="text-sm font-semibold text-[#000000]">timesheet-billing-manager</span>
        </div>

        {/* Right: Links and Avatar */}
        <div className="flex items-center gap-4">
          {/* Feedback Link */}
          <button className="text-sm text-[#666666] hover:text-[#000000] transition-colors focus:outline-none focus:ring-1 focus:ring-black rounded px-2 py-1">
            Feedback
          </button>

          {/* Docs Link */}
          <button className="text-sm text-[#666666] hover:text-[#000000] transition-colors focus:outline-none focus:ring-1 focus:ring-black rounded px-2 py-1">
            Docs
          </button>

          {/* Separator */}
          <div className="w-px h-6 bg-[#EAEAEA]" />

          {/* User Avatar */}
          <Avatar name="Matthew Maday" size={32} />
        </div>
      </div>
    </header>
  );
}
