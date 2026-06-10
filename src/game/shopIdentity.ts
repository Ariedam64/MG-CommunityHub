// src/game/shopIdentity.ts
// Minimal extract of Arie's Mod ShopsService — only the catalog-based item
// identity resolution used by the chat importer ({{gem:item|...}} tokens).

import { plantCatalog, toolCatalog, eggCatalog, decorCatalog } from "@/data";

export type Kind = "seeds" | "tools" | "eggs" | "decor";

export type AnyItem = {
  id?: string;
  species?: string;
  toolId?: string;
  eggId?: string;
  decorId?: string;
  name?: string;
  [key: string]: unknown;
};

export const ShopsService = {
  /** Nom logique d'un item (clé stable côté inventaire). */
  identityFor(kind: Kind, it: AnyItem): string {
    // 1) si le name est déjà présent → on le prend
    if (typeof it?.name === "string" && it.name.trim()) return it.name.trim();

    // 2) sélectionne le bon catalogue + clé à utiliser
    const catalogs: Record<Kind, any> = {
      seeds: plantCatalog,
      tools: toolCatalog,
      eggs:  eggCatalog,
      decor: decorCatalog,
    };
    const keys: Record<Kind, string[]> = {
      seeds: [String(it.species ?? it.id ?? "")],
      tools: [String(it.toolId  ?? it.id ?? "")],
      eggs:  [String(it.eggId   ?? it.id ?? "")],
      decor: [String(it.decorId ?? it.id ?? "")],
    };

    const cat = catalogs[kind];
    for (const k of keys[kind]) {
      if (!k) continue;
      const entry = (cat as any)[k];
      if (!entry) continue;

      // seeds: nom dans entry.seed.name, sinon entry.name
      if (kind === "seeds" && entry.seed?.name) return entry.seed.name;
      if (entry.name) return entry.name;
    }

    // 3) fallback : identifiant brut
    return String(it.species ?? it.toolId ?? it.eggId ?? it.decorId ?? it.id ?? "?");
  },
};
