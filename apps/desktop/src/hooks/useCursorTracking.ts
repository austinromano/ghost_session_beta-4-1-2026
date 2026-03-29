import { useEffect, useRef } from 'react';
import { sendCursorMove } from '../lib/socket';

export function useCursorTracking(
  containerRef: React.RefObject<HTMLElement>,
  projectId: string | null,
) {
  const lastEmit = useRef(0);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  useEffect(() => {
    const THROTTLE_MS = 50;

    const handleMouseMove = (e: MouseEvent) => {
      const pid = projectIdRef.current;
      const el = containerRef.current;
      if (!pid || !el) return;

      const now = Date.now();
      if (now - lastEmit.current < THROTTLE_MS) return;
      lastEmit.current = now;

      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
        sendCursorMove(pid, x, y);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [containerRef]);
}
