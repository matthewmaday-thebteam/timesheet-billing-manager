/**
 * AI Chat Types
 * Types for the conversational AI assistant feature
 */

/**
 * A tool call result showing what the AI executed
 */
export interface ToolCallResult {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
}

/**
 * A single message in the chat conversation
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCallResult[];
  isStreaming?: boolean;
}

/**
 * Chat state for the useChat hook
 */
export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Request body sent to the chat Edge Function
 */
export interface ChatRequest {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

/**
 * Response from the chat Edge Function
 */
export interface ChatResponse {
  content: string;
  toolCalls?: ToolCallResult[];
  error?: string;
}

/**
 * Tool parameter schemas (for documentation/reference)
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
