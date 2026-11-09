import { newtonianGravity } from '@/physics/forces/gravity';
import { sunGR } from '@/physics/forces/gr';
import { EinsteinInfeldHoffmann } from '@/physics/forces/eih';
import { oblateness } from '@/physics/forces/oblateness';
import { LenseThirring } from '@/physics/forces/lenseThirring';
import { poleEcliptic } from '@/physics/orientation';
import { AU_KM } from '@/data/constants';
import type { ForceModel } from '@/physics/types';
import type { PhysicsConfig } from './config';

const SUN_J2 = 2.2e-7;
const SUN_RADIUS_AU = 695_700 / AU_KM;
const SUN_POLE = poleEcliptic(286.13, 63.87);

export function buildForces(ids: readonly string[], cfg: PhysicsConfig): ForceModel[] {
  const f: ForceModel[] = [newtonianGravity];
  const sun = ids.indexOf('sun');

  if (cfg.eihRelativity) {
    f.push(new EinsteinInfeldHoffmann());
  } else if (sun >= 0 && cfg.gr) {
    f.push(sunGR(sun));
  }

  if (sun >= 0 && cfg.sunJ2) {
    f.push(oblateness(sun, SUN_J2, SUN_RADIUS_AU, () => SUN_POLE));
  }

  if (sun >= 0 && cfg.lenseThirring) {
    f.push(new LenseThirring({ centralIndex: sun }));
  }

  return f;
}
