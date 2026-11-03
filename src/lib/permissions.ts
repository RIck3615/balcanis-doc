import type { AppRole, Dossier, Profile } from "./types";
import { hasRole } from "./auth-shared";

// Miroir de public._actor_can (la base de données reste l'arbitre final)
export function actorCan(profile: Profile, d: Dossier, roles: AppRole[]): boolean {
  const me = profile.id;
  return (
    (roles.includes("CHF") && hasRole(profile, "CHF")) ||
    (roles.includes("ADM") && hasRole(profile, "ADM")) ||
    (roles.includes("GBR") && hasRole(profile, "GBR") && d.office_code === profile.office_code) ||
    (roles.includes("COL") && hasRole(profile, "COL") && d.collector_id === me) ||
    (roles.includes("TRT") && hasRole(profile, "TRT") && d.processor_id === me) ||
    (roles.includes("CTL") &&
      hasRole(profile, "CTL") &&
      d.processor_id !== me &&
      (d.controller_id === me || (d.status === 40 && d.controller_id === null)))
  );
}

// Transitions qui se font par une action dédiée, pas par un simple bouton
export function isDedicatedTransition(from: number, to: number): boolean {
  return to === 20 || to === 40 || to === 80 || (from === 50 && (to === 55 || to === 60));
}
