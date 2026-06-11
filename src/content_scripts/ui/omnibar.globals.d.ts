// `Normal` is referenced by a couple of omnibar mappings but is never defined as
// a runtime value (only a type alias exists, in content.ts). It is declared here
// with just the surface those mappings call so those paths keep their original
// throwing runtime behavior while type-checking.
declare const Normal: { addVIMark(mark: string, url?: string): void };
