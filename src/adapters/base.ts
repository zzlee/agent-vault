import type { AgentType, NormalizedSession } from '../core/types.js';

export interface SessionMeta {
  id: string;
  updatedAt: string;
  messageCount: number;
}

export interface CollectOptions {
  existingSessions?: Map<string, SessionMeta>;
}

export interface AgentAdapter {
  readonly name: AgentType;
  /** Check if this agent has files or database present on current machine */
  isAvailable(): Promise<boolean> | boolean;
  /** Collect all sessions from this agent with optional incremental optimization */
  collect(options?: CollectOptions): Promise<NormalizedSession[]>;
}
