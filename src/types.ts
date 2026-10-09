export type Format = {
  name: string;
  width: number;
  height: number;
};

export type LayerKind = 'image' | 'text' | 'shape';

/** A color stop at `offset` (0–1) along a gradient. */
export interface GradientStop {
  offset: number;
  color: string;
}

export interface Gradient {
  type: 'linear' | 'radial';
  /** CSS `linear-gradient` semantics: 0° points up, 90° points right. Ignored for radial. */
  angle: number;
  /** At least two stops, sorted by offset. */
  stops: GradientStop[];
}

/** A drop shadow. Distances are in project pixels and do not rotate with the layer. */
export interface Shadow {
  color: string;
  /** 0–1, multiplied with the color's own alpha. */
  opacity: number;
  blur: number;
  offsetX: number;
  offsetY: number;
}

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
  /** Layers on the same slide that share a group id are selected, moved and arranged together. */
  groupId?: string | null;
  shadow?: Shadow | null;
}

/** Shapes a photo can be clipped to. `rect` uses `cornerRadius`. */
export type ImageMask = 'rect' | 'ellipse' | 'arch' | 'blob' | 'hexagon' | 'star' | 'heart';

export interface ImageLayer extends BaseLayer {
  kind: 'image';
  assetId: string | null;
  cornerRadius: number;
  cropOffsetX: number;
  cropOffsetY: number;
  cropScale: number;
  /** Decorative frame; omitted on older projects. */
  frameStyle?: 'polaroid' | 'paper' | 'film' | 'postcard';
  /** Missing means `rect`. */
  mask?: ImageMask;
  /** Border color, drawn inside the mask outline. */
  stroke?: string;
  /** Border width; missing or 0 means no border. */
  strokeWidth?: number;
}

/** A colored box behind text: one box around the whole text, or one per line. */
export interface TextHighlight {
  style: 'box' | 'lines';
  color: string;
  padding: number;
  radius: number;
}

export interface TextLayer extends BaseLayer {
  kind: 'text';
  text: string;
  fontFamily: string;
  /** With `autoFit`, the largest size the text may use. */
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  fill: string;
  align: 'left' | 'center' | 'right';
  letterSpacing: number;
  lineHeight: number;
  /** Outline color. */
  stroke?: string;
  /** Outline width; missing or 0 means no outline. */
  strokeWidth?: number;
  /** When set, replaces `fill`; spans the text box. */
  fillGradient?: Gradient | null;
  highlight?: TextHighlight | null;
  /** Shrink the font size until the text fits the box's width and height. */
  autoFit?: boolean;
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
  | {
      kind: 'gradient';
      /** First and last stop colors, kept for older readers when `stops` is present. */
      from: string;
      to: string;
      angle: number;
      /** Missing means `linear`. */
      type?: 'linear' | 'radial';
      /** Overrides `from`/`to` when it has at least two stops. */
      stops?: GradientStop[];
    }
  | {
      kind: 'image';
      /** The photo, cover-fitted and centered on the slide. `null` shows only `color`. */
      assetId: string | null;
      /** Gaussian blur radius in project pixels; 0 is a sharp photo. */
      blur: number;
      /** 0–1 black overlay that keeps text legible on busy photos. */
      dim: number;
      /** Drawn under the photo, and alone when the photo is missing. */
      color: string;
    }
  | { kind: 'transparent' };

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

export interface SlideGrid {
  templateId: string;
  gap: number;
  margin: number;
  slotIds: string[];
  /** Slots a relayout found off their computed cell; they stay free even if a later spacing lines up with them again. */
  detachedSlotIds?: string[];
}

export interface SlideRecord {
  id: string;
  background: Background;
  layerOrder: string[];
  grid?: SlideGrid;
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
