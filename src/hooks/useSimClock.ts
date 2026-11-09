import { useEffect } from 'react';
import { useStore } from '@/store/store';
import { HORIZON_DAYS } from '@/utils/date';

/** Base rate: simulated days per real second at 1× speed. */
export const DAYS_PER_SECOND = 0.5;

export function useSimClock() {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useStore.getState();
      if (s.playing) {
        const next = s.simTime + dt * s.speed * DAYS_PER_SECOND;
        if (next >= HORIZON_DAYS - 1e-3) {
          s.setSimTime(HORIZON_DAYS - 1e-3);
          s.setPlaying(false);
        } else s.setSimTime(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}
