import type { Layer, ProjectDocumentV2, ShapeLayer } from '../../src/types';

/** Fixed geometry and media make this fixture reusable across runtime versions. */
export function runtimeArtwork(assetId: string): ProjectDocumentV2 {
  const shape = (id: string, x: number, y: number, width: number, height: number, extra: Partial<ShapeLayer> = {}): ShapeLayer => ({
    id, kind: 'shape', name: id, x, y, width, height, rotation: 0, opacity: 1,
    visible: true, locked: false, shape: 'rect', fill: '#e8590c', stroke: '#542a16',
    strokeWidth: 3, cornerRadius: 8, ...extra,
  });
  const layers: Layer[] = [
    shape('runtime-rect', 60, 55, 110, 90),
    shape('runtime-ellipse', 245, 55, 110, 90, { shape: 'ellipse', fill: '#3b82f6' }),
    shape('runtime-locked', 460, 55, 100, 70, { locked: true, fill: '#7c3aed' }),
    {
      id: 'runtime-text', kind: 'text', name: 'Runtime text', x: 60, y: 200,
      width: 240, height: 140, rotation: -7, opacity: .9, visible: true, locked: false,
      text: 'Canvas\nArt & type', fontFamily: 'Inter', fontSize: 31, fontWeight: 700,
      italic: false, fill: '#0f172a', align: 'center', letterSpacing: 1.5, lineHeight: 1.25,
      stroke: '#ffffff', strokeWidth: 1, highlight: { style: 'lines', color: '#fef08a', padding: 6, radius: 4 },
      fillGradient: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#be123c' }, { offset: 1, color: '#4338ca' }] },
      shadow: { color: '#0f172a', opacity: .3, blur: 5, offsetX: 3, offsetY: 5 },
    },
    {
      id: 'runtime-photo', kind: 'image', name: 'Runtime photo', x: 370, y: 195,
      width: 200, height: 210, rotation: 11, opacity: .95, visible: true, locked: false,
      assetId, mask: 'arch', cornerRadius: 16, cropScale: 1.4, cropOffsetX: .2, cropOffsetY: -.1,
      stroke: '#ffffff', strokeWidth: 6,
      shadow: { color: '#000000', opacity: .4, blur: 12, offsetX: 5, offsetY: 8 },
    },
    shape('runtime-group-a', 80, 455, 100, 70, { fill: '#16a34a', opacity: .75 }),
    shape('runtime-group-b', 230, 455, 100, 70, { fill: '#db2777' }),
    shape('runtime-span', -35, 350, 90, 60, { fill: '#facc15', rotation: 9 }),
  ];
  return {
    schemaVersion: 2, revision: 0, id: 'runtime-artwork', name: 'Runtime artwork',
    format: { name: 'Runtime square', width: 640, height: 640 },
    createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
    slideOrder: ['runtime-slide-a', 'runtime-slide-b'],
    slides: {
      'runtime-slide-a': {
        id: 'runtime-slide-a', layerOrder: layers.slice(0, -1).map((layer) => layer.id),
        background: { kind: 'gradient', from: '#fff7ed', to: '#c7d2fe', angle: 135 },
      },
      'runtime-slide-b': { id: 'runtime-slide-b', layerOrder: ['runtime-span'], background: { kind: 'image', assetId, blur: 18, dim: .15, color: '#ffffff' } },
    },
    layers: Object.fromEntries(layers.map((layer) => [layer.id, layer])),
  };
}
