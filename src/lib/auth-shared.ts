import type { AppRole, Profile } from "./types";

export function hasRole(profile: Profile, ...roles: AppRole[]): boolean {
  return profile.active && profile.roles.some((r) => roles.includes(r));
}
