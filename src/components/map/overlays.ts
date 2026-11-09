export interface Overlays {
  traffic: boolean;
  closures: boolean;
  projects: boolean;
  buildings: boolean;
  neighborhoods: boolean;
  vehicles: boolean;
  conflicts: boolean;
  terrain: boolean;
  /** optional licensed building models (public/models/kitbash) */
  kitbash: boolean;
}

export const DEFAULT_OVERLAYS: Overlays = {
  traffic: true,
  closures: true,
  projects: true,
  buildings: true,
  neighborhoods: true,
  vehicles: true,
  conflicts: true,
  terrain: false,
  kitbash: true,
};
