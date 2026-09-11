export type AgentType = 'pi' | 'opencode' | 'agy';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface NormalizedMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp?: string;
  step_index?: number;
  has_tool_calls?: boolean;
}

export interface NormalizedSession {
  schema_version: string;
  id: string; // e.g. agy_ubuntu-devbox_uuid
  agent: AgentType;
  machine: {
    hostname: string;
    platform: string;
  };
  session: {
    native_id: string;
    title: string;
    workspace?: string;
    created_at: string;
    updated_at: string;
  };
  messages: NormalizedMessage[];
}

export interface SearchResult {
  sessionId: string;
  agent: AgentType;
  hostname: string;
  title: string;
  workspace?: string;
  role: MessageRole;
  snippet: string;
  updatedAt: string;
}

export interface SessionSummary {
  id: string;
  agent: AgentType;
  hostname: string;
  nativeId: string;
  title: string;
  workspace?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}
