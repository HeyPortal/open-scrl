import { useEffect, useRef, useState } from 'react';
import { Group, Line, Rect, Text } from 'react-konva';
import Konva from 'konva';
import type { GapMarker } from '@/lib/snap';
import { canvasTheme } from './canvasTheme';

const FADE_SECONDS = 0.16;
const TICK = 4; // half-length of the end ticks, in screen px
const LABEL_FONT = 11;
const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const formatGap = (size: number) => `${Math.round(size)}`;

/**
 * Equal-spacing markers. They follow the live snap and fade briefly once the gesture
 * stops producing markers (release, cancel or leaving the snap).
 */
export function GapMarkers({ markers, offsetX, zoom }: { markers: GapMarker[]; offsetX: number; zoom: number }) {
  const [shown, setShown] = useState({ markers, offsetX });
  if (markers.length && (shown.markers !== markers || shown.offsetX !== offsetX)) setShown({ markers, offsetX });
  const group = useRef<Konva.Group>(null);
  const fade = useRef<Konva.Tween | null>(null);
  const hasShown = shown.markers.length > 0;
  const active = markers.length > 0;

  useEffect(() => {
    fade.current?.destroy(); fade.current = null;
    const node = group.current;
    if (active) { node?.opacity(1); return; }
    if (!hasShown) return;
    if (!node || prefersReducedMotion()) { setShown({ markers: [], offsetX: 0 }); return; }
    const tween = new Konva.Tween({ node, duration: FADE_SECONDS, opacity: 0, easing: Konva.Easings.EaseOut, onFinish: () => { fade.current = null; setShown({ markers: [], offsetX: 0 }); } });
    fade.current = tween; tween.play();
    return () => { tween.destroy(); if (fade.current === tween) fade.current = null; };
  }, [active, hasShown]);

  if (!hasShown) return null;
  const px = 1 / zoom;
  return <Group ref={group} x={shown.offsetX} listening={false} name="gap-markers">
    {shown.markers.map((m, i) => {
      const horizontal = m.axis === 'x';
      const mid = (m.start + m.end) / 2;
      const label = formatGap(m.end - m.start);
      const labelWidth = (label.length * 6.6 + 10) * px, labelHeight = 16 * px;
      const points = horizontal ? [m.start, m.position, m.end, m.position] : [m.position, m.start, m.position, m.end];
      const ticks = horizontal
        ? [[m.start, m.position - TICK * px, m.start, m.position + TICK * px], [m.end, m.position - TICK * px, m.end, m.position + TICK * px]]
        : [[m.position - TICK * px, m.start, m.position + TICK * px, m.start], [m.position - TICK * px, m.end, m.position + TICK * px, m.end]];
      const cx = horizontal ? mid : m.position, cy = horizontal ? m.position : mid;
      return <Group key={i}>
        <Line points={points} stroke={canvasTheme.gap} strokeWidth={1.5 * px} />
        {ticks.map((t, j) => <Line key={j} points={t} stroke={canvasTheme.gap} strokeWidth={1.5 * px} />)}
        <Rect x={cx - labelWidth / 2} y={cy - labelHeight / 2} width={labelWidth} height={labelHeight} cornerRadius={labelHeight / 2} fill={canvasTheme.gap} />
        <Text x={cx - labelWidth / 2} y={cy - labelHeight / 2} width={labelWidth} height={labelHeight} text={label} align="center" verticalAlign="middle" fontSize={LABEL_FONT * px} fontFamily="'Onest Variable', sans-serif" fontStyle="600" fill={canvasTheme.gapInk} />
      </Group>;
    })}
  </Group>;
}
