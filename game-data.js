// This file contains the game data, structured for the server.

let lastId = 0;
const nextId = () => { lastId++; return `card-${lastId}`; };

const classes = {
    Barbarian: { baseHp: 24, baseDamageBonus: 4, baseShieldBonus: 0, baseAp: 3, healthDice: 4 },
    Cleric:    { baseHp: 20, baseDamageBonus: 1, baseShieldBonus: 3, baseAp: 2, healthDice: 3 },
    Mage:      { baseHp: 18, baseDamageBonus: 1, baseShieldBonus: 2, baseAp: 2, healthDice: 2 },
    Ranger:    { baseHp: 20, baseDamageBonus: 2, baseShieldBonus: 2, baseAp: 2, healthDice: 3 },
    Rogue:     { baseHp: 18, baseDamageBonus: 3, baseShieldBonus: 1, baseAp: 3, healthDice: 2 },
    Warrior:   { baseHp: 22, baseDamageBonus: 2, baseShieldBonus: 4, baseAp: 3, healthDice: 4 },
};

const statusEffectDefinitions = {
    'Poisoned': { trigger: 'start', damage: '1d4', description: 'Takes 1d4 damage at the start of their turn.' },
    'Stunned': { cannotAct: true, description: 'Cannot take actions.' },
    'On Fire': { trigger: 'start', damage: '1d6', description: 'Takes 1d6 damage at the start of their turn.'},
    'Guarded': { rollModifier: 2, description: 'Has +2 to defense rolls.'},
    'Slowed': { rollModifier: -2, description: 'Has -2 to all d20 rolls.'}
};

const actionCosts = {
    briefRespite: 1,
    fullRest: 1,
    guard: 1
};

const itemCards = [
    { id: nextId(), name: "Purifying Flask", type: "Consumable", category: "Damage", apCost: 1, effect: { type: 'damage', dice: "2d6", target: 'any-monster', description: "Deals 2d6 radiant damage to Undead or Fiends." } },
    { id: nextId(), name: "Everbright Stick", type: "Consumable", category: "Utility", apCost: 1, effect: { type: 'utility', description: "Emits bright light for 1 hour." } },
    { id: nextId(), name: "Vial of Vitality", type: "Potion", category: "Healing", apCost: 1, effect: { type: 'heal', dice: "2d4+2", target: 'any-explorer', description: "Restore 2d4 + 2 HP." } },
    { id: nextId(), name: "Sovereign Salve", type: "Potion", category: "Healing", apCost: 1, effect: { type: 'heal', dice: "1d8", target: 'any-explorer', description: "Restore 1d8 HP." } },
    { id: nextId(), name: "Combustion Flask", type: "Consumable", category: "Damage", apCost: 1, effect: { type: 'damage', dice: "1d4", status: 'On Fire', duration: 2, target: 'any-monster', description: "Target takes 1d4 fire damage and is set On Fire." } },
    { id: nextId(), name: "Scroll of Healing Touch", type: "Scroll", category: "Healing", apCost: 1, effect: { type: 'heal', dice: "1d8+5", target: 'any-explorer', description: "Magically heal for 1d8+5 HP." } },
    { id: nextId(), name: "Lockpicks & Shims", type: "Utility", category: "Utility", apCost: 1, effect: { type: 'utility', description: "Advantage on picking locks (conceptual)." } },
];

const spellCards = [
    { id: nextId(), name: "Cinder Shot", type: "Spell", category: "Damage", apCost: 2, effect: { type: 'damage', dice: "1d10", target: 'any-monster', description: "Deals 1d10 fire damage." } },
    { id: nextId(), name: "Frost Beam", type: "Spell", category: "Damage", apCost: 1, effect: { type: 'damage', dice: "1d8", status: 'Slowed', duration: 1, target: 'any-monster', description: "1d8 cold damage and slows the target." } },
    { id: nextId(), name: "Healing Touch", type: "Spell", category: "Healing", apCost: 1, effect: { type: 'heal', dice: "1d8+5", target: 'any-explorer', description: "Heals 1d8 + 5 HP." } },
    { id: nextId(), name: "Force Barrier", type: "Spell", category: "Utility", apCost: 1, effect: { type: 'status', status: 'Guarded', duration: 2, target: 'self', description: "Increase Shield Points by 5 for 1 round." } },
    { id: nextId(), name: "Shockwave", type: "Spell", category: "Damage", apCost: 2, effect: { type: 'damage', dice: "2d8", status: 'Stunned', duration: 1, target: 'any-monster', description: "2d8 thunder damage and stuns creatures." } },
];

const monsterCards = [
    { id: nextId(), name: "Pestie Prowler", type: "Monster", maxHp: 7, requiredRollToHit: 11, attackBonus: 3, ap: 2, effect: { type: 'damage', dice: "1d6", description: "Sneaky Escape." } },
    { id: nextId(), name: "Grotto Weaver", type: "Monster", maxHp: 10, requiredRollToHit: 12, attackBonus: 4, ap: 2, effect: { type: 'damage', dice: "1d6", status: 'Slowed', duration: 1, description: "Web Shot." } },
    { id: nextId(), name: "Bone Archer", type: "Monster", maxHp: 18, requiredRollToHit: 13, attackBonus: 3, ap: 2, effect: { type: 'damage', dice: "1d8", description: "Bone Resilience." } },
    { id: nextId(), name: "Caustic Sludge", type: "Monster", maxHp: 24, requiredRollToHit: 13, attackBonus: 3, ap: 2, effect: { type: 'damage', dice: "1d8", status: 'Poisoned', duration: 2, description: "Armor corrosion." } },
    { id: nextId(), name: "Shadowmaw Alpha", type: "Monster", maxHp: 34, requiredRollToHit: 14, attackBonus: 5, ap: 3, effect: { type: 'damage', dice: "2d6+2", description: "Pack Tactics." } },
];

const weaponCards = [
    { id: nextId(), name: "Axechuck", type: "Weapon", apCost: 1, effect: { type: 'damage', dice: "1d6", bonuses: { damage: 1 }, description: "1d6 slashing, Thrown (20/60), Returning." } },
    { id: nextId(), name: "Balanced Steel", type: "Weapon", apCost: 1, effect: { type: 'damage', dice: "1d8", bonuses: { damage: 2 }, description: "1d8 slashing, Versatile (1d10)." } },
    { id: nextId(), name: "Farstrike Bow", type: "Weapon", apCost: 1, effect: { type: 'damage', dice: "1d8", bonuses: { damage: 2 }, description: "1d8 piercing, Ammunition, Heavy, Two-Handed." } },
];

const armorCards = [
     { id: nextId(), name: "Hide Vest", type: "Armor", effect: { description: "+2 Shield Bonus, +1 AP Bonus.", bonuses: { shield: 2, ap: 1 } } },
     { id: nextId(), name: "Link Hauberk", type: "Armor", effect: { description: "+4 Shield Bonus.", bonuses: { shield: 4, ap: 0 } } },
     { id: nextId(), name: "Bastion Shield", type: "Armor", effect: { description: "+3 Shield Bonus, -1 AP Bonus.", bonuses: { shield: 3, ap: -1 } } },
     { id: nextId(), name: "Warding Band", type: "Armor", effect: { description: "Gain +1 Shield Bonus.", bonuses: { shield: 1, ap: 0 } } },
];

const worldEventCards = [
    { id: nextId(), name: "Crimson Orb", type: "World Event", tags: "Celestial, Magical", outcome: "Wisdom Save DC 12 or gain 1 level of exhaustion." },
    { id: nextId(), name: "Ailment Cleansed", type: "World Event", tags: "Beneficial, Healing", outcome: "You are cured of one condition." },
    { id: nextId(), name: "Arctic Squall", type: "World Event", tags: "Weather, Hazard", outcome: "Constitution Save DC 12 or gain one level of exhaustion." },
    { id: nextId(), name: "Unforeseen Encounter", type: "World Event", tags: "Chance, Social", outcome: "Charisma Check DC 15. Success: new ally. Failure: new enemy." },
];

module.exports = {
    classes,
    itemCards,
    spellCards,
    monsterCards,
    weaponCards,
    armorCards,
    worldEventCards,
    statusEffectDefinitions,
    actionCosts,
};