import { useCallback } from 'react';
import { useTerminalInstance } from './useTerminalInstance';
import { focusInstance } from './terminalRegistry';

interface TerminalViewProps {
  terminalId: string;
  projectId: string;
  isActive: boolean;
}

export function TerminalView({ terminalId, projectId, isActive }: TerminalViewProps) {
  const { containerRef } = useTerminalInstance({ terminalId, projectId, isActive });

  const handleMouseDown = useCallback(() => {
    focusInstance(terminalId);
  }, [terminalId]);

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      className={`w-full h-full px-1 pt-1 ${isActive ? '' : 'hidden'}`}
    />
  );
}
