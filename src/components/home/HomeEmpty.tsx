import type { ReactNode } from 'react';

interface HomeEmptyProps {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}

/** A quiet empty state beside the new-project controls. */
export function HomeEmpty({ title, children, action }: HomeEmptyProps) {
  return (
    <div className="home-empty">
      <h3 className="home-empty-title">{title}</h3>
      <p className="home-empty-text">{children}</p>
      {action}
    </div>
  );
}
