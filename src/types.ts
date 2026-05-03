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

export interface Asset {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  blob: Blob;
  size?: number;
  hash?: string;
}
