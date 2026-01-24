/**
 * Messenger-style typing indicator with animated dots
 * Three dots animate in a wave pattern, scaling up from bottom-left on enter
 */
export function TypingIndicator() {
  return (
    <div className="typing-indicator-container animate-typing-enter">
      <div className="flex items-center gap-1 bg-vercel-gray-50 rounded-full px-5 py-2.5">
        <div className="typing-dot" style={{ animationDelay: '0ms' }} />
        <div className="typing-dot" style={{ animationDelay: '150ms' }} />
        <div className="typing-dot" style={{ animationDelay: '300ms' }} />
      </div>

      <style>{`
        .typing-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background-color: var(--color-bteam-brand);
          animation: typing-bounce 1.2s ease-in-out infinite;
        }

        @keyframes typing-bounce {
          0%, 60%, 100% {
            transform: translateY(0);
          }
          30% {
            transform: translateY(-6px);
          }
        }

        @keyframes typing-enter {
          0% {
            transform: scale(0);
            transform-origin: bottom left;
            opacity: 0;
          }
          100% {
            transform: scale(1);
            transform-origin: bottom left;
            opacity: 1;
          }
        }

        .animate-typing-enter {
          animation: typing-enter 0.2s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
