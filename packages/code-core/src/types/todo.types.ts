/**
 * Todo Types
 * Task tracking for LLM work progress
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'removed';

export interface Todo {
  id: number;
  content: string;
  status: TodoStatus;
  activeForm: string; // Present continuous form (e.g., "Building feature X")
  ordering: number;   // For custom ordering (higher = earlier in list)

  // Entity relationships (normalized)
  createdByToolId?: string;   // NEW: Tool that created this todo (references Tool.id or MCP tool ID)
  createdByStepId?: string;   // NEW: Step where this todo was created (references MessageStep.id)
  relatedFiles?: string[];    // NEW: Related file paths for this todo
  metadata?: {
    tags?: string[];          // Custom tags for categorization
    priority?: 'low' | 'medium' | 'high';
    estimatedMinutes?: number;
    dependencies?: number[];  // Todo IDs this depends on
  };
}

export interface TodoUpdate {
  id?: number;
  content?: string;
  activeForm?: string;
  status?: TodoStatus;
  reorder?: {
    type: 'before' | 'after' | 'top' | 'last';
    id?: number; // Required when type is 'before' or 'after'
  };
}
