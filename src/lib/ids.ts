// Identifiants reçus dans l'URL : refusés s'ils ne sont pas des UUID (pas de filtre injecté)
export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
