import { useEffect, useRef } from 'react';
import { Modal } from '../Modal';
import { Alert } from '../Alert';
import { Icon } from '../Icon';
import { TypingIndicator } from '../TypingIndicator';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChat } from './useChat';

interface AIChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * AI Chat window using the standard Modal component
 */
export function AIChatWindow({ isOpen, onClose }: AIChatWindowProps) {
  const { messages, isLoading, error, sendMessage, clearChat } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const titleIconElement = <Icon type="chat" size="sm" variant="brand" />;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Ask the Accountant"
      titleIcon={titleIconElement}
      maxWidth="xl"
    >
      <div className="flex flex-col h-[400px]">
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto space-y-3 scrollbar-thin">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <div className="mb-3">
                <Icon type="chat" size="lg" variant="default" />
              </div>
              <p className="text-sm text-vercel-gray-400 mb-2">
                Ask me about your data
              </p>
              <div className="space-y-1">
                <p className="text-xs text-vercel-gray-300">
                  "What was revenue last month?"
                </p>
                <p className="text-xs text-vercel-gray-300">
                  "Who logged the most hours?"
                </p>
                <p className="text-xs text-vercel-gray-300">
                  "Compare Jan to Feb revenue"
                </p>
              </div>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <TypingIndicator />
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Error alert */}
        {error && (
          <div className="mt-3">
            <Alert message={error} variant="error" icon="error" />
          </div>
        )}

        {/* Input area */}
        <div className="mt-4 pt-4 border-t border-vercel-gray-100">
          <ChatInput
            onSend={sendMessage}
            onClear={clearChat}
            disabled={isLoading}
            showClear={messages.length > 0}
          />
        </div>
      </div>
    </Modal>
  );
}
