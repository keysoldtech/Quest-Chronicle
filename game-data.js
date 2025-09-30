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
    Barbarian: { baseHp: 24, baseDamageBonus: 4, baseShieldBonus: 0, baseAp: 3, healthDice: 4, stats: { str: 4, dex: 1, con: 3, int: 0, wis: 0, cha: 1 }, ability: { name: 'Unchecked Assault', apCost: 1, cost: { type: 'discard', cardType: 'Spell' }, description: 'Discard a Spell card to add +6 damage to your next successful weapon attack this turn.' } },
    Cleric:    { baseHp: 20, baseDamageBonus: 1, baseShieldBonus: 3, baseAp: 2, healthDice: 3, stats: { str: 1, dex: 0, con: 2, int: 1, wis: 4, cha: 2 }, ability: { name: 'Divine Aid', apCost: 1, cost: null, description: 'Gain a +1d4 bonus to your next d20 roll (attack or challenge) this turn.' } },
    Mage:      { baseHp: 18, baseDamageBonus: 1, baseShieldBonus: 2, baseAp: 2, healthDice: 2, stats: { str: 0, dex: 1, con: 1, int: 4, wis: 2, cha: 1 }, ability: { name: 'Mystic Recall', apCost: 1, cost: null, description: 'Draw one card from the Spell deck.' } },
    Ranger:    { baseHp: 20, baseDamageBonus: 2, baseShieldBonus: 2, baseAp: 2, healthDice: 3, stats: { str: 1, dex: 4, con: 2, int: 1, wis: 3, cha: 0 }, ability: { name: 'Hunters Mark', apCost: 1, cost: null, description: 'Mark a monster. All attacks against it deal +2 damage for one round.' } },
    Rogue:     { baseHp: 18, baseDamageBonus: 3, baseShieldBonus: 1, baseAp: 3, healthDice: 2, stats: { str: 1, dex: 4, con: 1, int: 2, wis: 0, cha: 3 }, ability: { name: 'Evasion', apCost: 2, cost: null, description: 'For one round, all attacks against you have disadvantage (DM rerolls hits).' } },
    Warrior:   { baseHp: 22, baseDamageBonus: 2, baseShieldBonus: 4, baseAp: 3, healthDice: 4, stats: { str: 3, dex: 2, con: 4, int: 0, wis: 1, cha: 1 }, ability: { name: 'Weapon Surge', apCost: 1, cost: { type: 'discard', cardType: 'Spell' }, description: 'Discard a Spell card to add +4 damage to your next successful weapon attack this turn.' } },
};

// --- 2. STATUS EFFECT DEFINITIONS ---
const statusEffectDefinitions = {
    'Poisoned': { trigger: 'start', damage: '1d4', description: 'Takes 1d4 damage at the start of their turn.' },
    'Stunned': { cannotAct: true, description: 'Cannot take actions.' },
    'On Fire': { trigger: 'start', damage: '1d6', description: 'Takes 1d6 damage at the start of their turn.'},
    'Guarded': { rollModifier: 2, description: 'Has +2 to defense rolls.'},
    'Slowed': { rollModifier: -2, description: 'Has -2 to all d20 rolls.'},
    'Drained': { description: 'Starts turn with -1 AP.' },
    'Inspired': { description: 'Feeling motivated, +2 to attack rolls.' },
};

// --- 3. ACTION COSTS ---
const actionCosts = {
    briefRespite: 1,
    fullRest: 2,
    guard: 1
};

// --- 4. SKILL CHALLENGES ---
const skillChallenges = [
    {
        id: 'sc-01',
        name: 'Disarm Trapped Chest',
        description: 'You find a heavy, iron-bound chest. The lock looks complex, and you hear a faint clicking from within.',
        skill: 'dex',
        dc: 14,
        successThreshold: 2,
        failureThreshold: 1,
        itemBonus: {
            'Lockpicks & Shims': { rollModifier: 3 },
        },
        success: {
            message: 'With a final *click*, the lock opens and the trap is disarmed! You open the chest to find some loot.',
            reward: { type: 'loot', count: 2 }
        },
        failure: {
            message: 'You hear a loud *SNAP* as the trap springs! A spray of acid shoots out.',
            consequence: { type: 'damage', dice: '2d6', target: 'initiator' }
        }
    },
    {
        id: 'sc-02',
        name: 'Climb a Treacherous Cliff',
        description: 'A steep cliff face blocks your path. The rock is slick with moss and rain.',
        skill: 'str',
        dc: 15,
        successThreshold: 3,
        failureThreshold: 2,
        itemBonus: {
            "Climber's Spikes": { rollModifier: 3 },
            "Sturdy Cord (50 ft)": { rollModifier: 2 }
        },
        success: {
            message: 'After a grueling climb, the whole party reaches the top, revealing a hidden path forward.',
            reward: { type: 'progress', message: 'The path forward is clear.' }
        },
        failure: {
            message: 'The party loses their grip and tumbles down, taking damage and losing time.',
            consequence: { type: 'damage', dice: '2d8', target: 'party' }
        }
    }
];

// --- 5. NPC DIALOGUE ---
const npcDialogue = {
    explorer: {
        attack: [
            "Take this, you fiend!", "My blade finds its mark!", "For the light!", "Feel my wrath!", "You won't get past me!", "Another one for the count!", "Let's see how you like this!", "Taste steel!", "Go back to the shadows!", "This ends now!", "Feel my steel!", "Back to the abyss with you!", "Suffer my wrath!", "This is for my comrades!", "You have no place here!",
        ],
        heal: [
            "Hold on, friend, let me help you.", "Feel the light mend your wounds.", "By my power, you are healed!", "Stay with us! This should help.", "A small respite for you.", "The gods are with you!", "Your wounds are closing.", "Don't give up! I'm here.", "Let this magic restore you.", "You'll be back on your feet in no time.", "Let this light restore your strength.", "Your vitality returns!", "Do not falter! We are with you.", "May this aid your recovery.", "The magic flows through you, mending your injuries.",
        ],
        onHit: [
            "That one was close!", "I won't fall so easily!", "A mere scratch!", "Is that all you've got?", "You'll pay for that!", "I've had worse!", "A worthy blow, but not enough!", "It will take more than that to stop me!", "Gah! A lucky shot!", "My turn is coming...", "A lucky strike!", "I can take it!", "You'll regret that swing!", "Barely felt it!", "I'll return this pain tenfold!",
        ],
        utility: [ 
            "Just the tool for the job!", "Let's see what this can do.", "A clever solution is needed here.", "This should even the odds.", "Time for a different approach.", "I have an idea!", "Let me handle this.",
        ]
    },
    dm: {
        worldEvent: [
            "A chill wind blows, bringing a strange scent...", "As you step into the forest, the trees seem to lean in, as if to listen.", "The ground trembles for a moment, then falls still.", "A strange, ethereal light filters through the canopy above.", "You hear a distant cry, half-animal, half-human.", "The air suddenly grows heavy, thick with unspoken magic.", "For a brief second, the world loses its color, turning to shades of gray.", "A forgotten melody drifts on the breeze, its source unknown.", "The shadows around you seem to deepen and writhe.", "An ancient stone nearby begins to hum with a low energy.",
        ],
        playMonster: [
            "From the shadows, a grotesque creature emerges!", "You are not alone. Something scuttles toward you...", "A roar echoes through the chamber as a beast reveals itself!", "The air grows cold as a monster appears before you.", "Disturbing the dust, a creature of nightmare lurches into view.", "Claws scrape on stone as a horror from the depths crawls into the light.", "You've disturbed something. It does not look pleased.", "A hulking silhouette blocks your path, its eyes glowing with malice.", "The stench of decay precedes a shambling monstrosity.", "Bursting from the ground, a creature of earth and rage confronts you!",
        ],
        monsterDefeated: [
            "The creature's last breath escapes it in a foul gasp.", "The beast falls silent, its reign of terror over.", "With a final shudder, the monster collapses into a lifeless heap.", "Your foe is vanquished, its dark presence fading from the world.", "Victory! The monster lies defeated at your feet.", "The monstrosity crumbles to dust, its evil unmade.", "A final, agonized cry, and then... silence.", "The threat is neutralized. You may proceed.", "The creature's lightless eyes stare blankly at the ceiling.", "You have overcome the challenge. The beast is no more.",
        ],
        environment: [ 
            "The air here is damp and smells of moss and decay.", "A faint, rhythmic dripping sound echoes from somewhere deeper in the darkness.", "Ancient, faded murals cover the walls, depicting forgotten heroes and their deeds.", "The ground is littered with bones, both animal and, alarmingly, humanoid.", "A thick, unnatural fog clings to the floor, obscuring your vision.", "Torches on the walls flicker, casting long, dancing shadows.",
        ]
    }
};

// --- 6. MAGICAL AFFIXES (for item generation) ---
const magicalAffixes = {
    prefixes: [
        { name: 'Hardened', tier: 1, bonuses: { shieldBonus: 1 }, types: ['armor'] },
        { name: 'Reinforced', tier: 2, bonuses: { shieldBonus: 2 }, types: ['armor'] },
        { name: 'Adamant', tier: 3, bonuses: { shieldBonus: 3 }, types: ['armor'] },
        { name: 'Vicious', tier: 1, bonuses: { damageBonus: 1 }, types: ['weapon'] },
        { name: 'Savage', tier: 2, bonuses: { damageBonus: 2 }, types: ['weapon'] },
        { name: 'Bloodthirsty', tier: 3, bonuses: { damageBonus: 3 }, types: ['weapon'] },
        { name: 'Agile', tier: 1, bonuses: { ap: 1 }, types: ['weapon', 'armor'] },
        { name: 'Swift', tier: 2, bonuses: { ap: 2 }, types: ['weapon', 'armor'] },
    ],
    suffixes: [
        { name: 'of Fortitude', tier: 1, bonuses: { hp: 5, con: 1 }, types: ['armor'] },
        { name: 'of Vigor', tier: 2, bonuses: { hp: 10, con: 2 }, types: ['armor'] },
        { name: 'of the Titan', tier: 3, bonuses: { hp: 15, con: 3 }, types: ['armor'] },
        { name: 'of Striking', tier: 1, bonuses: { damageBonus: 1, str: 1 }, types: ['weapon'] },
        { name: 'of Ruin', tier: 2, bonuses: { damageBonus: 2, str: 2 }, types: ['weapon'] },
        { name: 'of Annihilation', tier: 3, bonuses: { damageBonus: 3, str: 3 }, types: ['weapon'] },
        { name: 'of the Sentinel', tier: 2, bonuses: { shieldBonus: 1, hp: 5 }, types: ['armor'] },
        { name: 'of the Berserker', tier: 2, bonuses: { damageBonus: 1, hp: 5 }, types: ['weapon'] },
    ]
};

// --- 7. CARD DATA ---

// --- 7.1. Item Cards ---
const itemCards = [
    { name: "Purifying Flask", type: "Consumable", category: "Damage", apCost: 1, effect: { type: "damage", dice: "2d6", target: "any-monster", description: "Ranged attack (20/60). Deals 2d6 radiant damage to Undead or Fiends." } },
    { name: "Purifying Flask", type: "Consumable", category: "Damage", apCost: 1, effect: { type: "damage", dice: "2d6", target: "any-monster", description: "Ranged attack (20/60). Deals 2d6 radiant damage to Undead or Fiends." } },
    { name: "Purifying Flask", type: "Consumable", category: "Damage", apCost: 1, effect: { type: "damage", dice: "2d6", target: "any-monster", description: "Ranged attack (20/60). Deals 2d6 radiant damage to Undead or Fiends." } },
    { name: "Everbright Stick", type: "Consumable", category: "Utility", apCost: 1, effect: { type: "utility", description: "Emits bright light in a 20 ft radius, and dim light for an additional 20 ft, for 1 hour (2 turns)." } },
    { name: "Everbright Stick", type: "Consumable", category: "Utility", apCost: 1, effect: { type: "utility", description: "Emits bright light in a 20 ft radius, and dim light for an additional 20 ft, for 1 hour (2 turns)." } },
    { name: "Everbright Stick", type: "Consumable", category: "Utility", apCost: 1, effect: { type: "utility", description: "Emits bright light in a 20 ft radius, and dim light for an additional 20 ft, for 1 hour (2 turns)." } },
    { name: "Combustion Flask", type: "Consumable", category: "Damage", apCost: 1, effect: { type: "damage", dice: "1d4", status: "On Fire", duration: 2, target: "any-monster", description: "Ranged attack (20/60). On hit, target takes 1d4 fire damage immediately and 1d4 fire damage at the start of their turn." } },
    { name: "Combustion Flask", type: "Consumable", category: "Damage", apCost: 1, effect: { type: "damage", dice: "1d4", status: "On Fire", duration: 2, target: "any-monster", description: "Ranged attack (20/60). On hit, target takes 1d4 fire damage immediately and 1d4 fire damage at the start of their turn." } },
    { name: "Combustion Flask", type: "Consumable", category: "Damage", apCost: 1, effect: { type: "damage", dice: "1d4", status: "On Fire", duration: 2, target: "any-monster", description: "Ranged attack (20/60). On hit, target takes 1d4 fire damage immediately and 1d4 fire damage at the start of their turn." } },
    { name: "Antidote", type: "Consumable", category: "Utility", apCost: 1, effect: { type: "utility", status: "Cure Poison", target: "any-player", description: "Cures one creature of the Poisoned status effect." } },
    { name: "Sturdy Cord (50 ft)", type: "General", category: "Utility", effect: { type: "utility", description: "A sturdy, 50-foot coil of hempen rope. Can be used in skill challenges." } },
    { name: "Lockpicks & Shims", type: "General", category: "Utility", effect: { type: "utility", description: "A set of tools for disabling traps and opening locks. Provides a bonus to relevant skill challenges." } },
    { name: "Climber's Spikes", type: "General", category: "Utility", effect: { type: "utility", description: "Metal spikes that can be attached to boots to aid in climbing. Provides a bonus to climbing-related skill challenges." } }
];

// --- 7.2. Spell Cards ---
const spellCards = [
    { name: "Healing Word", type: "Spell", category: "Healing", apCost: 1, class: ["Cleric", "Any"], effect: { type: "heal", dice: "1d8", target: "any-player", description: "Heal an ally you can see for 1d8 HP." } },
    { name: "Guiding Bolt", type: "Spell", category: "Damage", apCost: 1, class: ["Cleric", "Mage"], effect: { type: "damage", dice: "2d6", status: "Inspired", duration: 1, target: "any-monster", description: "Ranged spell attack. Deals 2d6 radiant damage. The next attack roll against the target has advantage." } },
    { name: "Magic Missile", type: "Spell", category: "Damage", apCost: 1, class: ["Mage", "Any"], effect: { type: "damage", dice: "2d4", target: "any-monster", description: "Automatically hits, dealing 2d4+1 force damage." } },
    { name: "Shield of Faith", type: "Spell", category: "Buff", apCost: 1, class: ["Cleric"], effect: { type: "buff", bonuses: { shieldBonus: 2 }, duration: 2, target: "any-player", description: "Grant an ally +2 Shield Bonus for 2 turns." } },
    { name: "Fire Bolt", type: "Spell", category: "Damage", apCost: 1, class: ["Mage"], effect: { type: "damage", dice: "2d10", target: "any-monster", description: "Ranged spell attack. Deals 2d10 fire damage." } },
    { name: "Chill Touch", type: "Spell", category: "Damage", apCost: 1, class: ["Mage"], effect: { type: "damage", dice: "2d8", status: "Drained", duration: 1, target: "any-monster", description: "Ranged spell attack. Deals 2d8 necrotic damage. The target cannot regain hit points until the start of your next turn." } },
];

// --- 7.3. Weapon Cards ---
const weaponCards = [
    { name: "Longsword", type: "Weapon", apCost: 2, class: ["Warrior", "Barbarian", "Any"], effect: { dice: "1d8", description: "A versatile and reliable martial weapon.", bonuses: { damageBonus: 1 } } },
    { name: "Greataxe", type: "Weapon", apCost: 2, class: ["Barbarian", "Warrior"], effect: { dice: "1d12", description: "A heavy, two-handed axe that deals devastating damage.", bonuses: { damageBonus: 2, dex: -1 } } },
    { name: "Shortbow", type: "Weapon", apCost: 2, class: ["Ranger", "Rogue", "Any"], effect: { dice: "1d6", description: "A light and fast ranged weapon.", bonuses: { dex: 1 } } },
    { name: "Dagger", type: "Weapon", apCost: 1, class: ["Rogue", "Mage", "Any"], effect: { dice: "1d4", description: "A light, concealable blade. Can be used for quick attacks.", bonuses: { dex: 1 } } },
    { name: "Mace", type: "Weapon", apCost: 2, class: ["Cleric", "Warrior"], effect: { dice: "1d6", description: "A simple but effective bludgeoning weapon.", bonuses: { str: 1 } } },
    { name: "Greatsword", type: "Weapon", apCost: 2, class: ["Warrior", "Barbarian"], effect: { dice: "2d6", critBonusDice: "1d6", description: "A massive sword that hits hard and can cause grievous wounds on a critical hit.", bonuses: { damageBonus: 1, ap: -1 } } }
];

// --- 7.4. Armor Cards ---
const armorCards = [
    { name: "Leather Armor", type: "Armor", class: ["Rogue", "Ranger", "Any"], effect: { bonuses: { shieldBonus: 1, ap: 1, hp: 2 }, description: "Light and flexible, allowing for quick movements." } },
    { name: "Chain Mail", type: "Armor", class: ["Warrior", "Cleric", "Barbarian"], effect: { bonuses: { shieldBonus: 3, ap: -1, hp: 4 }, description: "Made of interlocking metal rings, it offers substantial protection but is cumbersome." } },
    { name: "Plate Armor", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 4, hp: 5, dex: -2 }, description: "The heaviest armor, providing the best protection at the cost of mobility." } },
    { name: "Studded Leather", type: "Armor", class: ["Rogue", "Ranger"], effect: { bonuses: { shieldBonus: 2, dex: 1, hp: 3 }, description: "Reinforced with rivets, offering a good balance of protection and agility." } },
    { name: "Scale Mail", type: "Armor", class: ["Cleric", "Warrior"], effect: { bonuses: { shieldBonus: 2, hp: 3 }, description: "A coat and leggings of leather covered with overlapping pieces of metal." } }
];

// --- 7.5. World Event Cards ---
const worldEventCards = [
    { name: "Echoes of the Past", tags: "Environmental / Magical", type: "World Event", description: "A wave of psychic energy washes over the area. Each Explorer must succeed on a DC 13 Wisdom save or be stunned for their next turn.", saveInfo: { save: "WIS", dc: 13 } },
    { name: "Sudden Downpour", tags: "Environmental", type: "World Event", description: "A torrential rain begins, extinguishing all non-magical flames. Ranged weapon attacks are made with disadvantage.", saveInfo: null },
    { name: "Whispers in the Dark", tags: "Psychological", type: "World Event", description: "Malevolent whispers claw at the edges of your minds. Each Explorer must succeed on a DC 12 Charisma save or take 2d6 psychic damage.", saveInfo: { save: "CHA", dc: 12 } },
];

// --- 7.6. Player Event Cards ---
const playerEventCards = [
    { name: "Sudden Insight", type: "Player Event", outcome: "You have a moment of brilliant clarity.", effect: { type: "stat_modifier", bonuses: { int: 2 }, duration: 2 } },
    { name: "Surge of Adrenaline", type: "Player Event", outcome: "Your heart pounds as you feel a rush of strength.", effect: { type: "stat_modifier", bonuses: { str: 2 }, duration: 2 } },
    { name: "Moment of Weakness", type: "Player Event", outcome: "A wave of fatigue washes over you.", effect: { type: "stat_modifier", bonuses: { con: -2 }, duration: 2 } },
    { name: "Fleeting Shadow", type: "Player Event", outcome: "You feel nimble and light on your feet.", effect: { type: "stat_modifier", bonuses: { dex: 2 }, duration: 2 } },
];

// --- 7.7. Party Event Cards ---
const partyEventCards = [
    { name: "Rallying Cry", type: "Party Event", outcome: "A moment of shared courage inspires the party.", effect: { type: "heal", dice: "1d4", target: "party" } },
    { name: "Favorable Winds", type: "Party Event", outcome: "A sudden gust of wind seems to aid your movements.", effect: { type: "stat_change", stat: "currentAp", value: 1, target: "party" } },
    { name: "Shared Burden", type: "Party Event", outcome: "The weight of your quest settles upon you all.", effect: { type: "stat_change", stat: "currentAp", value: -1, target: "party" } }
];

// --- 8. MONSTER DATA ---

// --- 8.1. All Monsters List ---
const allMonsters = {
    // Tier 1
    goblin: { name: "Goblin", type: "Monster", maxHp: 40, attackBonus: 4, requiredRollToHit: 13, effect: { dice: "1d6" }, ap: 1 },
    giantRat: { name: "Giant Rat", type: "Monster", maxHp: 38, attackBonus: 3, requiredRollToHit: 12, effect: { dice: "1d4" }, ap: 1 },
    skeleton: { name: "Skeleton", type: "Monster", maxHp: 48, attackBonus: 4, requiredRollToHit: 13, effect: { dice: "1d6" }, ap: 1 },
    // Tier 2
    orc: { name: "Orc", type: "Monster", maxHp: 52, attackBonus: 5, requiredRollToHit: 13, effect: { dice: "1d12" }, ap: 2 },
    hobgoblin: { name: "Hobgoblin", type: "Monster", maxHp: 46, attackBonus: 3, requiredRollToHit: 18, effect: { dice: "1d8" }, ap: 2 },
    bugbear: { name: "Bugbear", type: "Monster", maxHp: 65, attackBonus: 4, requiredRollToHit: 16, effect: { dice: "2d8" }, ap: 1 },
    // Tier 3
    troll: { name: "Troll", type: "Monster", maxHp: 130, attackBonus: 7, requiredRollToHit: 15, effect: { dice: "2d6" }, ap: 3 },
    ogre: { name: "Ogre", type: "Monster", maxHp: 105, attackBonus: 6, requiredRollToHit: 11, effect: { dice: "2d8" }, ap: 2 },
    beholder: { name: "Beholder", type: "Monster", maxHp: 250, attackBonus: 5, requiredRollToHit: 18, effect: { dice: "4d6" }, ap: 4 },
};

// --- 8.2. Monster Tiers (for spawning) ---
const monsterTiers = {
    tier1: [allMonsters.goblin, allMonsters.giantRat, allMonsters.skeleton],
    tier2: [allMonsters.orc, allMonsters.hobgoblin, allMonsters.bugbear],
    tier3: [allMonsters.troll, allMonsters.ogre, allMonsters.beholder]
};

// --- 9. MODULE EXPORTS ---
module.exports = {
    classes,
    itemCards,
    spellCards,
    weaponCards,
    armorCards,
    worldEventCards,
    playerEventCards,
    partyEventCards,
    monsterTiers,
    npcDialogue,
    skillChallenges,
    magicalAffixes,
    actionCosts
};