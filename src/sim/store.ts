export type ScaleMode = 'true' | 'pixels' | 'exaggerated';
export type AppMode = 'solar' | 'galaxy';
export type GalaxyCamera = 'face-on' | 'edge-on' | 'follow-sun' | 'sgra' | 'perspective';

export type DynamicsMode = 'simulation' | 'ephemeris';

export interface AppState {
  mode: AppMode;
  showMilkyWay: boolean;
  showOortCloud: boolean;
  showGalacticHalo: boolean;
  showLabels: boolean;
  showOrbitPaths?: boolean;
  dynamicsMode: DynamicsMode;
  galaxyModelId: string;
  showRealityInspector: boolean;
  showValidationTable: boolean;
  playing: boolean;
  reversed: boolean;
  speed: number; // simulated days per real second (always positive)
  galaxySpeed: number; // simulated Myr per real second (default 2)
  galaxyZExag: number; // vertical exaggeration factor for z (default 1)
  galaxyCamera: GalaxyCamera;
  preset: string;
  trails: boolean;
  frame: string; // ReferenceFrame id
  focus: string; // 'barycenter' or a body id: what the camera follows
  trailDays: number; // how much history to draw
  scaleMode: ScaleMode;
  scaleExaggeration: number; // 1 to 500
  selected: string | null;
  compress: number; // along-track compression factor (1 = true scale, 0.05 = 1:20)
}

export function createStore<T extends object>(initial: T) {
  let state = { ...initial };
  const subs = new Set<(s: T, changed: keyof T) => void>();
  return {
    get: (): T => state,
    set<K extends keyof T>(key: K, value: T[K]): void {
      if (Object.is(state[key], value)) return;
      state = { ...state, [key]: value } as T;
      subs.forEach((f) => f(state, key));
    },
    subscribe(f: (s: T, changed: keyof T) => void): () => void {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
}
export type AppStore = ReturnType<typeof createStore<AppState>>;
