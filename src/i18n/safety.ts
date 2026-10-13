// Module-level registration avoids modifying inspection business logic.
export type LanguageSafety = { dirty: () => boolean; busy: () => boolean };
const guards = new Map<string, LanguageSafety>();
export function registerLanguageSafety(id: string, guard: LanguageSafety): () => void {
  guards.set(id, guard);
  return () => { if (guards.get(id) === guard) guards.delete(id); };
}
export function languageSafety() {
  return { dirty: [...guards.values()].some(g => g.dirty()), busy: [...guards.values()].some(g => g.busy()) };
}
