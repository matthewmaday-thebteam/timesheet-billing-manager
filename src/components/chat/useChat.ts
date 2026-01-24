import { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { ChatMessage, ChatState, ChatResponse } from '../../types/chat';

/**
 * Hook for managing chat state and communication with the AI Edge Function
 */
export function useChat() {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isLoading: false,
    error: null,
  });

  /**
   * Generate a unique message ID
   */
  const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  /**
   * Send a message to the AI and get a response
   */
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    // Create user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    // Add user message and set loading
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isLoading: true,
      error: null,
    }));

    try {
      // Prepare message history for the API (exclude IDs and timestamps)
      const messageHistory = [...state.messages, userMessage].map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Call the Edge Function using Supabase client (handles auth automatically)
      const { data, error: fnError } = await supabase.functions.invoke('chat', {
        body: { messages: messageHistory },
      });

      if (fnError) {
        throw new Error(fnError.message || 'Failed to call chat function');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      // Create assistant message
      const responseData = data as ChatResponse;
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: responseData.content,
        timestamp: new Date(),
        toolCalls: responseData.toolCalls,
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
        isLoading: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to send message',
      }));
    }
  }, [state.messages]);

  /**
   * Clear all messages and reset the chat
   */
  const clearChat = useCallback(() => {
    setState({
      messages: [],
      isLoading: false,
      error: null,
    });
  }, []);

  /**
   * Dismiss any error
   */
  const dismissError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return {
    messages: state.messages,
    isLoading: state.isLoading,
    error: state.error,
    sendMessage,
    clearChat,
    dismissError,
  };
}
