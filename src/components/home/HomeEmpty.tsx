import type { ReactNode } from 'react';

/** Three tilted frames with a coral glow, drawn with theme tokens only. */
function Frames() {
  return (
    <div className="home-empty-art" aria-hidden>
      <span className="home-empty-glow" />
      <span className="home-empty-frame" data-pos="left" />
      <span className="home-empty-frame" data-pos="right" />
      <span className="home-empty-frame" data-pos="center">
        <i /><i /><i className="wide" />
      </span>
    </div>
  );
}

interface HomeEmptyProps {
  /** Small coral line above the title; also part of the heading's accessible name. */
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

/** "No projects yet" illustration, text and an optional action. */
export function HomeEmpty({ eyebrow, title, children, action }: HomeEmptyProps) {
  return (
    <div className="home-empty">
      <Frames />
      <h3 className="home-empty-heading">
        <span className="home-eyebrow">{eyebrow}</span>
        <span className="home-empty-title">{title}</span>
      </h3>
      <p className="home-empty-text">{children}</p>
      {action}
    </div>
  );
}
