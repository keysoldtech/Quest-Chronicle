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

const npcDialogue = {
    explorer: {
        attack: [
            "Take this, you fiend!",
            "My blade finds its mark!",
            "For the light!",
            "Feel my wrath!",
            "You won't get past me!",
            "Another one for the count!",
            "Let's see how you like this!",
            "Taste steel!",
            "Go back to the shadows!",
            "This ends now!",
            "Feel my steel!",
            "Back to the abyss with you!",
            "Suffer my wrath!",
            "This is for my comrades!",
            "You have no place here!",
        ],
        heal: [
            "Hold on, friend, let me help you.",
            "Feel the light mend your wounds.",
            "By my power, you are healed!",
            "Stay with us! This should help.",
            "A small respite for you.",
            "The gods are with you!",
            "Your wounds are closing.",
            "Don't give up! I'm here.",
            "Let this magic restore you.",
            "You'll be back on your feet in no time.",
            "Let this light restore your strength.",
            "Your vitality returns!",
            "Do not falter! We are with you.",
            "May this aid your recovery.",
            "The magic flows through you, mending your injuries.",
        ],
        onHit: [
            "That one was close!",
            "I won't fall so easily!",
            "A mere scratch!",
            "Is that all you've got?",
            "You'll pay for that!",
            "I've had worse!",
            "A worthy blow, but not enough!",
            "It will take more than that to stop me!",
            "Gah! A lucky shot!",
            "My turn is coming...",
            "A lucky strike!",
            "I can take it!",
            "You'll regret that swing!",
            "Barely felt it!",
            "I'll return this pain tenfold!",
        ],
        utility: [ // New Category
            "Just the tool for the job!",
            "Let's see what this can do.",
            "A clever solution is needed here.",
            "This should even the odds.",
            "Time for a different approach.",
            "I have an idea!",
            "Let me handle this.",
        ]
    },
    dm: {
        worldEvent: [
            "A chill wind blows, bringing a strange scent...",
            "As you step into the forest, the trees seem to lean in, as if to listen.",
            "The ground trembles for a moment, then falls still.",
            "A strange, ethereal light filters through the canopy above.",
            "You hear a distant cry, half-animal, half-human.",
            "The air suddenly grows heavy, thick with unspoken magic.",
            "For a brief second, the world loses its color, turning to shades of gray.",
            "A forgotten melody drifts on the breeze, its source unknown.",
            "The shadows around you seem to deepen and writhe.",
            "An ancient stone nearby begins to hum with a low energy.",
            "A sudden silence falls over the area, the birdsong ceasing abruptly.",
            "The stars above seem to shift into an unfamiliar constellation.",
            "You feel a wave of unseen energy wash over you, leaving a tingling sensation on your skin.",
            "A disembodied whisper seems to echo in the back of your minds, speaking a language you don't understand.",
            "The temperature drops noticeably, and your breath mists in the air.",
            "A flock of black birds takes to the sky in a panic, fleeing from an unseen terror.",
            "The path ahead is suddenly obscured by a thick, rolling fog that appeared from nowhere.",
            "You all share a sudden, vivid vision of a forgotten king on a crumbling throne.",
            "The moon, though it is midday, briefly becomes visible in the sky.",
            "Water in your canteens ripples, despite no one touching them.",
        ],
        playMonster: [
            "From the shadows, a grotesque creature emerges!",
            "You are not alone. Something scuttles toward you...",
            "A roar echoes through the chamber as a beast reveals itself!",
            "The air grows cold as a monster appears before you.",
            "Disturbing the dust, a creature of nightmare lurches into view.",
            "Claws scrape on stone as a horror from the depths crawls into the light.",
            "You've disturbed something. It does not look pleased.",
            "A hulking silhouette blocks your path, its eyes glowing with malice.",
            "The stench of decay precedes a shambling monstrosity.",
            "Bursting from the ground, a creature of earth and rage confronts you!",
            "It unfolds itself from the darkness, a nightmare of claws and teeth.",
            "Your presence has awakened something ancient and hungry.",
            "A chittering sound echoes from the tunnel ahead before a swarm of creatures pours out.",
            "The ground splits open, and a chthonic horror claws its way into the world.",
            "It was not a statue. It was waiting. And now it moves.",
            "A low growl emanates from all around you before a massive beast pads into the light.",
            "The water in the pool churns, and a serpentine creature rises from the depths.",
            "With a sickening crunch of bone, a monstrosity pieced together from fallen warriors stands before you.",
            "You hear a faint giggling, and a small, malicious-looking creature peeks from behind a rock.",
            "This cave is not empty. You have trespassed, and its guardian has come to greet you.",
        ],
        monsterDefeated: [
            "The creature's last breath escapes it in a foul gasp.",
            "The beast falls silent, its reign of terror over.",
            "With a final shudder, the monster collapses into a lifeless heap.",
            "Your foe is vanquished, its dark presence fading from the world.",
            "Victory! The monster lies defeated at your feet.",
            "The monstrosity crumbles to dust, its evil unmade.",
            "A final, agonized cry, and then... silence.",
            "The threat is neutralized. You may proceed.",
            "The creature's lightless eyes stare blankly at the ceiling.",
            "You have overcome the challenge. The beast is no more.",
            "The foul energy that animated it dissipates, leaving only a husk.",
            "Its roar of defiance turns into a pathetic gurgle as it chokes on its own ichor.",
            "The ground is stained with its foul blood as the beast breathes its last.",
            "As it falls, the very air seems to lighten, cleansed of its presence.",
            "The monster's form dissolves into a pool of shimmering, foul-smelling liquid.",
            "Its grip on this world is broken. The creature is gone.",
            "A final, hateful glare, and the light fades from the monster's eyes.",
            "The battle is won. The chamber is quiet once more, save for your heavy breathing.",
            "With a deafening crash, the massive creature topples, shaking the very foundations of the room.",
            "The small, vicious creature gives one last squeal of fury before going still.",
        ],
        environment: [ 
            "The air here is damp and smells of moss and decay.",
            "A faint, rhythmic dripping sound echoes from somewhere deeper in the darkness.",
            "Ancient, faded murals cover the walls, depicting forgotten heroes and their deeds.",
            "The ground is littered with bones, both animal and, alarmingly, humanoid.",
            "A thick, unnatural fog clings to the floor, obscuring your vision.",
            "Torches on the walls flicker, casting long, dancing shadows.",
            "The silence in this chamber is heavy, almost suffocating.",
            "You enter a vast cavern, the ceiling lost in darkness above. The air is cold.",
            "Before you stands an ancient ruin, its stones crumbling with age and choked by vines.",
            "The clearing is eerily quiet, dominated by a single, massive dead tree at its center.",
            "The scent of ozone hangs in the air here, a sure sign of recent, powerful magic.",
        ]
    }
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

const playerEventCards = [
    { id: nextId(), name: "Sudden Vigor", type: "Player Event", description: "You feel a sudden surge of energy.", effect: { type: 'heal', dice: '2d6' } },
    { id: nextId(), name: "Momentary Weakness", type: "Player Event", description: "A wave of fatigue washes over you.", effect: { type: 'damage', dice: '1d6' } },
    { id: nextId(), name: "Cursed Ground", type: "Player Event", description: "The ground beneath you feels sticky and malevolent.", effect: { type: 'status', status: 'Slowed', duration: 2 } },
    { id: nextId(), name: "Flash of Insight", type: "Player Event", description: "Your mind clears, granting you a tactical advantage.", effect: { type: 'status', status: 'Guarded', duration: 1 } },
    { id: nextId(), name: "Bad Omen", type: "Player Event", description: "You feel a sense of dread, taking minor damage.", effect: { type: 'damage', dice: '1d4' } },
];

const discoveryCards = [
    // Tier 1
    { id: nextId(), name: "Sturdy Leather Armor", type: "Armor", tier: 1, effect: { description: "+3 Shield Bonus.", bonuses: { shield: 3, ap: 0 } } },
    { id: nextId(), name: "Serrated Shortsword", type: "Weapon", tier: 1, apCost: 1, effect: { type: 'damage', dice: "1d8+1", bonuses: { damage: 1 }, description: "A reliable and sharp blade." } },
    { id: nextId(), name: "Greater Healing Potion", type: "Potion", tier: 1, category: "Healing", apCost: 1, effect: { type: 'heal', dice: "4d4+4", target: 'any-explorer', description: "Restore 4d4 + 4 HP." } },

    // Tier 2
    { id: nextId(), name: "Elven Chainmail", type: "Armor", tier: 2, effect: { description: "+4 Shield Bonus, +1 AP.", bonuses: { shield: 4, ap: 1 } } },
    { id: nextId(), name: "Flaming Longsword", type: "Weapon", tier: 2, apCost: 1, effect: { type: 'damage', dice: "2d6", bonuses: { damage: 2 }, status: 'On Fire', duration: 1, description: "A blade wreathed in magical fire." } },
    { id: nextId(), name: "Scroll of Regeneration", type: "Scroll", tier: 2, category: "Healing", apCost: 1, effect: { type: 'heal', dice: "2d8+10", target: 'any-explorer', description: "Heals for a massive amount." } },

    // Tier 3
    { id: nextId(), name: "Dragonscale Plate", type: "Armor", tier: 3, effect: { description: "+6 Shield Bonus. Resistant to fire.", bonuses: { shield: 6, ap: 0 } } },
    { id: nextId(), name: "Stormcaller's Axe", type: "Weapon", tier: 3, apCost: 1, effect: { type: 'damage', dice: "2d10", bonuses: { damage: 3 }, status: 'Stunned', duration: 1, description: "An axe crackling with lightning." } },
    { id: nextId(), name: "Phoenix Down", type: "Consumable", tier: 3, category: "Utility", apCost: 2, effect: { type: 'utility', description: "Revives a fallen ally to full health and lives (conceptual)." } },
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
    npcDialogue,
    playerEventCards,
    discoveryCards,
};