'use client';
import { useEffect, useRef, useState } from 'react';

/** Counts up to `value` when it appears; a later value counts on from the one on screen. */
export function CountUp({ value, ms = 700, delay = 0, suffix = '' }: { value: number; ms?: number; delay?: number; suffix?: string }) {
  const [shown, setShown] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    const set = (n: number) => {
      current.current = n;
      setShown(n);
    };
    let raf = 0;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      raf = requestAnimationFrame(() => set(value));
      return () => cancelAnimationFrame(raf);
    }
    const from = current.current;
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const k = Math.min(1, (t - start) / ms);
      set(Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    const timer = setTimeout(() => (raf = requestAnimationFrame(step)), delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [value, ms, delay]);
  return (
    <>
      {shown}
      {suffix}
    </>
  );
}
