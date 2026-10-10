/** The same icon used by the Mac app and the GitHub README. */
export function AppLogo({ className = '', size = 30 }: { className?: string; size?: number }) {
  return <img src="/app-icon.png" alt="" aria-hidden className={className} width={size} height={size} draggable={false} />;
}
