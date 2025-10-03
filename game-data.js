// This file defines all static game data, including character classes, cards (items, spells, monsters, etc.),
// NPC dialogue, skill challenges, and other game constants. It is used exclusively by the server (`server.js`) to populate
// the game world and manage game mechanics. It is not sent to the client.

// --- INDEX ---
// 1. CLASSES
// 2. STATUS EFFECT DEFINITIONS
// 3. ACTION COSTS
// 4. SKILL CHALLENGES
// 5. NPC DIALOGUE
// 6. MAGICAL AFFIXES (for item generation)
// 7. CARD DATA
//    - 7.1. Item Cards
//    - 7.2. Spell Cards
//    - 7.3. Weapon Cards
//    - 7.4. Armor Cards
//    - 7.5. World Event Cards
//    - 7.6. Player Event Cards
//    - 7.7. Party Event Cards
// 8. MONSTER DATA
//    - 8.1. All Monsters List
//    - 8.2. Monster Tiers (for spawning)
// 9. MODULE EXPORTS

// --- 1. CLASSES ---
const classes = {
    Barbarian: { baseHp: 24, baseDamageBonus: 4, baseShieldBonus: 0, baseAP: 3, healthDice: 4, stats: { str: 4, dex: 1, con: 3, int: 0, wis: 0, cha: 1 }, ability: { name: 'Unchecked Assault', apCost: 1, description: 'Gain +6 damage to your next successful weapon attack this turn.' }, startingDeck: { 'Combustion Flask': 2 } },
    Cleric:    { baseHp: 20, baseDamageBonus: 1, baseShieldBonus: 3, baseAP: 2, healthDice: 3, stats: { str: 1, dex: 0, con: 2, int: 1, wis: 4, cha: 2 }, ability: { name: 'Divine Aid', apCost: 1, description: 'Gain a +1d4 bonus to your next d20 roll (attack or challenge) this turn.' }, startingDeck: { 'Healing Word': 1, 'Guiding Bolt': 1, 'Purifying Flask': 1 } },
    Mage:      { baseHp: 18, baseDamageBonus: 1, baseShieldBonus: 2, baseAP: 2, healthDice: 2, stats: { str: 0, dex: 1, con: 1, int: 4, wis: 2, cha: 1 }, ability: { name: 'Mystic Recall', apCost: 1, description: 'Draw one card from the Spell deck.' }, startingDeck: { 'Magic Missile': 1, 'Fire Bolt': 1, 'Everbright Stick': 1 } },
    Ranger:    { baseHp: 20, baseDamageBonus: 2, baseShieldBonus: 2, baseAP: 2, healthDice: 3, stats: { str: 1, dex: 4, con: 2, int: 1, wis: 3, cha: 0 }, ability: { name: 'Hunters Mark', apCost: 1, description: 'Mark a monster. All attacks against it deal +2 damage for one round.' }, startingDeck: { 'Antidote': 1, 'Sturdy Cord (50 ft)': 1, 'Combustion Flask': 1 } },
    Rogue:     { baseHp: 18, baseDamageBonus: 3, baseShieldBonus: 1, baseAP: 3, healthDice: 2, stats: { str: 1, dex: 4, con: 1, int: 2, wis: 0, cha: 3 }, ability: { name: 'Evasion', apCost: 2, description: 'For one round, all attacks against you have disadvantage (DM rerolls hits).' }, startingDeck: { 'Combustion Flask': 2, 'Lockpicks & Shims': 1 } },
    Warrior:   { baseHp: 22, baseDamageBonus: 2, baseShieldBonus: 4, baseAP: 3, healthDice: 4, stats: { str: 3, dex: 2, con: 4, int: 0, wis: 1, cha: 1 }, ability: { name: 'Weapon Surge', apCost: 1, description: 'Gain +4 damage to your next successful weapon attack this turn.' }, startingDeck: { 'Purifying Flask': 1, 'Antidote': 1 } },
};

// --- 2. STATUS EFFECT DEFINITIONS ---
const statusEffectDefinitions = {
    'Poisoned': { trigger: 'start', damage: '1d4', description: 'Takes 1d4 damage at the start of their turn.' },
    'Stunned': { cannotAct: true, description: 'Cannot take actions.' },
    'On Fire': { trigger: 'start', damage: '1d6', description: 'Takes 1d6 damage at the start of their turn.'},
};

// --- 3. ACTION COSTS ---
const actionCosts = {
    briefRespite: 1,
    fullRest: 2,
    guard: 1
};

// --- 4. SKILL CHALLENGES ---
const skillChallenges = [
    { id: 'sc-01', name: 'Disarm Trapped Chest', description: 'You find a heavy, iron-bound chest. The lock looks complex, and you hear a faint clicking from within.', skill: 'dex', dc: 14 },
    { id: 'sc-02', name: 'Climb a Treacherous Cliff', description: 'A steep cliff face blocks your path. The rock is slick with moss and rain.', skill: 'str', dc: 15 },
];

// --- 5. NPC DIALOGUE ---
const npcDialogue = {
    dm: {
        playMonster: [
            "From the shadows, a grotesque creature emerges!", "You are not alone. Something scuttles toward you...", "A roar echoes through the chamber as a beast reveals itself!", "The air grows cold as a monster appears before you.", "Disturbing the dust, a creature of nightmare lurches into view.",
        ],
    }
};

// --- 6. MAGICAL AFFIXES (for item generation) ---
const magicalAffixes = [
    // Tier 1 (Uncommon)
    { name: 'Hardened', tier: 1, bonuses: { shieldBonus: 1 }, types: ['armor'] },
    { name: 'Vicious', tier: 1, bonuses: { damageBonus: 1 }, types: ['weapon'] },
    { name: 'Agile', tier: 1, bonuses: { dex: 1 }, types: ['weapon', 'armor'] },
    { name: 'Sturdy', tier: 1, bonuses: { con: 1 }, types: ['armor'] },
    { name: 'of Fortitude', tier: 1, bonuses: { maxHp: 5 }, types: ['armor'] },
    { name: 'of Striking', tier: 1, bonuses: { str: 1 }, types: ['weapon'] },
    
    // Tier 2 (Rare)
    { name: 'Reinforced', tier: 2, bonuses: { shieldBonus: 2 }, types: ['armor'] },
    { name: 'Savage', tier: 2, bonuses: { damageBonus: 2 }, types: ['weapon'] },
    { name: 'Swift', tier: 2, bonuses: { ap: 1 }, types: ['weapon', 'armor'] },
    { name: 'of Vigor', tier: 2, bonuses: { maxHp: 10, con: 1 }, types: ['armor'] },
    { name: 'of Ruin', tier: 2, bonuses: { damageBonus: 1, str: 1 }, types: ['weapon'] },

    // Tier 3 (Legendary)
    { name: 'Adamant', tier: 3, bonuses: { shieldBonus: 3, con: 1 }, types: ['armor'] },
    { name: 'Bloodthirsty', tier: 3, bonuses: { damageBonus: 3 }, types: ['weapon'] },
    { name: 'of the Titan', tier: 3, bonuses: { maxHp: 15, str: 1, con: 1 }, types: ['armor'] },
    { name: 'of Annihilation', tier: 3, bonuses: { damageBonus: 2, str: 2 }, types: ['weapon'] },
];


// --- 7. CARD DATA ---

// --- 7.1. Item Cards ---
const itemCards = [
    { name: "Purifying Flask", type: "Consumable", category: "Damage", apCost: 1, effect: { type: "damage", dice: "2d6", target: "any-monster", description: "Ranged attack (20/60). Deals 2d6 radiant damage to Undead or Fiends." } },
    { name: "Everbright Stick", type: "Consumable", category: "Utility", apCost: 1, effect: { type: "utility", description: "Emits bright light in a 20 ft radius for 2 turns." } },
    { name: "Combustion Flask", type: "Consumable", category: "Damage", apCost: 1, effect: { type: "damage", dice: "1d4", status: "On Fire", duration: 2, target: "any-monster", description: "Ranged attack (20/60). On hit, target takes 1d4 fire damage." } },
    { name: "Antidote", type: "Consumable", category: "Utility", apCost: 1, effect: { type: "utility", status: "Cure Poison", target: "any-player", description: "Cures one creature of the Poisoned status effect." } },
    { name: "Sturdy Cord (50 ft)", type: "General", category: "Utility", effect: { type: "utility", description: "A sturdy, 50-foot coil of hempen rope." } },
    { name: "Lockpicks & Shims", type: "General", category: "Utility", effect: { type: "utility", description: "A set of tools for disabling traps and opening locks." } },
];

// --- 7.2. Spell Cards ---
const spellCards = [
    { name: "Healing Word", type: "Spell", category: "Healing", apCost: 1, class: ["Cleric", "Any"], effect: { type: "heal", dice: "1d8", target: "any-player", description: "Heal an ally you can see for 1d8 HP." } },
    { name: "Guiding Bolt", type: "Spell", category: "Damage", apCost: 1, class: ["Cleric", "Mage"], effect: { type: "damage", dice: "2d6", target: "any-monster", description: "Ranged spell attack. Deals 2d6 radiant damage." } },
    { name: "Magic Missile", type: "Spell", category: "Damage", apCost: 1, class: ["Mage", "Any"], effect: { type: "damage", dice: "2d4", target: "any-monster", description: "Automatically hits, dealing 2d4+1 force damage." } },
    { name: "Shield of Faith", type: "Spell", category: "Buff", apCost: 1, class: ["Cleric"], effect: { type: "buff", bonuses: { shieldBonus: 2 }, duration: 2, target: "any-player", description: "Grant an ally +2 Shield Bonus for 2 turns." } },
    { name: "Fire Bolt", type: "Spell", category: "Damage", apCost: 1, class: ["Mage"], effect: { type: "damage", dice: "2d10", target: "any-monster", description: "Ranged spell attack. Deals 2d10 fire damage." } },
];

// --- 7.3. Weapon Cards ---
const weaponCards = [
    { name: "Longsword", type: "Weapon", apCost: 2, class: ["Warrior", "Barbarian", "Any"], effect: { dice: "1d8", description: "A versatile and reliable martial weapon." } },
    { name: "Greataxe", type: "Weapon", apCost: 2, class: ["Barbarian", "Warrior"], effect: { dice: "1d12", description: "A heavy, two-handed axe." } },
    { name: "Shortbow", type: "Weapon", apCost: 2, class: ["Ranger", "Rogue", "Any"], effect: { dice: "1d6", description: "A light and fast ranged weapon." } },
    { name: "Dagger", type: "Weapon", apCost: 1, class: ["Rogue", "Mage", "Any"], effect: { dice: "1d4", description: "A light, concealable blade." } },
    { name: "Mace", type: "Weapon", apCost: 2, class: ["Cleric", "Warrior"], effect: { dice: "1d6", description: "A simple but effective bludgeoning weapon." } },
    { name: "Greatsword", type: "Weapon", apCost: 2, class: ["Warrior", "Barbarian"], effect: { dice: "2d6", description: "A massive sword." } }
];

// --- 7.4. Armor Cards ---
const armorCards = [
    { name: "Leather Armor", type: "Armor", class: ["Rogue", "Ranger", "Any"], effect: { bonuses: { shieldBonus: 1 }, description: "Light and flexible." } },
    { name: "Chain Mail", type: "Armor", class: ["Warrior", "Cleric", "Barbarian"], effect: { bonuses: { shieldBonus: 3 }, description: "Offers substantial protection but is cumbersome." } },
    { name: "Plate Armor", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 4 }, description: "The heaviest armor, providing the best protection." } },
    { name: "Studded Leather", type: "Armor", class: ["Rogue", "Ranger"], effect: { bonuses: { shieldBonus: 2 }, description: "Reinforced with rivets." } },
    { name: "Scale Mail", type: "Armor", class: ["Cleric", "Warrior"], effect: { bonuses: { shieldBonus: 2 }, description: "A coat and leggings of leather covered with overlapping pieces of metal." } }
];

// --- 7.5. World Event Cards ---
const worldEventCards = [
    { name: "Echoes of the Past", type: "World Event", eventType: "skill_challenge", description: "A wave of psychic energy washes over the area. The active player must attempt to resist its effects.", skill: "wis", dc: 13, duration: 1 },
    { name: "Sudden Downpour", type: "World Event", eventType: "environmental", description: "A torrential rain begins, extinguishing all non-magical flames. Ranged weapon attacks are made with disadvantage.", duration: 2 },
    { name: "Whispers in the Dark", type: "World Event", eventType: "skill_challenge", description: "Malevolent whispers claw at your mind. The active player must make a challenge to steel their will.", skill: "cha", dc: 12, duration: 1 },
];

// --- 7.6. Player Event Cards ---
const playerEventCards = [
    { name: "Sudden Insight", type: "Player Event", outcome: "You have a moment of brilliant clarity.", effect: { type: "stat_modifier", bonuses: { int: 2 }, duration: 2 } },
    { name: "Surge of Adrenaline", type: "Player Event", outcome: "Your heart pounds as you feel a rush of strength.", effect: { type: "stat_modifier", bonuses: { str: 2 }, duration: 2 } },
];

// --- 7.7. Party Event Cards ---
const partyEventCards = [
    { name: "Rallying Cry", type: "Party Event", outcome: "A moment of shared courage inspires the party.", effect: { type: "heal", dice: "1d4", target: "party" } },
    { name: "Favorable Winds", type: "Party Event", outcome: "A sudden gust of wind seems to aid your movements.", effect: { type: "stat_change", stat: "currentAp", value: 1, target: "party" } },
];

// --- 8. MONSTER DATA ---
// NOTE: Monster HP has been drastically re-tuned from prototype values to align with
// standard tabletop RPG conventions. This ensures combat is faster and more engaging.
const allMonsters = {
    goblin: { name: "Goblin", type: "Monster", maxHp: 7, attackBonus: 4, requiredRollToHit: 13, effect: { dice: "1d6" }, ap: 1 },
    giantRat: { name: "Giant Rat", type: "Monster", maxHp: 5, attackBonus: 3, requiredRollToHit: 12, effect: { dice: "1d4" }, ap: 1 },
    skeleton: { name: "Skeleton", type: "Monster", maxHp: 13, attackBonus: 4, requiredRollToHit: 13, effect: { dice: "1d6" }, ap: 1 },
    orc: { name: "Orc", type: "Monster", maxHp: 15, attackBonus: 5, requiredRollToHit: 13, effect: { dice: "1d12" }, ap: 2 },
    hobgoblin: { name: "Hobgoblin", type: "Monster", maxHp: 11, attackBonus: 3, requiredRollToHit: 18, effect: { dice: "1d8" }, ap: 2 },
    bugbear: { name: "Bugbear", type: "Monster", maxHp: 27, attackBonus: 4, requiredRollToHit: 16, effect: { dice: "2d8" }, ap: 1 },
    troll: { name: "Troll", type: "Monster", maxHp: 84, attackBonus: 7, requiredRollToHit: 15, effect: { dice: "2d6" }, ap: 3 },
    ogre: { name: "Ogre", type: "Monster", maxHp: 59, attackBonus: 6, requiredRollToHit: 11, effect: { dice: "2d8" }, ap: 2 },
};

const monsterTiers = {
    tier1: [allMonsters.goblin, allMonsters.giantRat, allMonsters.skeleton],
    tier2: [allMonsters.orc, allMonsters.hobgoblin, allMonsters.bugbear],
    tier3: [allMonsters.troll, allMonsters.ogre]
};

// --- 9. MODULE EXPORTS ---
module.exports = {
    classes,
    itemCards,
    spellCards,
    weaponCards,
    armorCards,
    worldEventCards,
    partyEventCards,
    monsterTiers,
    npcDialogue,
    skillChallenges,
    magicalAffixes,
    actionCosts
};