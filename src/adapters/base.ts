import type { AgentType, NormalizedSession } from '../core/types.js';

export interface AgentAdapter {
  readonly name: AgentType;
  /** Check if this agent has files or database present on current machine */
  isAvailable(): Promise<boolean> | boolean;
  /** Collect all sessions from this agent */
  collect(): Promise<NormalizedSession[]>;
}
