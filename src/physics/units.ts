/**
 * Nominal / Branded Unit Types (AUDIT-15, Mission §2.10).
 *
 * Enforces dimensional analysis and prevents unit mix-ups (e.g. AU vs km,
 * seconds vs days) at compile time with zero runtime performance cost.
 */

import { AU_KM, DAY_S } from '@/data/constants';

declare const __brand: unique symbol;
export type Brand<T, B> = T & { readonly [__brand]: B };

// Length units
export type Au = Brand<number, 'Au'>;
export type Km = Brand<number, 'Km'>;
export type Parsec = Brand<number, 'Parsec'>;
export type LightYear = Brand<number, 'LightYear'>;

// Time units
export type Day = Brand<number, 'Day'>;
export type Second = Brand<number, 'Second'>;
export type JulianDate = Brand<number, 'JulianDate'>;

// Velocity units
export type KmPerSec = Brand<number, 'KmPerSec'>;
export type AuPerDay = Brand<number, 'AuPerDay'>;

// Angle units
export type Radian = Brand<number, 'Radian'>;
export type Degree = Brand<number, 'Degree'>;

// Gravitational parameter (GM) units: AU^3 / day^2 vs km^3 / s^2
export type GmInternal = Brand<number, 'GmInternal'>; // AU^3 / day^2
export type GmKm3S2 = Brand<number, 'GmKm3S2'>; // km^3 / s^2

// Constructors / Assertions
export const asAu = (n: number): Au => n as Au;
export const asKm = (n: number): Km => n as Km;
export const asDay = (n: number): Day => n as Day;
export const asSecond = (n: number): Second => n as Second;
export const asJd = (n: number): JulianDate => n as JulianDate;
export const asKmPerSec = (n: number): KmPerSec => n as KmPerSec;
export const asAuPerDay = (n: number): AuPerDay => n as AuPerDay;
export const asRadian = (n: number): Radian => n as Radian;
export const asDegree = (n: number): Degree => n as Degree;
export const asGmInternal = (n: number): GmInternal => n as GmInternal;
export const asGmKm3S2 = (n: number): GmKm3S2 => n as GmKm3S2;

// Safe dimensional conversion operators
export const kmToAuTyped = (km: Km): Au => (km / AU_KM) as Au;
export const auToKmTyped = (au: Au): Km => (au * AU_KM) as Km;
export const kmsToAuDayTyped = (kms: KmPerSec): AuPerDay => ((kms * DAY_S) / AU_KM) as AuPerDay;
export const auDayToKmsTyped = (aud: AuPerDay): KmPerSec => ((aud * AU_KM) / DAY_S) as KmPerSec;
export const degToRadTyped = (deg: Degree): Radian => ((deg * Math.PI) / 180) as Radian;
export const radToDegTyped = (rad: Radian): Degree => ((rad * 180) / Math.PI) as Degree;
export const daysToSecondsTyped = (days: Day): Second => (days * DAY_S) as Second;
export const secondsToDaysTyped = (sec: Second): Day => (sec / DAY_S) as Day;
