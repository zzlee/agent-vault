export type AgentType = 'pi' | 'opencode' | 'agy' | 'freebuff' | 'hermes' | 'codex';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'thinking';

export interface NormalizedMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp?: string;
  step_index?: number;
  has_tool_calls?: boolean;
}

export interface MachineInfo {
  id: string;        // e.g. "zzlee-ThinkPad-L560-6af6"
  name: string;      // e.g. "zzlee-ThinkPad-L560" or custom alias
  hostname: string;  // os.hostname()
  platform: string;  // os.platform()
}

export interface NormalizedSession {
  schema_version: string;
  id: string; // e.g. <agent>_<machine.id>_<native_id>
  agent: AgentType;
  machine: MachineInfo;
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
  machineId: string;
  machineName: string;
  title: string;
  workspace?: string;
  role: MessageRole;
  snippet: string;
  updatedAt: string;
}

export interface PagedSearchResult {
  results: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SessionSummary {
  id: string;
  agent: AgentType;
  machineId: string;
  machineName: string;
  nativeId: string;
  title: string;
  workspace?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface SessionDetail {
  session: SessionSummary;
  messages: Array<{
    id: string;
    role: MessageRole;
    content: string;
    timestamp?: string;
    stepIndex?: number;
    hasToolCalls?: boolean;
  }>;
}

export interface WorkspaceSummary {
  workspace: string;
  sessionCount: number;
  agents: AgentType[];
  lastUpdatedAt: string;
}

