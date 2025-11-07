/**
 * Session Selection Component
 * Uses InlineSelection composition pattern for consistent UI
 */

import { InlineSelection } from '../../../components/selection/index.js';
import type { SelectionOption } from '../../../hooks/useSelection.js';

interface SessionSelectionProps {
  sessions: Array<{
    id: string;
    title: string | undefined;
    created: number;
    updated: number;
    displayText: string;
    isCurrent: boolean;
  }>;
  onSelect: (sessionId: string) => void | Promise<void>;
  onCancel: () => void;
}

export function SessionSelection({
  sessions,
  onSelect,
  onCancel,
}: SessionSelectionProps) {
  const sessionOptions: SelectionOption[] = sessions.map((session) => ({
    label: session.isCurrent ? `${session.displayText} (current)` : session.displayText,
    value: session.id,
  }));

  return (
    <InlineSelection
      options={sessionOptions}
      subtitle="Select a session to switch to"
      filter={true}
      onSelect={(value) => {
        Promise.resolve(onSelect(value as string)).then(() => {
          // Selection complete
        });
      }}
      onCancel={onCancel}
    />
  );
}
