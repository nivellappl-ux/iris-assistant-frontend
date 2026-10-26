import { useEffect, useRef, type MouseEvent } from 'react';
import { BotEngine } from '../mochi/engine';
import type { BotStateName } from '../core/layout';

interface MochiCanvasProps {
  state: BotStateName;
  size?: number;
  engine?: BotEngine;
  className?: string;
}

export function MochiCanvas({ state, size = 144, engine, className = '' }: MochiCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ownEngineRef = useRef<BotEngine | null>(null);
  if (!ownEngineRef.current) ownEngineRef.current = new BotEngine();
  const engineRef = useRef(engine ?? ownEngineRef.current);
  engineRef.current = engine ?? ownEngineRef.current;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let frame = 0;
    let visible = true;
    let previous = performance.now();
    let width = size;
    let height = size;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width || size;
      height = rect.height || size;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const tick = (now: number) => {
      if (!visible || document.visibilityState === 'hidden') {
        frame = 0;
        return;
      }
      const delta = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      engineRef.current?.update(delta);
      context.clearRect(0, 0, width, height);
      engineRef.current?.draw(context, width, height);
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (visible && document.visibilityState !== 'hidden' && !frame) {
        previous = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const intersectionObserver = 'IntersectionObserver' in window
      ? new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          if (visible) start();
          else stop();
        }, { threshold: 0.01 })
      : null;
    intersectionObserver?.observe(canvas);
    const onVisibilityChange = () => document.visibilityState === 'hidden' ? stop() : start();

    resize();
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (!intersectionObserver) start();

    return () => {
      stop();
      observer.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [size]);

  useEffect(() => {
    engineRef.current?.setState(state, true);
  }, [state]);

  const look = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const activeEngine = engineRef.current;
    if (!activeEngine || !rect.width || !rect.height) return;
    activeEngine.lookX = ((event.clientX - rect.left) / rect.width - 0.5) * 1.3;
    activeEngine.lookY = ((event.clientY - rect.top) / rect.height - 0.5) * 1.2;
  };

  return (
    <div
      className={`mochi-figure ${className}`.trim()}
      style={{ width: size, height: size }}
      onMouseMove={look}
      onClick={() => engineRef.current?.greet()}
      title="Clica para cumprimentar a IRIS"
    >
      <canvas
        ref={canvasRef}
        className="mochi-figure-canvas"
        style={{ width: size, height: size }}
        aria-label="IRIS, a personagem da app"
      />
    </div>
  );
}