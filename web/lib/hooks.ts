"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/* ------------------------------------------------------------ reduced motion */

function subscribeMotion(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/* ----------------------------------------------------------------- autopilot */

export interface Autopilot {
  /** Current step, advanced by the loop until the visitor takes over. */
  index: number;
  /** False once the visitor has touched the element. */
  cycling: boolean;
  /** Hand control to the visitor and keep their choice. */
  takeOver: (index?: number) => void;
  /** Spread onto the element so the first interaction stops the loop. */
  handoffProps: {
    onPointerDown: () => void;
    onKeyDown: () => void;
    onFocusCapture: () => void;
  };
}

/**
 * One rAF clock per element, owned by the element, deriving the step from
 * elapsed time rather than from a side interval that has to guess the state.
 */
export function useAutopilot(count: number, periodMs: number, enabled = true): Autopilot {
  const [index, setIndex] = useState(0);
  const [cycling, setCycling] = useState(true);
  const reduced = useReducedMotion();
  const running = enabled && cycling && !reduced && count > 1;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let startedAt = 0;
    let lastStep = 0;
    const tick = (now: number) => {
      if (startedAt === 0) startedAt = now;
      const step = Math.floor((now - startedAt) / periodMs);
      if (step !== lastStep) {
        lastStep = step;
        setIndex((i) => (i + 1) % count);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, count, periodMs]);

  const takeOver = useCallback((next?: number) => {
    setCycling(false);
    if (next !== undefined) setIndex(next);
  }, []);

  const stop = useCallback(() => setCycling(false), []);

  return {
    index: index % Math.max(count, 1),
    cycling: running,
    takeOver,
    handoffProps: {
      onPointerDown: stop,
      onKeyDown: stop,
      onFocusCapture: stop,
    },
  };
}

/* --------------------------------------------------------------- frame clock */

/**
 * Elapsed milliseconds since the clock started, sampled once per frame.
 * Returns 0 and never starts when paused, so a paused simulation costs nothing.
 */
export function useElapsed(running: boolean, resetKey: unknown): number {
  const [elapsed, setElapsed] = useState(0);

  /*
    resetKey is a dependency of the clock rather than the trigger for a separate
    effect that zeroes the state. Changing it tears the loop down and starts a
    new one whose first frame sets elapsed back to nearly zero, so the reset
    happens in a frame callback and never synchronously inside an effect.
  */
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let startedAt = 0;
    const tick = (now: number) => {
      if (startedAt === 0) startedAt = now;
      setElapsed(now - startedAt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, resetKey]);

  return elapsed;
}

/* ------------------------------------------------------------- intersection */

/** True once the node has been on screen, so heavy simulations start on sight. */
export function useOnScreen<T extends HTMLElement>(): [
  (node: T | null) => void,
  boolean,
] {
  const [seen, setSeen] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setSeen(true);
            io.disconnect();
          }
        }
      },
      { rootMargin: "120px" },
    );
    io.observe(node);
    observerRef.current = io;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [ref, seen];
}
