export interface TextLayoutInput {
  text: string;
  width: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

export interface TextLine { text: string; y: number }

export function layoutText(
  input: TextLayoutInput,
  measure: (text: string) => number,
): TextLine[] {
  const lines: TextLine[] = [];
  const paragraphs = input.text.split('\n');
  const lineStep = input.fontSize * input.lineHeight;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push({ text: '', y: lines.length * lineStep });
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const spacing = Math.max(0, candidate.length - 1) * input.letterSpacing;
      if (current && measure(candidate) + spacing > input.width) {
        lines.push({ text: current, y: lines.length * lineStep });
        current = word;
      } else current = candidate;
    }
    lines.push({ text: current, y: lines.length * lineStep });
  }
  return lines;
}
