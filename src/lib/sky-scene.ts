import { createConstellationScene, drawConstellations, type ConstellationScene } from '@/lib/constellation-draw';
import { createGalaxyScene, drawGalaxyScene, type GalaxyScene } from '@/lib/galaxy-draw';
import { createSpaceScene, drawSpace, type SpaceScene } from '@/lib/space-draw';
import { drawField } from '@/lib/starfield-draw';
import type { FieldState } from '@/lib/starfield-draw';
import { generateStars, starCountForArea, type Star } from '@/lib/starfield';

export type SkyVariant = 'light' | 'space' | 'constellations' | 'galaxy';

const STAR_SEED = 20260611;
const SPACE_SEED = 20261018;
const CONSTELLATION_SEED = 20261101;
const GALAXY_SEED = 20261102;

export interface SkyConfig {
  readonly variant: SkyVariant;
  readonly density: number;
  /** Only the light variant uses this; the others have their own per-star brightness. */
  readonly opacity: number;
  /** Draw one still frame (reduced motion / paused): no shooting stars, no ambient spawns. */
  readonly isStatic: boolean;
}

export interface SkyScene {
  /** Rebuild for the current `state.width / height` (call after the canvas was resized). */
  readonly resize: (dpr: number) => void;
  readonly draw: (time: number) => void;
}

function createLightScene(ctx: CanvasRenderingContext2D, state: FieldState, config: SkyConfig): SkyScene {
  let stars: readonly Star[] = [];
  return {
    resize: () => {
      stars = generateStars(starCountForArea(state.width, state.height, config.density), STAR_SEED);
    },
    draw: (time) => drawField(ctx, stars, state, time, config.opacity),
  };
}

function createSpaceSky(ctx: CanvasRenderingContext2D, state: FieldState, config: SkyConfig): SkyScene {
  let scene: SpaceScene | null = null;
  return {
    resize: (dpr) => {
      scene = createSpaceScene(state.width, state.height, config.density, dpr, SPACE_SEED, scene);
    },
    draw: (time) => {
      if (scene) drawSpace(ctx, scene, state, time, !config.isStatic);
    },
  };
}

function createConstellationSky(ctx: CanvasRenderingContext2D, state: FieldState, config: SkyConfig): SkyScene {
  let scene: ConstellationScene | null = null;
  return {
    resize: (dpr) => {
      scene = createConstellationScene(state.width, state.height, config.density, dpr, CONSTELLATION_SEED, scene);
    },
    draw: (time) => {
      if (scene) drawConstellations(ctx, scene, state, time, !config.isStatic);
    },
  };
}

function createGalaxySky(ctx: CanvasRenderingContext2D, state: FieldState, config: SkyConfig): SkyScene {
  let scene: GalaxyScene | null = null;
  return {
    resize: (dpr) => {
      scene = createGalaxyScene(state.width, state.height, config.density, dpr, GALAXY_SEED, scene);
    },
    draw: (time) => {
      if (scene) drawGalaxyScene(ctx, scene, state, time);
    },
  };
}

export function createSkyScene(ctx: CanvasRenderingContext2D, state: FieldState, config: SkyConfig): SkyScene {
  switch (config.variant) {
    case 'space':
      return createSpaceSky(ctx, state, config);
    case 'constellations':
      return createConstellationSky(ctx, state, config);
    case 'galaxy':
      return createGalaxySky(ctx, state, config);
    case 'light':
      return createLightScene(ctx, state, config);
  }
}
