// This file defines all static game data, including character classes, cards (items, spells, monsters, etc.),
// NPC dialogue, skill challenges, and other game constants. It is used exclusively by the server (`server.js`) to populate
// the game world and manage game mechanics. It is not sent to the client.

// --- INDEX ---
// 1. CLASSES
// 2. STATUS EFFECT DEFINITIONS
// 3. ACTION COSTS
// 4. NPC DIALOGUE
// 5. MAGICAL AFFIXES (for item generation)
// 6. CARD DATA
//    - 6.1. Weapon Cards
//    - 6.2. Armor Cards
//    - 6.3. Spell Cards
//    - 6.4. Item Cards (Consumables & Utility)
//    - 6.5. Event Cards (Categorized Decks)
// 7. MONSTER DATA
//    - 7.1. All Monsters List (structured)
//    - 7.2. Monster Tiers (for spawning)
// 8. MODULE EXPORTS

// --- 1. CLASSES ---
const classes = {
    Barbarian: { baseHp: 24, baseDamageBonus: 4, baseShieldBonus: 0, baseAP: 3, healthDice: 4, stats: { str: 4, dex: 1, con: 3, int: 0, wis: 0, cha: 1 }, ability: { name: 'Rage', apCost: 1, description: 'Enter a rage. Gain +4 damage on all attacks this turn.' } },
    Cleric:    { baseHp: 20, baseDamageBonus: 1, baseShieldBonus: 3, baseAP: 2, healthDice: 3, stats: { str: 1, dex: 0, con: 2, int: 1, wis: 4, cha: 2 }, ability: { name: 'Divine Heal', apCost: 1, description: 'Heal yourself for 1d8 + WIS HP.' } },
    Mage:      { baseHp: 18, baseDamageBonus: 1, baseShieldBonus: 2, baseAP: 2, healthDice: 2, stats: { str: 0, dex: 1, con: 1, int: 4, wis: 2, cha: 1 }, ability: { name: 'Arcane Recovery', apCost: 0, description: 'Regain 1 AP. Usable once per turn.' } },
    Ranger:    { baseHp: 20, baseDamageBonus: 2, baseShieldBonus: 2, baseAP: 2, healthDice: 3, stats: { str: 1, dex: 4, con: 2, int: 1, wis: 3, cha: 0 }, ability: { name: 'Hunter\'s Mark', apCost: 1, description: 'Mark a target. Your next attack against it has +5 to hit.' } },
    Rogue:     { baseHp: 18, baseDamageBonus: 3, baseShieldBonus: 1, baseAP: 3, healthDice: 2, stats: { str: 1, dex: 4, con: 1, int: 2, wis: 0, cha: 3 }, ability: { name: 'Sneak Attack', apCost: 1, description: 'Your next attack this turn deals an extra 1d6 damage.' } },
    Warrior:   { baseHp: 22, baseDamageBonus: 2, baseShieldBonus: 4, baseAP: 3, healthDice: 4, stats: { str: 3, dex: 2, con: 4, int: 0, wis: 1, cha: 1 }, ability: { name: 'Power Surge', apCost: 1, description: 'Your next attack has +2 to hit and +2 damage.' } },
};

// --- 2. STATUS EFFECT DEFINITIONS ---
const statusEffectDefinitions = {
    'Poisoned': { trigger: 'start', damage: '1d4', description: 'Takes 1d4 damage at the start of their turn.' },
    'Stunned': { cannotAct: true, description: 'Cannot take actions.' },
    'On Fire': { trigger: 'start', damage: '1d6', description: 'Takes 1d6 damage at the start of their turn.'},
    'Frightened': { cannotAct: true, description: 'Cannot take actions for 1 turn.' },
};

// --- 3. ACTION COSTS ---
const actionCosts = {
    briefRespite: 1,
    fullRest: 2,
    guard: 1
};

// --- 4. NPC DIALOGUE ---
const npcDialogue = {
    dm: {
        playMonster: [
            "From the shadows, a grotesque creature emerges!", "You are not alone. Something scuttles toward you...", "A roar echoes through the chamber as a beast reveals itself!", "The air grows cold as a monster appears before you.", "Disturbing the dust, a creature of nightmare lurches into view.",
        ],
    }
};

// --- 5. MAGICAL AFFIXES (for item generation) ---
const magicalAffixes = [
    // Tier 1 (Uncommon)
    { name: 'Hardened', tier: 1, bonuses: { shieldBonus: 1 }, types: ['armor'] },
    { name: 'Vicious', tier: 1, bonuses: { damageBonus: 1 }, types: ['weapon'] },
    { name: 'Agile', tier: 1, bonuses: { dex: 1 }, types: ['weapon', 'armor'] },
    { name: 'Sturdy', tier: 1, bonuses: { con: 1 }, types: ['armor'] },
    { name: 'of Fortitude', tier: 1, bonuses: { maxHp: 5 }, types: ['armor'] },
    { name: 'of Striking', tier: 1, bonuses: { str: 1 }, types: ['weapon'] },
    { name: 'Insightful', tier: 1, bonuses: { wis: 1 }, types: ['armor'] },
    { name: 'Artful', tier: 1, bonuses: { int: 1 }, types: ['weapon', 'armor'] },

    // Tier 2 (Rare)
    { name: 'Reinforced', tier: 2, bonuses: { shieldBonus: 2 }, types: ['armor'] },
    { name: 'Savage', tier: 2, bonuses: { damageBonus: 2 }, types: ['weapon'] },
    { name: 'Swift', tier: 2, bonuses: { ap: 1 }, types: ['weapon', 'armor'] },
    { name: 'of Vigor', tier: 2, bonuses: { maxHp: 10, con: 1 }, types: ['armor'] },
    { name: 'of Ruin', tier: 2, bonuses: { damageBonus: 1, str: 1 }, types: ['weapon'] },
    { name: 'Eloquent', tier: 2, bonuses: { cha: 2 }, types: ['armor'] },
    { name: 'of the Mind', tier: 2, bonuses: { int: 2, wis: 1 }, types: ['armor'] },

    // Tier 3 (Legendary)
    { name: 'Adamant', tier: 3, bonuses: { shieldBonus: 3, con: 1 }, types: ['armor'] },
    { name: 'Bloodthirsty', tier: 3, bonuses: { damageBonus: 3 }, types: ['weapon'] },
    { name: 'of the Titan', tier: 3, bonuses: { maxHp: 15, str: 1, con: 1 }, types: ['armor'] },
    { name: 'of Annihilation', tier: 3, bonuses: { damageBonus: 2, str: 2 }, types: ['weapon'] },
];

// --- 6. CARD DATA ---

// --- 6.1. Weapon Cards ---
const weaponCards = [
    { name: "Axechuck", type: "Weapon", apCost: 1, class: ["Warrior", "Barbarian", "Ranger"], effect: { dice: "1d6", description: "Thrown (20/60), Special: Returning Edge - Returns to hand at end of turn (If thrown and hand free)." } },
    { name: "Balanced Steel", type: "Weapon", apCost: 2, class: ["Warrior", "Rogue", "Ranger"], effect: { dice: "1d8", description: "Versatile (1d10), Special: Guard Breaker - Ignore 1 point of target's Shield Bonus (Versatile only, 1/turn)." } },
    { name: "Bolt Sprinter", type: "Weapon", apCost: 2, class: ["Rogue", "Ranger"], effect: { dice: "1d8", description: "Ammunition, Loading, Special: Steady Aim - First attack on next turn deals +1d4 damage (If used Brace action this turn)." } },
    { name: "Bone Thumper", type: "Weapon", apCost: 2, class: ["Barbarian", "Warrior", "Cleric"], effect: { dice: "1d6", description: "Special: Solid Strike - Deal an additional 1 damage (When hitting target with Shield Bonus from armor, not shield)." } },
    { name: "Doomcleaver", type: "Weapon", apCost: 2, class: ["Barbarian", "Warrior"], effect: { dice: "2d6", description: "Two-Handed, Heavy, Special: Savage Chop - Make 1 additional melee attack vs same target (Natural 20 on attack roll)." } },
    { name: "Duelist's Point", type: "Weapon", apCost: 1, class: ["Rogue", "Warrior"], effect: { dice: "1d8", description: "Finesse, Special: Opening Flourish - First successful attack deals +1d4 damage (If first creature to attack target in combat)." } },
    { name: "Farstrike Bow", type: "Weapon", apCost: 2, class: ["Ranger", "Warrior"], effect: { dice: "1d8", description: "Ammunition, Heavy, Two-Handed, Special: Piercing Shot - +1 Attack Roll but ignore 1 point of target's Shield Bonus (Ranged, 1/turn)." } },
    { name: "Impact Cleaver", type: "Weapon", apCost: 2, class: ["Barbarian", "Warrior"], effect: { dice: "1d8", description: "Versatile (1d10), Heavy, Special: Momentum Swing - Increase movement speed by 5 ft until end of turn (Versatile hit)." } },
    { name: "Quick Blade", type: "Weapon", apCost: 1, class: ["Rogue", "Ranger"], effect: { dice: "1d6", description: "Finesse, Special: Fluid Motion - Can use Break Away for 0 AP (If make two attacks with this weapon on turn)." } },
    { name: "Shadowtooth", type: "Weapon", apCost: 1, class: ["Rogue"], effect: { dice: "1d4", description: "Finesse, Thrown (20/60), Special: Poison Ready - Advantage on attack roll when applying poison." } },
    { name: "Swiftflight Bow", type: "Weapon", apCost: 2, class: ["Ranger", "Rogue"], effect: { dice: "1d6", description: "Ammunition, Close-Range Penalty (-1d4 damage when attacking Close enemy)" } },
    { name: "Wayfinder's Staff", type: "Weapon", apCost: 2, class: ["Mage", "Cleric", "Ranger"], effect: { dice: "1d6", description: "Versatile (1d8), Special: Deflect - As Reaction, spend 1 AP to gain +2 to Required Roll to Hit vs attacker (Until start of next turn)." } }
];

// --- 6.2. Armor Cards ---
const armorCards = [
    { name: "Arcanist's Weave", type: "Armor", class: ["Warrior", "Mage", "Rogue", "Cleric", "Ranger", "Barbarian"], effect: { bonuses: { shieldBonus: 2, ap: 2 }, description: "+1 to Magic Resistance." } },
    { name: "Bastion Shield", type: "Armor", class: ["Warrior", "Cleric", "Ranger", "Barbarian"], effect: { bonuses: { shieldBonus: 3, ap: -1 }, description: "Provides cover to adjacent allies." } },
    { name: "Crystal Hide", type: "Armor", class: ["Warrior", "Cleric", "Ranger", "Barbarian"], effect: { bonuses: { shieldBonus: 6, ap: 0 }, description: "Resistance to non-magical damage." } },
    { name: "Earth-Forged Mail", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 7, ap: -1 }, description: "Resistance to Bludgeoning damage." } },
    { name: "Fury Cuirass", type: "Armor", class: ["Warrior", "Cleric", "Ranger", "Barbarian"], effect: { bonuses: { shieldBonus: 6, ap: 1 }, description: "While below half health, gain +1 to attack rolls." } },
    { name: "Hide Vest", type: "Armor", class: ["Any"], effect: { bonuses: { shieldBonus: 2, ap: 1 }, description: "Simple but effective protection made from cured animal hide." } },
    { name: "Indomitable Plating", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 10, ap: -2 }, description: "Ignores the first point of damage from any attack." } },
    { name: "Ironclad Harness", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 8, ap: -1 }, description: "Complete coverage in heavy metal, but restricts movement." } },
    { name: "Link Hauberk", type: "Armor", class: ["Warrior", "Cleric", "Ranger", "Barbarian"], effect: { bonuses: { shieldBonus: 4, ap: 0 }, description: "Interlocking rings provide reliable defense." } },
    { name: "Nightfall Shroud", type: "Armor", class: ["Any"], effect: { bonuses: { shieldBonus: 1, ap: 3 }, description: "Advantage on Stealth checks." } },
    { name: "Phase Shroud", type: "Armor", class: ["Warrior", "Cleric", "Ranger", "Barbarian"], effect: { bonuses: { shieldBonus: 5, ap: 0 }, description: "Once per turn, may force an attacker to reroll their attack roll." } },
    { name: "Plate Cuirass", type: "Armor", class: ["Warrior", "Cleric", "Ranger", "Barbarian"], effect: { bonuses: { shieldBonus: 6, ap: 0 }, description: "A sturdy defense for the chest." } },
    { name: "Round Shield", type: "Armor", class: ["Warrior", "Cleric", "Ranger", "Barbarian"], effect: { bonuses: { shieldBonus: 1, ap: 0 }, description: "+1 to Block rolls." } },
    { name: "Scaled Vest", type: "Armor", class: ["Warrior", "Cleric", "Ranger", "Barbarian"], effect: { bonuses: { shieldBonus: 5, ap: 0 }, description: "Overlapping plates deflect blows." } },
    { name: "Spellward Plate", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 7, ap: 0 }, description: "+1 to saving throws against spells." } },
    { name: "Spiritweave Robes", type: "Armor", class: ["Any"], effect: { bonuses: { shieldBonus: 2, ap: 2 }, description: "Resistance to Necrotic damage." } },
    { name: "Sylvan Shroud", type: "Armor", class: ["Any"], effect: { bonuses: { shieldBonus: 3, ap: 2 }, description: "Advantage on Dexterity saving throws." } },
    { name: "Thornmail", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 4, ap: -1 }, description: "Deals 1 damage to attacker on a critical hit against the wearer." } },
    { name: "Toughened Hides", type: "Armor", class: ["Any"], effect: { bonuses: { shieldBonus: 3, ap: 1 }, description: "Resistance to Piercing damage." } },
    { name: "Wyrmscale Mail", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 9, ap: 0 }, description: "Immunity to one type of elemental damage (Fire, Cold, etc.). Player's choice." } }
];

// --- 6.3. Spell Cards ---
const spellCards = [
    // Level 1
    { name: "Acid Burst", type: "Spell", apCost: 1, class: ["Mage", "Ranger"], effect: { type: "damage", dice: "1d6", target: "aoe", description: "Deals 1d6 acid damage to each creature in a 5-foot radius sphere at Far range." } },
    { name: "Cinder Shot", type: "Spell", apCost: 1, class: ["Mage", "Ranger"], effect: { type: "damage", dice: "1d10", target: "any-monster", description: "Deals 1d10 fire damage at Far range." } },
    { name: "Flame Fan", type: "Spell", apCost: 1, class: ["Mage"], effect: { type: "damage", dice: "3d6", target: "aoe", description: "Deals 3d6 fire damage in a 15-foot cone. (DEX save DC 13 for half)." } },
    { name: "Force Barrier", type: "Spell", apCost: 1, class: ["Mage"], effect: { type: "buff", bonuses: { shieldBonus: 5 }, duration: 2, target: "self", description: "Increase your Shield Points by 5 until the start of your next turn." } },
    { name: "Force Darts", type: "Spell", apCost: 1, class: ["Mage"], effect: { type: "damage", dice: "1d4+1", target: "multi-monster", description: "Deals 1d4+1 force damage to up to three targets at Far range." } },
    { name: "Frost Beam", type: "Spell", apCost: 1, class: ["Mage", "Ranger"], effect: { type: "damage", dice: "1d8", status: "Slowed", duration: 2, target: "any-monster", description: "Deals 1d8 cold damage and reduces target's speed by 10 feet until the start of your next turn." } },
    { name: "Grasping Vines", type: "Spell", apCost: 1, class: ["Ranger"], effect: { type: "control", status: "Restrained", duration: 2, target: "aoe", description: "Restrains creatures in a 20-foot square at Far range. (STR save DC 13)." } },
    { name: "Healing Touch", type: "Spell", apCost: 1, class: ["Cleric", "Ranger"], effect: { type: "heal", dice: "1d8+5", target: "any-player", description: "Heals a creature you touch for 1d8+5 HP." } },
    { name: "Illumination", type: "Spell", apCost: 0, class: ["Mage", "Cleric", "Ranger"], effect: { type: "utility", description: "Object emits bright light in a 20-foot radius for 10 minutes." } },
    { name: "Inspire Allies", type: "Spell", apCost: 1, class: ["Cleric", "Ranger"], effect: { type: "buff", dice: "1d4", duration: 2, target: "party", description: "Up to three creatures gain 1d4 bonus to attack rolls and saving throws for 1 minute." } },
    { name: "Jolt Touch", type: "Spell", apCost: 1, class: ["Mage"], effect: { type: "damage", dice: "1d8", status: "Stunned", duration: 2, target: "any-monster", description: "Deals 1d8 lightning damage. Target can't take reactions until the start of its next turn." } },
    { name: "Obscuring Mist", type: "Spell", apCost: 1, class: ["Mage", "Ranger"], effect: { type: "utility", description: "Creates a 20-foot radius sphere of fog that heavily obscures vision for 1 minute." } },
    { name: "Radiant Strike", type: "Spell", apCost: 1, class: ["Cleric"], effect: { type: "damage", dice: "4d6", target: "any-monster", description: "Deals 4d6 radiant damage. The next attack roll against the target has advantage." } },
    { name: "Restore Form", type: "Spell", apCost: 0, class: ["Mage", "Cleric", "Ranger"], effect: { type: "utility", description: "Repairs a single break or tear in an object." } },
    { name: "Shockwave", type: "Spell", apCost: 1, class: ["Mage", "Ranger"], effect: { type: "damage", dice: "2d8", target: "aoe", description: "Deals 2d8 thunder damage in a 15-foot cube and pushes creatures 10 feet away. (CON save DC 13)." } },
    { name: "Skill Boon", type: "Spell", apCost: 1, class: ["Cleric", "Ranger"], effect: { type: "buff", dice: "1d4", duration: 2, target: "any-player", description: "Target gains 1d4 bonus to one ability check for 1 minute." } },
    { name: "Slumber Wave", type: "Spell", apCost: 1, class: ["Mage"], effect: { type: "control", description: "Up to 5d8 hit points of creatures at Far range fall unconscious for 1 minute." } },
    { name: "Toxic Cloud", type: "Spell", apCost: 1, class: ["Mage", "Ranger"], effect: { type: "damage", dice: "1d12", target: "any-monster", description: "Deals 1d12 poison damage at Close range. (CON save DC 13)." } },
    { name: "Warding Touch", type: "Spell", apCost: 1, class: ["Mage", "Cleric", "Ranger"], effect: { type: "buff", dice: "1d4", duration: 2, target: "any-player", description: "Target gains 1d4 bonus to one saving throw for 1 minute." } },
    // Level 2
    { name: "Illusory Doubles", type: "Spell", apCost: 2, class: ["Mage"], effect: { type: "buff", description: "Creates three illusory duplicates of yourself for 10 minutes." } },
    { name: "Immobilize Foe", type: "Spell", apCost: 2, class: ["Mage", "Cleric"], effect: { type: "control", status: "Paralyzed", duration: 2, target: "any-monster", description: "A humanoid must make a Wisdom saving throw (DC 13) or be paralyzed for 1 minute." } },
    { name: "Inferno Rays", type: "Spell", apCost: 2, class: ["Mage"], effect: { type: "damage", dice: "2d6", target: "multi-monster", description: "You create three rays of fire, each dealing 2d6 fire damage." } },
    { name: "Lunar Ray", type: "Spell", apCost: 2, class: ["Cleric", "Ranger"], effect: { type: "damage", dice: "2d10", target: "aoe", description: "A beam of light deals 2d10 radiant damage to any creature that enters it or starts its turn there for 1 minute." } },
    { name: "Mind Scan", type: "Spell", apCost: 2, class: ["Mage"], effect: { type: "utility", description: "Allows you to read the surface thoughts of creatures within 30 feet for 1 minute." } },
    { name: "Sonic Burst", type: "Spell", apCost: 2, class: ["Mage", "Ranger"], effect: { type: "damage", dice: "3d8", target: "aoe", description: "Deals 3d8 thunder damage in a 10-foot radius sphere. (CON save DC 14 for half)." } },
    { name: "Sticky Webbing", type: "Spell", apCost: 2, class: ["Mage", "Ranger"], effect: { type: "control", status: "Restrained", duration: 3, target: "aoe", description: "Creates a large mass of thick, sticky webbing. Creatures in the webs are restrained." } },
    { name: "Umbral Sphere", type: "Spell", apCost: 2, class: ["Mage"], effect: { type: "utility", description: "Creates a 15-foot radius sphere of darkness for 10 minutes." } },
    { name: "Vanish", type: "Spell", apCost: 2, class: ["Mage", "Ranger"], effect: { type: "buff", status: "Invisible", duration: 3, target: "any-player", description: "Makes a creature invisible for up to 1 hour." } },
    { name: "Wind Blast", type: "Spell", apCost: 2, class: ["Ranger"], effect: { type: "control", description: "Blows a 60-foot line of wind, pushing creatures 15 feet. (STR save DC 13)." } },
    // Level 3
    { name: "Abolish Magic", type: "Spell", apCost: 3, class: ["Mage", "Cleric"], effect: { type: "utility", description: "Ends one spell on a creature or object." } },
    { name: "Accelerate", type: "Spell", apCost: 3, class: ["Mage"], effect: { type: "buff", description: "A creature gains increased speed, +2 to AC, advantage on DEX saves, and one extra action for 1 minute." } },
    { name: "Aquatic Adaptation", type: "Spell", apCost: 3, class: ["Cleric", "Ranger"], effect: { type: "buff", description: "Gives creatures the ability to breathe underwater for 24 hours." } },
    { name: "Captivating Display", type: "Spell", apCost: 3, class: ["Mage", "Cleric"], effect: { type: "control", status: "Charmed", duration: 2, target: "aoe", description: "Creatures in a 30-foot cube become charmed if they fail a WIS save (DC 14) for 1 minute." } },
    { name: "Decelerate", type: "Spell", apCost: 3, class: ["Mage"], effect: { type: "debuff", description: "Up to six creatures have their speed halved, -2 to AC, and limited actions for 1 minute." } },
    { name: "Grand Illusion", type: "Spell", apCost: 3, class: ["Mage"], effect: { type: "utility", description: "Creates the illusion of an object, creature, or other visible phenomenon for 10 minutes." } },
    { name: "Inferno Sphere", type: "Spell", apCost: 3, class: ["Mage"], effect: { type: "damage", dice: "8d6", target: "aoe", description: "Deals 8d6 fire damage in a 20-foot radius sphere. (DEX save DC 15 for half)." } },
    { name: "Magic Negation", type: "Spell", apCost: 3, class: ["Mage", "Cleric"], effect: { type: "utility", description: "Attempts to negate another spell." } },
    { name: "Thunder Stroke", type: "Spell", apCost: 3, class: ["Mage", "Ranger"], effect: { type: "damage", dice: "8d6", target: "aoe", description: "Deals 8d6 lightning damage in a 100-foot line. (DEX save DC 15 for half)." } },
    { name: "Winged Ascent", type: "Spell", apCost: 3, class: ["Mage", "Cleric"], effect: { type: "buff", description: "Gives a creature a flying speed of 60 feet for 10 minutes." } }
];

// --- 6.4. Item Cards (Consumables & Utility) ---
const itemCards = [
    { name: "Purifying Flask", type: "Consumable", category: "Damage", apCost: 1, effect: { type: "damage", dice: "2d6", target: "any-monster", description: "Ranged attack (20/60). Deals 2d6 radiant damage to Undead or Fiends." } },
    { name: "Everbright Stick", type: "Consumable", category: "Utility", apCost: 1, effect: { type: "utility", description: "Emits bright light in a 20 ft radius for 1 hour (2 turns)." } },
    { name: "Combustion Flask", type: "Consumable", category: "Hazard", apCost: 1, effect: { type: "damage", dice: "1d4", status: "On Fire", duration: 2, target: "any-monster", description: "Ranged attack (20/60). On hit, target takes 1d4 fire damage and burns for 1 turn." } },
    { name: "Trail Provisions", type: "Consumable", category: "Supply", apCost: 1, effect: { type: "utility", description: "Sustains one creature for one day. Prevents exhaustion from lack of food/water. (3-5 uses)." } },
    { name: "Empty Flask", type: "Container", category: "Utility", effect: { description: "Can hold liquids. Useful for collecting samples or crafting potions." } },
    { name: "Warding Band", type: "Magical Item", category: "Defensive", effect: { bonuses: { shieldBonus: 1 }, description: "This simple band feels cool and protective on your finger, warding off harm." } },
    { name: "Keen Edge (+1)", type: "Magical Item", category: "Offensive", effect: { bonuses: { damageBonus: 1 }, description: "The edge of this weapon holds an unnatural sharpness that bites deeper." } },
    { name: "Ever-Burning Ember", type: "Magical Item", category: "Utility", effect: { description: "This small object sheds bright light in a 10 ft radius indefinitely." } },
    { name: "Pocket Dimension Pouch", type: "Magical Item", category: "Utility", effect: { description: "Can hold a surprising amount of non-living material. Items stored inside are lighter." } },
    { name: "Shadow-Piercing Lenses", type: "Magical Item", category: "Utility", effect: { description: "Grants the wearer Darkvision up to 60 feet." } },
    { name: "True North Compass", type: "Magical Item", category: "Utility", effect: { description: "Always points to true north. Prevents getting lost in non-magical areas." } },
    { name: "Whispering Stones (Pair)", type: "Magical Item", category: "Utility", effect: { description: "One user can speak a message (up to 25 words) that is heard by the holder of the other stone. Once per day." } },
    { name: "Brew of Silent Movement", type: "Potion", category: "Consumable", apCost: 1, effect: { type: "buff", description: "Gain advantage on Dexterity (Stealth) checks for 1 minute (1 turn)." } },
    { name: "Brew of Unseen Passage", type: "Potion", category: "Consumable", apCost: 1, effect: { type: "buff", status: "Invisible", duration: 2, description: "Become invisible for 1 minute (1 turn). The effect ends if you attack or cast a spell." } },
    { name: "Draught of Might", type: "Potion", category: "Consumable", apCost: 1, effect: { type: "buff", bonuses: { str: 2 }, duration: 2, description: "Gain advantage on Strength checks and Strength saves for 1 minute (1 turn)." } },
    { name: "Elixir of Keen Sight", type: "Potion", category: "Consumable", apCost: 1, effect: { type: "buff", bonuses: { wis: 2 }, duration: 2, description: "Gain advantage on Wisdom (Perception) checks for 1 minute (1 turn)." } },
    { name: "Elixir of Restoration", type: "Potion", category: "Consumable", apCost: 1, effect: { type: "heal", dice: "4d4+4", target: "any-player", description: "Heals for 4d4 + 4 HP." } },
    { name: "Purifying Draught", type: "Potion", category: "Consumable", apCost: 1, effect: { type: "utility", status: "Cure Poison", target: "any-player", description: "Cure the Poisoned condition." } },
    { name: "Sovereign Salve", type: "Potion", category: "Consumable", apCost: 1, effect: { type: "heal", dice: "1d8", target: "any-player", description: "Heals for 1d8 HP." } },
    { name: "Vial of Vitality", type: "Potion", category: "Consumable", apCost: 1, effect: { type: "heal", dice: "2d4+2", target: "any-player", description: "Heals for 2d4 + 2 HP." } },
    { name: "Scroll of Arcane Insight", type: "Scroll", category: "Consumable", apCost: 1, effect: { type: "utility", description: "Reveals the magical properties of one item. Consumed on use." } },
    { name: "Scroll of Grasping Vines", type: "Scroll", category: "Consumable", apCost: 1, effect: { type: "spell", spellName: "Grasping Vines", description: "Allows the user to cast the Grasping Vines spell as if they were a spellcaster." } },
    { name: "Scroll of Healing Touch", type: "Scroll", category: "Consumable", apCost: 1, effect: { type: "spell", spellName: "Healing Touch", description: "Allows the user to cast the Healing Touch spell as if they were a spellcaster." } },
    { name: "Scroll of Illusory Doubles", type: "Scroll", category: "Consumable", apCost: 1, effect: { type: "spell", spellName: "Illusory Doubles", description: "Allows the user to cast the Illusory Doubles spell as if they were a spellcaster." } },
    { name: "Scroll of Inferno Sphere", type: "Scroll", category: "Consumable", apCost: 1, effect: { type: "spell", spellName: "Inferno Sphere", description: "Allows the user to cast the Inferno Sphere spell as if they were a spellcaster." } },
    { name: "Scroll of Shockwave", type: "Scroll", category: "Consumable", apCost: 1, effect: { type: "spell", spellName: "Shockwave", description: "Allows the user to cast the Shockwave spell as if they were a spellcaster." } },
    { name: "Climber's Spikes", type: "Utility", category: "General", relevantSkill: "str", effect: { description: "Provides advantage on difficult Strength (Athletics) or Dexterity (Acrobatics) checks for climbing." } },
    { name: "Climbing Hook", type: "Utility", category: "General", relevantSkill: "str", effect: { description: "Can be used with a rope for ascending or descending. Provides advantage on Strength (Athletics) checks." } },
    { name: "Consecrated Emblem", type: "Utility", category: "General", class: ["Cleric"], effect: { description: "A holy symbol that can be used as a focus for casting divine spells. May ward off minor undead." } },
    { name: "Iron Pry", type: "Utility", category: "General", relevantSkill: "str", effect: { description: "Provides advantage on Strength checks made to force open doors, chests, or containers." } },
    { name: "Lockpicks & Shims", type: "Utility", category: "General", class: ["Rogue"], relevantSkill: "dex", effect: { description: "Provides advantage on Skill Challenges related to picking locks or disarming simple traps." } },
    { name: "Spark & Steel", type: "Utility", category: "General", effect: { description: "Allows the user to light fires or other flammable objects quickly." } },
    { name: "Sturdy Cord (50 ft)", type: "Utility", category: "General", effect: { description: "Can be used for climbing, tying, or other tasks requiring rope." } },
    { name: "Trail Digger", type: "Utility", category: "General", relevantSkill: "str", effect: { description: "Useful for digging. Provides advantage on Skill Challenges related to excavation or creating simple earthworks." } }
];

// --- 6.5. Event Cards ---
const worldEventCards = [
    // Beneficial
    { name: "A Moment of Clarity", type: "World Event", duration: 1, eventType: "skill_challenge", description: "A puzzling mystery becomes clear.", skill: "int", dc: 12 },
    { name: "Divine Favor", type: "World Event", duration: 2, eventType: "Beneficial", description: "All players gain +1 to their next roll." },
    { name: "Helpful Local", type: "World Event", duration: 1, eventType: "skill_challenge", description: "A friendly local offers assistance if you can persuade them.", skill: "cha", dc: 12 },
    { name: "Inspiration Surge", type: "World Event", duration: 2, eventType: "Beneficial", description: "The next ability check, attack roll, or saving throw for each player is made with advantage." },
    { name: "Lucky Find", type: "World Event", duration: 1, eventType: "skill_challenge", description: "You spot something valuable, if you can perceive it.", skill: "wis", dc: 10 },
    // Hindrance
    { name: "Sudden Illness", type: "World Event", duration: 2, eventType: "Hindrance", description: "A wave of nausea washes over the party. All players have disadvantage on STR checks.", skill: "con", dc: 14 },
    { name: "Wrong Turn", type: "World Event", duration: 1, eventType: "skill_challenge", description: "You question your path. Can you find the way?", skill: "wis", dc: 10 },
    // Combat
    { name: "Critical Moment", type: "World Event", duration: 2, eventType: "Combat", description: "The air crackles with energy. All attacks have a +2 bonus to their roll." },
    { name: "Last Stand", type: "World Event", duration: 2, eventType: "Combat", description: "All players gain 5 temporary hit points." },
    // Exploration
    { name: "Ancient Inscription", type: "World Event", duration: 1, eventType: "skill_challenge", description: "You find an ancient text. Can you decipher it?", skill: "int", dc: 12 },
    { name: "Hidden Passage", type: "World Event", duration: 1, eventType: "skill_challenge", description: "You notice an oddity in the stonework.", skill: "wis", dc: 13 },
    // Social
    { name: "False Accusation", type: "World Event", duration: 1, eventType: "skill_challenge", description: "Someone is wrongly blamed. Can you clear their name?", skill: "cha", dc: 14 },
    { name: "Offered a Bribe", type: "World Event", duration: 1, eventType: "skill_challenge", description: "An official offers you a deal. Do you take it?", skill: "wis", dc: 13 },
    // Weather
    { name: "Arctic Squall", type: "World Event", duration: 2, eventType: "Weather", description: "A sudden, biting wind howls. CON Save DC 12 each turn or take 1d4 cold damage.", skill: "con", dc: 12 },
    { name: "Misty Veil", type: "World Event", duration: 2, eventType: "Weather", description: "An unnaturally thick mist rolls in. All ranged attacks have disadvantage.", skill: "wis", dc: 14 },
    // Multi-stage challenges
    { 
        name: "Collapsing Floor", 
        type: "World Event", 
        duration: 1, 
        eventType: "multi_stage_skill_challenge",
        stages: [
            { description: "The ground shakes! Make a DEX check to keep your footing!", skill: "dex", dc: 12, failure: { type: "damage", value: "1d4", text: "You stumble and take damage!" } },
            { description: "A chasm opens! Make a STR check to leap across!", skill: "str", dc: 14, failure: { type: "damage", value: "1d8", text: "You fall short and take heavy damage!" } }
        ],
        success: { text: "You navigate the collapsing floor and find a hidden shortcut!" }
    },
    { 
        name: "Dangerous Terrain", 
        type: "World Event", 
        duration: 1, 
        eventType: "multi_stage_skill_challenge",
        stages: [
            { description: "The path is slick with mud. Make a DEX check to stay upright.", skill: "dex", dc: 11, failure: { type: "damage", value: "1d4", text: "You slip and twist your ankle." } },
            { description: "Thorny vines block the way. Make a STR check to push through.", skill: "str", dc: 13, failure: { type: "damage", value: "1d6", text: "The thorns tear at you as you struggle." } }
        ],
        success: { text: "You expertly navigate the treacherous terrain." }
    },
];

const partyEventCards = worldEventCards.filter(e => ['Social', 'Beneficial'].includes(e.eventType));

const environmentalCards = [
    {
        name: "Crumbling Pillar",
        type: "Environmental",
        description: "A large, unstable stone pillar. It looks like a strong push could topple it.",
        skillInteractions: [
            { 
                name: "Topple Pillar", 
                apCost: 2, 
                skill: "str", 
                dc: 14, 
                success: { type: "aoe_damage", value: "2d8", text: "With a mighty heave, the pillar crashes down on all monsters!" },
                failure: { type: "self_damage", value: "1d6", text: "You strain yourself, taking damage as the pillar barely budges." }
            }
        ]
    },
    {
        name: "Trapped Chest",
        type: "Environmental",
        description: "An old, sturdy chest. It seems too good to be true.",
        skillInteractions: [
            { 
                name: "Disarm Trap", 
                apCost: 1, 
                eventType: "multi_stage_skill_challenge",
                stages: [
                    { description: "First, inspect the chest for traps. (WIS Check)", skill: "wis", dc: 13, failure: { type: "damage", value: "2d6", text: "You miss the trigger and a poisoned dart shoots out!" } },
                    { description: "You've found the mechanism. Now, carefully disable it. (DEX Check)", skill: "dex", dc: 15, failure: { type: "damage", value: "1d10", text: "Your hand slips and the trap partially triggers!" } }
                ],
                success: { type: "loot", text: "You deftly disarm the trap and claim the treasure within!" }
            }
        ]
    }
];


// --- 7. MONSTER DATA ---
const allMonsters = {
    // Tier 1
    phantomLight: { name: "Phantom Light", type: "Monster", maxHp: 5, attackBonus: 0, requiredRollToHit: 10, effect: { dice: "1d8", description: "Incorporeal. Deals 1d8 lightning to creatures ending turn within 5ft." }, ap: 1, weakness: "Radiant" },
    emberFlicker: { name: "Ember Flicker", type: "Monster", maxHp: 6, attackBonus: 4, requiredRollToHit: 12, effect: { dice: "1d10", description: "On miss, may ignite flammable objects." }, ap: 1, weakness: "Cold, Water" },
    pestieProwler: { name: "Pestie Prowler", type: "Monster", maxHp: 7, attackBonus: 4, requiredRollToHit: 10, effect: { dice: "1d6", description: "Sneaky Escape: Can flee if HP is 3 or less." }, ap: 1, 
        skillInteractions: [
            { name: "Intimidate", apCost: 1, skill: "cha", dc: 12, success: { type: "status_effect", effect: "Frightened", duration: 2, text: "You scare the Pestie, causing it to freeze in fear!" }, failure: { type: "none", text: "The Pestie just snarls at you." } }
        ]
    },
    pestiePilferer: { name: "Pestie Pilferer", type: "Monster", maxHp: 8, attackBonus: 4, requiredRollToHit: 12, effect: { dice: "1d6+2", description: "Quick Feet: Can Break Away as a bonus action." }, ap: 1, weakness: "Psychic" },
    grottoWeaver: { name: "Grotto Weaver", type: "Monster", maxHp: 10, attackBonus: 4, requiredRollToHit: 12, effect: { dice: "1d6", description: "Web Shot: Can attempt to restrain a player (DC 10 STR save)." }, ap: 2 },
    flutterwingSwarm: { name: "Flutterwing Swarm", type: "Monster", maxHp: 10, attackBonus: 4, requiredRollToHit: 12, effect: { dice: "2d4", description: "Blind Flight: Immune to blindness. Disadvantage on Perception checks." }, ap: 1, weakness: "Thunder" },
    pestieWhisperer: { name: "Pestie Whisperer", type: "Monster", maxHp: 10, attackBonus: 3, requiredRollToHit: 13, effect: { dice: "1d4", description: "Tribal Magic: Once per combat, +2 attack rolls for all pesties within 20 ft for 1 round." }, ap: 1 },
    scaleKinSkulker: { name: "Scale-kin Skulker", type: "Monster", maxHp: 10, attackBonus: 2, requiredRollToHit: 14, effect: { dice: "1d4+1", description: "Trap Master: Sets a trap at start of combat." }, ap: 1, weakness: "Area-of-effect" },
    essenceThief: { name: "Essence Thief", type: "Monster", maxHp: 15, attackBonus: 4, requiredRollToHit: 14, effect: { dice: "2d6", description: "Incorporeal. Reduces Strength by 1d4 on hit." }, ap: 1, weakness: "Radiant" },
    boneArcher: { name: "Bone Archer", type: "Monster", maxHp: 18, attackBonus: 3, requiredRollToHit: 14, effect: { dice: "1d8", description: "Bone Resilience: Immune to poison and charm." }, ap: 1, weakness: "Bludgeoning" },

    // Tier 2
    veiledFanatic: { name: "Veiled Fanatic", type: "Monster", maxHp: 20, attackBonus: 5, requiredRollToHit: 14, effect: { dice: "1d4+3", description: "Death Burst: 1d6 force damage to adjacent on death." }, ap: 1, weakness: "Radiant" },
    stripedMarauder: { name: "Striped Marauder", type: "Monster", maxHp: 23, attackBonus: 4, requiredRollToHit: 15, effect: { dice: "1d8+2", description: "Rampage: If it reduces a creature to 0 HP, can move and attack again." }, ap: 2, weakness: "Fire" },
    segmentedHorror: { name: "Segmented Horror", type: "Monster", maxHp: 24, attackBonus: 5, requiredRollToHit: 14, effect: { dice: "1d4+3", description: "Wall Climber. DC 11 CON save vs 1d6 poison." }, ap: 2, weakness: "Fire" },
    stonegazeWyrmlet: { name: "Stonegaze Wyrmlet", type: "Monster", maxHp: 24, attackBonus: 4, requiredRollToHit: 14, effect: { dice: "1d6+2", description: "Petrification Gaze (DC 12 CON save or petrified)." }, ap: 2, weakness: "Bludgeoning" },
    causticSludge: { name: "Caustic Sludge", type: "Monster", maxHp: 24, attackBonus: 3, requiredRollToHit: 13, effect: { dice: "1d8", description: "Corrodes armor (-1 AC) on hit. Splits on Lightning damage." }, ap: 1, weakness: "Slashing, Cold" },
    skyLurer: { name: "Sky Lurer", type: "Monster", maxHp: 27, attackBonus: 4, requiredRollToHit: 14, effect: { dice: "1d6+1", description: "Swooping Attack. Captivating Song (DC 11 WIS save or charmed)." }, ap: 2, weakness: "Piercing" },
    highwayScourge: { name: "Highway Scourge", type: "Monster", maxHp: 28, attackBonus: 6, requiredRollToHit: 15, effect: { dice: "2d6+3", description: "Bonus Action: Shout (All Bandits get +1 attack for one round)." }, ap: 2, weakness: "Low Wisdom" },
    ruinedSentinel: { name: "Ruined Sentinel", type: "Monster", maxHp: 33, attackBonus: 6, requiredRollToHit: 16, effect: { dice: "2d8", description: "Magic Resistance. DC 14 CON save or stunned on hit." }, ap: 2, weakness: "Thunder, Psychic",
        skillInteractions: [
            { name: "Find Weakness", apCost: 1, skill: "int", dc: 15, success: { type: "apply_vulnerability", text: "You spot a crack in its armor! The next attack against it has advantage." }, failure: { type: "none", text: "The sentinel's construction is flawless." } }
        ]
     },
    shadowmawAlpha: { name: "Shadowmaw Alpha", type: "Monster", maxHp: 34, attackBonus: 5, requiredRollToHit: 14, effect: { dice: "2d6+2", description: "Pack Tactics. DC 12 STR save or prone on hit." }, ap: 2, weakness: "Fire" },
    stoneWing: { name: "Stone Wing", type: "Monster", maxHp: 35, attackBonus: 5, requiredRollToHit: 15, effect: { dice: "1d6+3", description: "Stone Form: Can become indistinguishable from statue." }, ap: 2, weakness: "Thunder" },

    // Tier 3 & Bosses
    hauntedCuirass: { name: "Haunted Cuirass", type: "Monster", maxHp: 41, attackBonus: 4, requiredRollToHit: 16, effect: { dice: "2d6", description: "Unyielding Form (Immune to poison, exhaustion, and fear)." }, ap: 2, weakness: "Bludgeoning" },
    greenskinMauler: { name: "Greenskin Mauler", type: "Monster", maxHp: 44, attackBonus: 5, requiredRollToHit: 15, effect: { dice: "1d12+3", description: "Relentless Endurance (Once/day, if reduced to 0 HP, drop to 1 HP instead)." }, ap: 2, weakness: "Psychic" },
    spectralCorruptor: { name: "Spectral Corruptor", type: "Monster", maxHp: 45, attackBonus: 6, requiredRollToHit: 16, effect: { dice: "3d6", description: "Incorporeal. Reduces maximum HP by damage dealt." }, ap: 2, weakness: "Radiant" },
    axehornBrute: { name: "Axehorn Brute (Mini-Boss)", type: "Monster", maxHp: 55, attackBonus: 7, requiredRollToHit: 16, effect: { dice: "2d12+4", description: "Labyrinthine Recall (Cannot become lost)." }, ap: 3, weakness: "Piercing" },
    briarWitch: { name: "Briar Witch (Mini-Boss)", type: "Monster", maxHp: 59, attackBonus: 5, requiredRollToHit: 15, effect: { dice: "2d6", description: "Cackle of Madness: Confuse enemies. Can cast Grasping Vines, Vanish, or Curse." }, ap: 2, weakness: "Fire, Radiant" },
    wrappedAncient: { name: "Wrapped Ancient (Mini-Boss)", type: "Monster", maxHp: 60, attackBonus: 5, requiredRollToHit: 15, effect: { dice: "2d6+3", description: "Undead Fortitude. Curse of the Mummy Rot." }, ap: 2, weakness: "Fire" },
    wateryCharmer: { name: "Watery Charmer (Mini-Boss)", type: "Monster", maxHp: 63, attackBonus: 6, requiredRollToHit: 16, effect: { dice: "1d6+3", description: "Captivating Song. Can cast Immobilize Foe or Suggestion." }, ap: 2, weakness: "Bludgeoning" },
    hillOaf: { name: "Hill Oaf (Mini-Boss)", type: "Monster", maxHp: 64, attackBonus: 6, requiredRollToHit: 14, effect: { dice: "2d8+4", description: "Powerful Blow (Once per turn, can add +2 to damage)." }, ap: 2, weakness: "Psychic" },
    deathlordMarshal: { name: "Deathlord Marshal (Boss)", isBoss: true, maxHp: 78, attackBonus: 7, requiredRollToHit: 17, effect: { dice: "3d6+4", description: "Aura of Fear. Unholy Endurance." }, ap: 3, weakness: "Radiant" },
    earthColossus: { name: "Earth Colossus (Boss)", isBoss: true, maxHp: 112, attackBonus: 8, requiredRollToHit: 18, effect: { dice: "2d10+5", description: "Immutable Form. Slows target on hit." }, ap: 3, weakness: "Thunder" },
    winterJuggernaut: { name: "Winter Juggernaut (Boss)", isBoss: true, maxHp: 130, attackBonus: 9, requiredRollToHit: 18, effect: { dice: "3d12+6", description: "Icy Aura (Deals 1d4 cold damage to nearby creatures)." }, ap: 3, weakness: "Fire" },
    hellfireSovereign: { name: "Hellfire Sovereign (Boss)", isBoss: true, maxHp: 195, attackBonus: 9, requiredRollToHit: 19, effect: { dice: "4d6+5", description: "Hellish Regeneration. Flaming Aura. Legendary Action (Hellfire Wave)." }, ap: 4, weakness: "Cold, Radiant" },
    rotwoodBehemoth: { name: "Rotwood Behemoth (Boss)", isBoss: true, maxHp: 214, attackBonus: 8, requiredRollToHit: 18, effect: { dice: "3d8+4", description: "Rooted Horror (difficult terrain). Corruption Pulse." }, ap: 3, weakness: "Fire, Radiant" },
};


const monsterTiers = {
    tier1: Object.values(allMonsters).filter(m => m.maxHp < 25),
    tier2: Object.values(allMonsters).filter(m => m.maxHp >= 25 && m.maxHp < 70),
    tier3: Object.values(allMonsters).filter(m => m.maxHp >= 70)
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
    environmentalCards,
    monsterTiers,
    npcDialogue,
    magicalAffixes,
    actionCosts,
    statusEffectDefinitions,
    allMonsters, // Exporting all monsters for easier lookup by name/id
};