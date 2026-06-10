// src/game/petAbilities.ts
// Minimal extract of Arie's Mod PetsService + pets menu helpers — only the
// ability-name resolution and ability chip colors used by the chat importer.

import { petAbilities } from "@/data";

/** Pet team shape persisted by Arie's Mod (read via readAriesPath("pets.teams")). */
export type PetTeam = {
  id: string;
  name: string;
  slots: (string | null)[];
};

type AbilityDef = {
  name?: string;
  description?: string;
  trigger?: string;
  baseProbability?: number;
  baseParameters?: any;
};

const _AB: Record<string, AbilityDef> = (petAbilities as any) ?? {};

function _abilityName(id: unknown): string {
  const key = String(id ?? "");
  const raw = (typeof _AB?.[key]?.name === "string" && _AB[key]!.name!.trim())
    ? _AB[key]!.name!
    : key;
  return String(raw);
}

function _abilityNameWithoutLevel(id: unknown): string {
  const key = String(id ?? "");
  const raw = (typeof _AB?.[key]?.name === "string" && _AB[key]!.name!.trim())
    ? _AB[key]!.name!
    : key;
  return String(raw).replace(/(?:\s+|-)?(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\s*$/, "").trim();
}

export const PetsService = {
  getAbilityName(id: string): string { return _abilityName(id); },
  getAbilityNameWithoutLevel(id: string): string { return _abilityNameWithoutLevel(id); },
};

// Ability → { bg, hover } — couleurs servies par l'API en priorité
export function getAbilityChipColors(id: string): { bg: string; hover: string } {
  const key = String(id || "");

  // The abilities catalog is enriched at runtime with the exact chip colors
  // parsed from the game bundle (data/dynamic/logic/abilityColors.ts). The
  // hardcoded mapping below is only a fallback until enrichment completes.
  const apiColor = (petAbilities as Record<string, any>)?.[key]?.color;
  if (apiColor && typeof apiColor.bg === "string" && apiColor.bg) {
    const hover = typeof apiColor.hover === "string" && apiColor.hover ? apiColor.hover : apiColor.bg;
    return { bg: apiColor.bg, hover };
  }

  const base = _abilityNameWithoutLevel(key)
    .replace(/[\s\-_]+/g, "")
    .toLowerCase();

  const is = (prefix: string) =>
    key.startsWith(prefix) || base === prefix.toLowerCase();

  // Celestials / événements spéciaux
  if (is("MoonKisser")) {
    return { bg: "rgba(250,166,35,0.9)", hover: "rgba(250,166,35,1)" };
  }

  if (is("DawnKisser")) {
    return { bg: "rgba(162,92,242,0.9)", hover: "rgba(162,92,242,1)" };
  }

  // Boosts de production / croissance / œufs / âge / taille / XP
  if (is("ProduceScaleBoost") || is("SnowyCropSizeBoost")) {
    return { bg: "rgba(34,139,34,0.9)", hover: "rgba(34,139,34,1)" };
  }

  if (is("PlantGrowthBoost") || is("SnowyPlantGrowthBoost") || is("DawnPlantGrowthBoost") || is("AmberPlantGrowthBoost")) {
    return { bg: "rgba(0,128,128,0.9)", hover: "rgba(0,128,128,1)" };
  }

  if (is("EggGrowthBoost") || is("SnowyEggGrowthBoost")) {
    return { bg: "rgba(180,90,240,0.9)", hover: "rgba(180,90,240,1)" };
  }

  if (is("PetAgeBoost")) {
    return { bg: "rgba(147,112,219,0.9)", hover: "rgba(147,112,219,1)" };
  }

  if (is("PetHatchSizeBoost")) {
    return { bg: "rgba(128,0,128,0.9)", hover: "rgba(128,0,128,1)" };
  }

  if (is("PetXpBoost") || is("SnowyPetXpBoost")) {
    return { bg: "rgba(30,144,255,0.9)", hover: "rgba(30,144,255,1)" };
  }

  // Faim / regen faim
  if (is("HungerBoost") || is("SnowyHungerBoost")) {
    return { bg: "rgba(255,20,147,0.9)", hover: "rgba(255,20,147,1)" };
  }

  if (is("HungerRestore") || is("SnowyHungerRestore")) {
    return { bg: "rgba(255,105,180,0.9)", hover: "rgba(255,105,180,1)" };
  }

  // Sell Boost (toutes les versions)
  if (is("SellBoost")) {
    return { bg: "rgba(220,20,60,0.9)", hover: "rgba(220,20,60,1)" };
  }

  // Coin Finder (I, II, III + Snowy)
  if (is("CoinFinder") || is("SnowyCoinFinder")) {
    return { bg: "rgba(180,150,0,0.9)", hover: "rgba(180,150,0,1)" };
  }

  // Seed Finder (I à IV) → même couleur pour toutes les versions
  if (is("SeedFinder")) {
    return { bg: "rgba(168,102,38,0.9)", hover: "rgba(168,102,38,1)" };
  }

  // Mutation / mutation pets
  if (is("ProduceMutationBoost") || is("SnowyCropMutationBoost") || is("DawnBoost") || is("AmberMoonBoost")) {
    return { bg: "rgba(140,15,70,0.9)", hover: "rgba(140,15,70,1)" };
  }

  if (is("PetMutationBoost")) {
    return { bg: "rgba(160,50,100,0.9)", hover: "rgba(160,50,100,1)" };
  }

  // Double récolte / double hatch
  if (is("DoubleHarvest")) {
    return { bg: "rgba(0,120,180,0.9)", hover: "rgba(0,120,180,1)" };
  }

  if (is("DoubleHatch")) {
    return { bg: "rgba(60,90,180,0.9)", hover: "rgba(60,90,180,1)" };
  }

  // Abilities liées aux crops / ventes / refund
  if (is("ProduceEater")) {
    return { bg: "rgba(255,69,0,0.9)", hover: "rgba(255,69,0,1)" };
  }

  if (is("ProduceRefund")) {
    return { bg: "rgba(255,99,71,0.9)", hover: "rgba(255,99,71,1)" };
  }

  // Pet refund
  if (is("PetRefund")) {
    return { bg: "rgba(0,80,120,0.9)", hover: "rgba(0,80,120,1)" };
  }

  // Copycat
  if (is("Copycat")) {
    return { bg: "rgba(255,140,0,0.9)", hover: "rgba(255,140,0,1)" };
  }

  // Gold granter (gradient)
  if (is("GoldGranter")) {
    return {
      bg: "linear-gradient(135deg, rgba(225,200,55,0.9) 0%, rgba(225,180,10,0.9) 40%, rgba(215,185,45,0.9) 70%, rgba(210,185,45,0.9) 100%)",
      hover:
        "linear-gradient(135deg, rgba(220,200,70,1) 0%, rgba(210,175,5,1) 40%, rgba(210,185,55,1) 70%, rgba(200,175,30,1) 100%)",
    };
  }

  // Rainbow granter (gradient)
  if (is("RainbowGranter")) {
    return {
      bg: "linear-gradient(45deg, rgba(200,0,0,0.9), rgba(200,120,0,0.9), rgba(160,170,30,0.9), rgba(60,170,60,0.9), rgba(50,170,170,0.9), rgba(40,150,180,0.9), rgba(20,90,180,0.9), rgba(70,30,150,0.9))",
      hover:
        "linear-gradient(45deg, rgba(200,0,0,1), rgba(200,120,0,1), rgba(160,170,30,1), rgba(60,170,60,1), rgba(50,170,170,1), rgba(40,150,180,1), rgba(20,90,180,1), rgba(70,30,150,1))",
    };
  }

  // Rain Dance
  if (is("RainDance")) {
    return { bg: "rgba(76,204,204,0.9)", hover: "rgba(76,204,204,1)" };
  }

  // Cold mutations granters
  if (is("SnowGranter")) {
    return { bg: "rgba(144,184,204,0.9)", hover: "rgba(144,184,204,1)" };
  }

  if (is("FrostGranter")) {
    return { bg: "rgba(148,160,204,0.9)", hover: "rgba(148,160,204,1)" };
  }

  if (is("DawnlitGranter")) {
    return { bg: "rgba(196,124,180,0.9)", hover: "rgba(196,124,180,1)" };
  }

  if (is("AmberlitGranter")) {
    return { bg: "rgba(204,144,96,0.9)", hover: "rgba(204,144,96,1)" };
  }

  // Couleur neutre par défaut (même que le jeu)
  return {
    bg: "rgba(100,100,100,0.9)",
    hover: "rgba(150,150,150,1)",
  };
}
