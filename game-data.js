// This file contains the game data, structured for the server.

let lastId = 0;
const nextId = () => { lastId++; return `card-${lastId}`; };

const classes = {
    Barbarian: { baseHp: 24, baseDamageBonus: 4, baseShieldBonus: 0, baseAp: 3 },
    Cleric:    { baseHp: 20, baseDamageBonus: 1, baseShieldBonus: 3, baseAp: 2 },
    Mage:      { baseHp: 18, baseDamageBonus: 1, baseShieldBonus: 2, baseAp: 2 },
    Ranger:    { baseHp: 20, baseDamageBonus: 2, baseShieldBonus: 2, baseAp: 2 },
    Rogue:     { baseHp: 18, baseDamageBonus: 3, baseShieldBonus: 1, baseAp: 3 },
    Warrior:   { baseHp: 22, baseDamageBonus: 2, baseShieldBonus: 4, baseAp: 3 },
};

const itemCards = [
    // AP cost and damageDice added for usable items
    { id: nextId(), name: "Purifying Flask", type: "Consumable", category: "Damage", effect: "Deals 2d6 radiant damage to Undead or Fiends.", damageDice: "2d6", apCost: 1, bonuses: { damage: 0 } },
    { id: nextId(), name: "Everbright Stick", type: "Consumable", category: "Utility", effect: "Emits bright light for 1 hour.", apCost: 1 },
    { id: nextId(), name: "Vial of Vitality", type: "Potion", category: "Healing", effect: "Restore 2d4 + 2 HP.", healDice: "2d4+2", apCost: 1, bonuses: { heal: 0 } },
    { id: nextId(), name: "Sovereign Salve", type: "Potion", category: "Healing", effect: "Restore 1d8 HP.", healDice: "1d8", apCost: 1, bonuses: { heal: 0 } },
    { id: nextId(), name: "Combustion Flask", type: "Consumable", category: "Damage", effect: "Target takes 1d4 fire damage.", damageDice: "1d4", apCost: 1, bonuses: { damage: 0 } },
    { id: nextId(), name: "Scroll of Healing Touch", type: "Scroll", category: "Healing", effect: "Cast Healing Touch spell.", healDice: "1d8+5", apCost: 1 },
    { id: nextId(), name: "Lockpicks & Shims", type: "Utility", category: "Utility", effect: "Advantage on picking locks.", apCost: 1 },
];

const spellCards = [
    // damageDice and apCost added
    { id: nextId(), name: "Cinder Shot", type: "Spell", category: "Damage", effect: "Deals 1d10 fire damage.", damageDice: "1d10", apCost: 2, bonuses: { damage: 0 } },
    { id: nextId(), name: "Frost Beam", type: "Spell", category: "Damage", effect: "1d8 cold damage and reduces speed.", damageDice: "1d8", apCost: 1, bonuses: { damage: 0 } },
    { id: nextId(), name: "Healing Touch", type: "Spell", category: "Healing", effect: "Heals 1d8 + 5 HP.", healDice: "1d8+5", apCost: 1, bonuses: { heal: 0 } },
    { id: nextId(), name: "Force Barrier", type: "Spell", category: "Utility", effect: "Increase Shield Points by 5 for 1 round.", apCost: 1 },
    { id: nextId(), name: "Shockwave", type: "Spell", category: "Damage", effect: "2d8 thunder damage and pushes creatures.", damageDice: "2d8", apCost: 2, bonuses: { damage: 0 } },
];

const monsterCards = [
    // requiredRollToHit, damageDice, ap, attackBonus added
    { id: nextId(), name: "Pestie Prowler", type: "Monster", maxHp: 7, requiredRollToHit: 11, attackBonus: 3, damageDice: "1d6", ap: 2, attack: "+3", damage: "1d6 piercing", special: "Sneaky Escape." },
    { id: nextId(), name: "Grotto Weaver", type: "Monster", maxHp: 10, requiredRollToHit: 12, attackBonus: 4, damageDice: "1d6", ap: 2, attack: "+4", damage: "1d6 piercing", special: "Web Shot." },
    { id: nextId(), name: "Bone Archer", type: "Monster", maxHp: 18, requiredRollToHit: 13, attackBonus: 3, damageDice: "1d8", ap: 2, attack: "+3", damage: "1d8 piercing", special: "Bone Resilience." },
    { id: nextId(), name: "Caustic Sludge", type: "Monster", maxHp: 24, requiredRollToHit: 13, attackBonus: 3, damageDice: "1d8", ap: 2, attack: "+3", damage: "1d8 acid", special: "Armor corrosion." },
    { id: nextId(), name: "Shadowmaw Alpha", type: "Monster", maxHp: 34, requiredRollToHit: 14, attackBonus: 5, damageDice: "2d6+2", ap: 3, attack: "+5", damage: "2d6+2 piercing", special: "Pack Tactics." },
];

const weaponCards = [
    // damageDice and apCost added
    { id: nextId(), name: "Axechuck", type: "Weapon", category: "Damage", effect: "1d6 slashing, Thrown (20/60), Returning.", damageDice: "1d6", apCost: 1, bonuses: { damage: 1 } },
    { id: nextId(), name: "Balanced Steel", type: "Weapon", category: "Damage", effect: "1d8 slashing, Versatile (1d10).", damageDice: "1d8", apCost: 1, bonuses: { damage: 2 } },
    { id: nextId(), name: "Farstrike Bow", type: "Weapon", category: "Damage", effect: "1d8 piercing, Ammunition, Heavy, Two-Handed.", damageDice: "1d8", apCost: 1, bonuses: { damage: 2 } },
];

const armorCards = [
     { id: nextId(), name: "Hide Vest", type: "Armor", category: "Defense", effect: "+2 Shield Bonus, +1 AP Bonus.", bonuses: { shield: 2, ap: 1 } },
     { id: nextId(), name: "Link Hauberk", type: "Armor", category: "Defense", effect: "+4 Shield Bonus.", bonuses: { shield: 4, ap: 0 } },
     { id: nextId(), name: "Bastion Shield", type: "Armor", category: "Defense", effect: "+3 Shield Bonus, -1 AP Bonus.", bonuses: { shield: 3, ap: -1 } },
     { id: nextId(), name: "Warding Band", type: "Armor", category: "Defense", effect: "Gain +1 Shield Bonus.", bonuses: { shield: 1, ap: 0 } },
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
    worldEventCards
};
