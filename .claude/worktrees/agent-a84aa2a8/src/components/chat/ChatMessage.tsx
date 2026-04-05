import type { ChatMessage as ChatMessageType } from '../../types/chat';
import { Markdown } from '../Markdown';

interface ChatMessageProps {
  message: ChatMessageType;
}

/**
 * Individual chat message bubble with support for tool call display
 */
export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 ${
          isUser
            ? 'bg-vercel-gray-600 text-white'
            : 'bg-vercel-gray-50 text-vercel-gray-600'
        }`}
      >
        {/* Message content */}
        <div className="text-sm break-words">
          {isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : (
            <Markdown content={message.content} />
          )}
        </div>

{/* Tool calls hidden - user doesn't need to see data retrieval details */}

        {/* Timestamp */}
        <div
          className={`text-xs mt-1 ${
            isUser ? 'text-white/70' : 'text-vercel-gray-300'
          }`}
        >
          {formatTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
}

/**
 * Format timestamp for display
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
