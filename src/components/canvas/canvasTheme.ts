export interface CanvasTheme {
  selection: string;
  selectionFill: string;
  dropFill: string;
  slideDropFill: string;
  slideOutline: string;
  slideShadow: string;
  transformerAnchorFill: string;
  guide: string;
  seam: string;
  workspace: string;
  inkDim: string;
  placeholder: { fill: string; selectedFill: string; stroke: string; icon: string; selectedIcon: string; label: string; selectedLabel: string };
}

/** Keep the Konva palette aligned with styles/studio/tokens.css. */
export const canvasTheme: CanvasTheme = {
  selection: '#ae99ff', selectionFill: 'rgba(174,153,255,0.12)', dropFill: 'rgba(174,153,255,0.22)', slideDropFill: 'rgba(174,153,255,0.06)',
  slideOutline: '#2c2c33', slideShadow: '#000000', transformerAnchorFill: '#18181c', guide: '#7dbbff', seam: '#f4f4f6', workspace: '#0a0a0c', inkDim: '#a1a1ad',
  placeholder: { fill: '#232329', selectedFill: '#2c283f', stroke: '#34343c', icon: '#6b6b78', selectedIcon: '#ae99ff', label: '#a1a1ad', selectedLabel: '#c4b5ff' },
};
