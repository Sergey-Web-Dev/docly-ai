export type BackdropVariant = 'space' | 'aurora' | 'galaxy';

interface SpaceBackdropProps {
  readonly variant: BackdropVariant;
  /** Freeze the CSS animations too (checkout page). */
  readonly isPaused?: boolean;
}

function Layers({ variant }: { readonly variant: BackdropVariant }): React.ReactElement {
  if (variant === 'aurora') {
    return (
      <>
        <div className="aurora-band aurora-band-teal" />
        <div className="aurora-band aurora-band-indigo" />
        <div className="aurora-band aurora-band-violet" />
        <div className="aurora-floor absolute inset-0" />
      </>
    );
  }
  if (variant === 'galaxy') {
    return (
      <>
        <div className="space-nebula galaxy-nebula-violet" />
        <div className="space-nebula galaxy-nebula-blue" />
        <div className="galaxy-vignette absolute inset-0" />
      </>
    );
  }
  return (
    <>
      <div className="space-nebula space-nebula-band" />
      <div className="space-nebula space-nebula-indigo" />
      <div className="space-nebula space-nebula-violet" />
      <div className="space-nebula space-nebula-blue" />
      <div className="space-vignette absolute inset-0" />
    </>
  );
}

/**
 * Deep-space layer behind the star canvas, pure CSS. All variants carry `.space-backdrop`, which the global CSS
 * keys `html:has(...)` on, so the page is dark on the server-rendered first paint.
 */
export function SpaceBackdrop({ variant, isPaused = false }: SpaceBackdropProps): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      data-testid="space-backdrop"
      data-variant={variant}
      data-paused={isPaused ? 'true' : undefined}
      className={`space-backdrop space-backdrop-${variant} pointer-events-none fixed inset-0 -z-20 overflow-hidden`}
    >
      <Layers variant={variant} />
    </div>
  );
}
