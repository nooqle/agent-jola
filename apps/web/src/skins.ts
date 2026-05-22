export interface AgentSkin {
  id: string;
  edition: number;
  label: string;
  src: string;
  traits: AgentSkinTrait[];
}

export interface AgentSkinTrait {
  type: string;
  value: string;
}

type LegacyAccessory = "none" | "cap" | "visor" | "scarf" | "crown" | "antenna";

const SOCIAL_CHAMELEON_SKIN_DATA = [
  {
    edition: 1,
    traits: [
      ["Background", "Sky"],
      ["GoldenBody", "Cool"],
      ["Top", "Hobbit"],
      ["Eye", "Universe"],
      ["Mouth", "Mustache"],
      ["Neck", "Lucky"],
      ["Implement", "Balloon"],
    ],
  },
  {
    edition: 4,
    traits: [
      ["ClearBackground", "Red"],
      ["GoldenBody", "Xi"],
      ["Mutated Mouth", "Line"],
      ["Legend Top", "Arabic"],
      ["Eye", "Mud"],
    ],
  },
  {
    edition: 8,
    traits: [
      ["Background", "Drawing"],
      ["Body", "Darren"],
      ["Mouth", "Red"],
      ["Legend Outfit", "Snowman"],
      ["Eye", "RedBull"],
    ],
  },
  {
    edition: 12,
    traits: [
      ["Background", "Night"],
      ["GoldenBody", "Artist"],
      ["Top", "Hobbit"],
      ["Eye", "Universe"],
      ["Mouth", "Red"],
      ["Neck", "Lucky"],
      ["Implement", "Balloon"],
    ],
  },
  {
    edition: 17,
    traits: [
      ["Background", "Night"],
      ["Body", "Baby Pink"],
      ["Eye", "Universe"],
      ["Mouth", "Red"],
      ["Special", "Astronaut"],
    ],
  },
  {
    edition: 23,
    traits: [
      ["Background", "Diamond_Green"],
      ["Body", "Christine"],
      ["Eye", "Darkness"],
      ["Mouth", "Red"],
      ["Special", "Breath"],
    ],
  },
  {
    edition: 37,
    traits: [
      ["Background", "Pink"],
      ["Body", "Aqua"],
      ["Eye", "RedBull"],
      ["Mouth", "Red"],
      ["Special", "Astronaut"],
    ],
  },
  {
    edition: 42,
    traits: [
      ["Background", "Twilight"],
      ["Body", "Grass"],
      ["Eye", "Universe"],
      ["Mouth", "Red"],
      ["Special", "Astronaut"],
    ],
  },
  {
    edition: 58,
    traits: [
      ["ClearBackground", "Baby Pink"],
      ["Body", "Darren"],
      ["Eye", "Halo"],
      ["Mutated Mouth", "Huge"],
      ["Outfit", "LA"],
    ],
  },
  {
    edition: 73,
    traits: [
      ["Background", "Twill"],
      ["GoldenBody", "Pharaohs"],
      ["Top", "Hair"],
      ["Eye", "RedBull"],
      ["Mouth", "Red"],
      ["Neck", "Lucky"],
      ["Implement", "Diving"],
    ],
  },
  {
    edition: 88,
    traits: [
      ["Background", "Diamond_Green"],
      ["Body", "Justin"],
      ["Eye", "Universe"],
      ["Mouth", "Red"],
      ["Special", "Breath"],
    ],
  },
  {
    edition: 101,
    traits: [
      ["Background", "Wall"],
      ["Body", "Orange"],
      ["Eye", "Universe"],
      ["Mouth", "Red"],
      ["Special", "Rainbow Pack"],
    ],
  },
  {
    edition: 128,
    traits: [
      ["ClearBackground", "Morning"],
      ["Body", "Christine"],
      ["Eye", "Universe"],
      ["Mutated Mouth", "Hole"],
      ["Outfit", "Artist"],
    ],
  },
  {
    edition: 144,
    traits: [
      ["Background", "Festival"],
      ["Body", "Dirt"],
      ["Eye", "Bizarre"],
      ["Mouth", "Mustache"],
      ["Special", "Rainbow Pack"],
    ],
  },
  {
    edition: 169,
    traits: [
      ["Background", "Laser"],
      ["GoldenBody", "Snow"],
      ["Top", "Dope"],
      ["Eye", "Speechless"],
      ["Mouth", "Red"],
      ["Neck", "Rainbow"],
      ["Implement", "Pizza"],
    ],
  },
  {
    edition: 196,
    traits: [
      ["Background", "Flower"],
      ["Body", "IceIce"],
      ["Eye", "RedBull"],
      ["Mouth", "Red"],
      ["Special", "Rainbow Pack"],
    ],
  },
  {
    edition: 233,
    traits: [
      ["Background", "Royal Blue"],
      ["Body", "Eva"],
      ["Mouth", "Red"],
      ["Legend Outfit", "Snowman"],
      ["Eye", "RedBull"],
    ],
  },
  {
    edition: 277,
    traits: [
      ["ClearBackground", "Orange"],
      ["GoldenBody", "Puppet"],
      ["Mutated Mouth", "Jolie"],
      ["Legend Top", "Tribe"],
      ["Eye", "RedBull"],
    ],
  },
  {
    edition: 314,
    traits: [
      ["ClearBackground", "Moon"],
      ["GoldenBody", "Cool"],
      ["Mutated Mouth", "Hole"],
      ["Legend Top", "Pharaohs"],
      ["Eye", "Universe"],
    ],
  },
  {
    edition: 377,
    traits: [
      ["Background", "Graffiti_Red"],
      ["Body", "Justin"],
      ["Eye", "RedBull"],
      ["Mouth", "Red"],
      ["Special", "Breath"],
    ],
  },
  {
    edition: 512,
    traits: [
      ["Background", "Laser"],
      ["GoldenBody", "Moon"],
      ["Top", "Dreadlocks"],
      ["Eye", "Universe"],
      ["Mouth", "Red"],
      ["Neck", "Savage"],
      ["Implement", "Pizza"],
    ],
  },
  {
    edition: 777,
    traits: [
      ["Background", "Night"],
      ["GoldenBody", "Moon"],
      ["Top", "Dope"],
      ["Eye", "RedBull"],
      ["Mouth", "Red"],
      ["Neck", "Conan"],
      ["Implement", "Hula"],
    ],
  },
  {
    edition: 1024,
    traits: [
      ["Background", "Royal Blue"],
      ["GoldenBody", "Solomon"],
      ["Top", "Helmet"],
      ["Eye", "Alien"],
      ["Mouth", "Red"],
      ["Neck", "Emerald"],
      ["Implement", "Pipe"],
    ],
  },
  {
    edition: 1337,
    traits: [
      ["Background", "Twill"],
      ["GoldenBody", "Pharaohs"],
      ["Top", "Peaked cap"],
      ["Eye", "Universe"],
      ["Mouth", "Red"],
      ["Neck", "Lucky"],
      ["Implement", "Pizza"],
    ],
  },
] as const;

export const AGENT_SKINS: AgentSkin[] = SOCIAL_CHAMELEON_SKIN_DATA.map(({ edition, traits }) => ({
  id: `chameleon-${edition}`,
  edition,
  label: `#${edition}`,
  src: `/skins/social-chameleon/${edition}.png`,
  traits: traits.map(([type, value]) => ({ type, value })),
}));

export const DEFAULT_AGENT_SKIN_ID = AGENT_SKINS[0]?.id ?? "chameleon-1";

export function getAgentSkin(skinId: string | undefined): AgentSkin {
  return AGENT_SKINS.find((skin) => skin.id === skinId) ?? (AGENT_SKINS[0] as AgentSkin);
}

export function agentSkinByIndex(index: number): AgentSkin {
  return AGENT_SKINS[Math.abs(index) % AGENT_SKINS.length] ?? getAgentSkin(DEFAULT_AGENT_SKIN_ID);
}

export function normalizeAgentSkinId(skinId: string | undefined, fallbackIndex = 0): string {
  if (skinId && AGENT_SKINS.some((skin) => skin.id === skinId)) {
    return skinId;
  }
  return agentSkinByIndex(fallbackIndex).id;
}

export function getSkinSignature(skin: AgentSkin): string {
  const signature = [
    getTraitValue(skin, ["Special", "Legend Outfit", "Outfit", "Legend Top", "Top"]),
    getTraitValue(skin, ["Eye"]),
    getTraitValue(skin, ["Implement", "Neck"]),
  ].filter(Boolean);
  return signature.join(" / ") || skin.label;
}

export function getSkinFeatureTraits(skin: AgentSkin): AgentSkinTrait[] {
  const priority = ["Special", "Legend Outfit", "Outfit", "Legend Top", "Top", "Eye", "Mouth", "Mutated Mouth", "Neck", "Implement"];
  return priority
    .map((type) => skin.traits.find((trait) => trait.type === type))
    .filter((trait): trait is AgentSkinTrait => Boolean(trait));
}

export function legacyAccessoryFromSkin(skinId: string | undefined): LegacyAccessory {
  const skin = getAgentSkin(skinId);
  const traitText = skin.traits.map((trait) => `${trait.type} ${trait.value}`.toLowerCase()).join(" ");
  if (traitText.includes("helmet") || traitText.includes("cap") || traitText.includes("top")) return "cap";
  if (traitText.includes("eye") || traitText.includes("alien") || traitText.includes("universe")) return "visor";
  if (traitText.includes("neck") || traitText.includes("conan") || traitText.includes("rainbow")) return "scarf";
  if (traitText.includes("legend") || traitText.includes("pharaohs") || traitText.includes("solomon")) return "crown";
  if (traitText.includes("astronaut") || traitText.includes("halo")) return "antenna";
  return "none";
}

function getTraitValue(skin: AgentSkin, types: string[]): string | undefined {
  return types.map((type) => skin.traits.find((trait) => trait.type === type)?.value).find(Boolean);
}
