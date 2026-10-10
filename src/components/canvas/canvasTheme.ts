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
  selection: '#ff6a3d', selectionFill: 'rgba(255,106,61,0.12)', dropFill: 'rgba(255,106,61,0.22)', slideDropFill: 'rgba(255,106,61,0.06)',
  slideOutline: '#2c2c33', slideShadow: '#000000', transformerAnchorFill: '#18181c', guide: '#ff7d55', seam: '#f4f4f6', workspace: '#0a0a0c', inkDim: '#a1a1ad',
  placeholder: { fill: '#232329', selectedFill: '#3c261e', stroke: '#34343c', icon: '#6b6b78', selectedIcon: '#ff7d55', label: '#a1a1ad', selectedLabel: '#ff9c7f' },
};
