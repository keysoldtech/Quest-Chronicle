// This file contains a sample of the game data, structured for the server.
// In a real application, this would be loaded from a database or CSV files.

// Simple ID generator for this sample data
let lastId = 0;
const nextId = () => {
    lastId++;
    return lastId;
};

const itemCards = [
    { id: nextId(), name: "Purifying Flask", type: "Consumable", effect: "Deals 2d6 radiant damage to Undead or Fiends." },
    { id: nextId(), name: "Everbright Stick", type: "Consumable", effect: "Emits bright light for 1 hour." },
    { id: nextId(), name: "Vial of Vitality", type: "Potion", effect: "Restore 2d4 + 2 HP." },
    { id: nextId(), name: "Sovereign Salve", type: "Potion", effect: "Restore 1d8 HP." },
    { id: nextId(), name: "Warding Band", type: "Magical Item", effect: "Gain +1 Shield Bonus." },
    { id: nextId(), name: "Scroll of Healing Touch", type: "Scroll", effect: "Cast Healing Touch spell." },
    { id: nextId(), name: "Lockpicks & Shims", type: "Utility", effect: "Advantage on picking locks." },
];

const spellCards = [
    { id: nextId(), name: "Cinder Shot", type: "Spell", effect: "Deals 1d10 fire damage." },
    { id: nextId(), name: "Frost Beam", type: "Spell", effect: "1d8 cold damage and reduces speed." },
    { id: nextId(), name: "Healing Touch", type: "Spell", effect: "Heals 1d8 + 5 HP." },
    { id: nextId(), name: "Force Barrier", type: "Spell", effect: "Increase Shield Points by 5 for 1 round." },
    { id: nextId(), name: "Shockwave", type: "Spell", effect: "2d8 thunder damage and pushes creatures." },
];

const monsterCards = [
    { id: nextId(), name: "Pestie Prowler", type: "Monster", hp: 7, attack: "+3", damage: "1d6 piercing", special: "Sneaky Escape." },
    { id: nextId(), name: "Grotto Weaver", type: "Monster", hp: 10, attack: "+4", damage: "1d6 piercing", special: "Web Shot." },
    { id: nextId(), name: "Bone Archer", type: "Monster", hp: 18, attack: "+3", damage: "1d8 piercing", special: "Bone Resilience." },
    { id: nextId(), name: "Caustic Sludge", type: "Monster", hp: 24, attack: "+3", damage: "1d8 acid", special: "Armor corrosion." },
];

module.exports = {
    itemCards,
    spellCards,
    monsterCards
};
