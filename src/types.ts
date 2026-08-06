export type Format = {
  name: string;
  width: number;
  height: number;
};

export type LayerKind = 'image' | 'text' | 'shape';

export interface BaseLayer {
  id: string;
  kind: LayerKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}

export interface ImageLayer extends BaseLayer {
  kind: 'image';
  assetId: string | null;
  cornerRadius: number;
  cropOffsetX: number;
  cropOffsetY: number;
  cropScale: number;
}

export interface TextLayer extends BaseLayer {
  kind: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  fill: string;
  align: 'left' | 'center' | 'right';
  letterSpacing: number;
  lineHeight: number;
}

export interface ShapeLayer extends BaseLayer {
  kind: 'shape';
  shape: 'rect' | 'ellipse';
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
}

export type Layer = ImageLayer | TextLayer | ShapeLayer;

export type Background =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number };

export interface Slide {
  id: string;
  background: Background;
  layers: Layer[];
}

export interface Document {
  id: string;
  name: string;
  format: Format;
  slides: Slide[];
  createdAt: number;
  updatedAt: number;
}

/** Persisted project format. Layers are normalized so a layer update does not
 * recreate every slide and consumers can subscribe by id. */
export interface ProjectDocumentV2 {
  schemaVersion: 2;
  revision: number;
  id: string;
  name: string;
  format: Format;
  slideOrder: string[];
  slides: Record<string, SlideRecord>;
  layers: Record<string, Layer>;
  createdAt: number;
  updatedAt: number;
}

export interface SlideRecord {
  id: string;
  background: Background;
  layerOrder: string[];
}

export type PersistedDocument = Document | ProjectDocumentV2;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Asset {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  blob: Blob;
  sourceBlob?: Blob;
  sourceMime?: string;
  sourceName?: string;
  size?: number;
  hash?: string;
  /** Missing on projects created before animated media support. */
  mediaKind?: 'image' | 'gif' | 'video';
  /** Duration in seconds for GIF/video assets. */
  duration?: number;
}

export interface AssetMeta {
  id: string;
  blobKey: string;
  thumbnailKey: string;
  hash: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  /** Missing on assets imported before animated media support. */
  mediaKind?: 'image' | 'gif' | 'video';
  duration?: number;
}
