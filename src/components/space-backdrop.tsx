/** Deep-space gradient with slowly drifting, blurred nebula clouds. Pure CSS: sits behind the star canvas. */
export function SpaceBackdrop(): React.ReactElement {
  return (
    <div aria-hidden="true" data-testid="space-backdrop" className="space-backdrop pointer-events-none fixed inset-0 -z-20 overflow-hidden">
      <div className="space-nebula space-nebula-band" />
      <div className="space-nebula space-nebula-indigo" />
      <div className="space-nebula space-nebula-violet" />
      <div className="space-nebula space-nebula-blue" />
      <div className="space-vignette absolute inset-0" />
    </div>
  );
}
