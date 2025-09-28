// This file defines all static game data, including character classes, cards (items, spells, monsters, etc.),
// NPC dialogue, skill challenges, and other game constants. It is used exclusively by the server (`server.js`) to populate
// the game world and manage game mechanics. It is not sent to the client.

// This file contains the game data, structured for the server.

const classes = {
    Barbarian: { baseHp: 24, baseDamageBonus: 4, baseShieldBonus: 0, baseAp: 3, healthDice: 4, stats: { str: 4, dex: 1, con: 3, int: 0, wis: 0, cha: 1 }, description: "\"Unchecked Assault\" - Discard a spell to deal +6 damage, but lose 2 Shield Points." },
    Cleric:    { baseHp: 20, baseDamageBonus: 1, baseShieldBonus: 3, baseAp: 2, healthDice: 3, stats: { str: 1, dex: 0, con: 2, int: 1, wis: 4, cha: 2 }, description: "\"Divine Aid\" - Add 1d4 to an attack roll or saving throw." },
    Mage:      { baseHp: 18, baseDamageBonus: 1, baseShieldBonus: 2, baseAp: 2, healthDice: 2, stats: { str: 0, dex: 1, con: 1, int: 4, wis: 2, cha: 1 }, description: "\"Mystic Recall\" - Draw an additional spell card." },
    Ranger:    { baseHp: 20, baseDamageBonus: 2, baseShieldBonus: 2, baseAp: 2, healthDice: 3, stats: { str: 1, dex: 4, con: 2, int: 1, wis: 3, cha: 0 }, description: "\"Focused Shot\" - If range roll is exact, deal double damage." },
    Rogue:     { baseHp: 18, baseDamageBonus: 3, baseShieldBonus: 1, baseAp: 3, healthDice: 2, stats: { str: 1, dex: 4, con: 1, int: 2, wis: 0, cha: 3 }, description: "\"Opportunist Strike\" - If first spell is Close range, deal +2 damage." },
    Warrior:   { baseHp: 22, baseDamageBonus: 2, baseShieldBonus: 4, baseAp: 3, healthDice: 4, stats: { str: 3, dex: 2, con: 4, int: 0, wis: 1, cha: 1 }, description: "\"Weapon Surge\" - Discard a drawn spell card to add +4 to your damage." },
};

const statusEffectDefinitions = {
    'Poisoned': { trigger: 'start', damage: '1d4', description: 'Takes 1d4 damage at the start of their turn.' },
    'Stunned': { cannotAct: true, description: 'Cannot take actions.' },
    'On Fire': { trigger: 'start', damage: '1d6', description: 'Takes 1d6 damage at the start of their turn.'},
    'Guarded': { rollModifier: 2, description: 'Has +2 to defense rolls.'},
    'Slowed': { rollModifier: -2, description: 'Has -2 to all d20 rolls.'},
    'Drained': { description: 'Starts turn with -1 AP.' },
    'Inspired': { description: 'Feeling motivated, +2 to attack rolls.' },
};

const actionCosts = {
    briefRespite: 1,
    fullRest: 2,
    guard: 1
};

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
    { name: "Elixir of Restoration", type: "Potion", category: "Healing", apCost: 1, effect: { type: "heal", dice: "4d4+4", target: "any-explorer", description: "Restore 4d4 + 4 HP." } },
    { name: "Elixir of Restoration", type: "Potion", category: "Healing", apCost: 1, effect: { type: "heal", dice: "4d4+4", target: "any-explorer", description: "Restore 4d4 + 4 HP." } },
    { name: "Vial of Vitality", type: "Potion", category: "Healing", apCost: 1, effect: { type: "heal", dice: "2d4+2", target: "any-explorer", description: "Restore 2d4 + 2 HP." } },
    { name: "Vial of Vitality", type: "Potion", category: "Healing", apCost: 1, effect: { type: "heal", dice: "2d4+2", target: "any-explorer", description: "Restore 2d4 + 2 HP." } },
    { name: "Scroll of Healing Touch", type: "Scroll", category: "Healing", apCost: 1, effect: { type: "heal", dice: "1d8+5", target: "any-explorer", description: "Allows the user to cast the Healing Touch spell as if they were a spellcaster." } },
    { name: "Climber's Spikes", type: "Utility", category: "Utility", apCost: 0, effect: { type: "utility", description: "Provides advantage on difficult Strength (Athletics) or Dexterity (Acrobatics) checks for climbing." } },
    { name: "Lockpicks & Shims", type: "Utility", category: "Utility", apCost: 0, effect: { type: "utility", description: "Provides advantage on Skill Challenges related to picking locks or disarming simple traps." } },
];
const spellCards = [
    { name: "Acid Burst", type: "Spell", class: ["Mage"], category: "Damage", apCost: 1, effect: { type: "damage", dice: "1d6", target: "any-monster", description: "Deals 1d6 acid damage in a 5-foot radius sphere." } },
    { name: "Cinder Shot", type: "Spell", class: ["Mage"], category: "Damage", apCost: 1, effect: { type: "damage", dice: "1d10", target: "any-monster", description: "Deals 1d10 fire damage." } },
    { name: "Force Barrier", type: "Spell", class: ["Mage", "Warrior"], category: "Utility", apCost: 1, effect: { type: "utility", status: "Guarded", duration: 2, target: "self", description: "Increase your Shield Points by 5 until your next turn." } },
    { name: "Frost Beam", type: "Spell", class: ["Mage", "Ranger"], category: "Damage", apCost: 1, effect: { type: "damage", dice: "1d8", status: "Slowed", duration: 1, target: "any-monster", description: "Deals 1d8 cold damage and slows target." } },
    { name: "Healing Touch", type: "Spell", class: ["Cleric", "Ranger"], category: "Healing", apCost: 1, effect: { type: "heal", dice: "1d8+5", target: "any-explorer", description: "Heals 1d8 + 5 HP." } },
    { name: "Inspire Allies", type: "Spell", class: ["Cleric", "Warrior", "Barbarian"], category: "Utility", apCost: 1, effect: { type: "utility", target: "all-explorers", statusToApply: { name: 'Inspired', type: 'stat_modifier', bonuses: { damageBonus: 2 }, duration: 2 }, description: "All explorers gain a +2 bonus to their attack rolls for 1 round." } },
    { name: "Radiant Strike", type: "Spell", class: ["Cleric"], category: "Damage", apCost: 1, effect: { type: "damage", dice: "4d6", target: "any-monster", description: "Deals 4d6 radiant damage." } },
    { name: "Immobilize Foe", type: "Spell", class: ["Mage", "Cleric"], category: "Utility", apCost: 2, effect: { type: "utility", status: "Stunned", statusType: "stun", duration: 2, target: "any-monster", description: "A humanoid must make a Wisdom saving throw (DC 13) or be paralyzed." } },
    { name: "Inferno Rays", type: "Spell", class: ["Mage"], category: "Damage", apCost: 2, effect: { type: "damage", dice: "2d6", target: "any-monster", description: "You create three rays of fire. Each ray deals 2d6 fire damage." } },
    { name: "Inferno Sphere", type: "Spell", class: ["Mage"], category: "Damage", apCost: 3, effect: { type: "damage", dice: "8d6", target: "any-monster", description: "Deals 8d6 fire damage in a 20-foot radius sphere." } },
];
const weaponCards = [
    { name: "Axechuck", type: "Weapon", class: ["Barbarian", "Ranger", "Warrior"], apCost: 2, effect: { type: "damage", dice: "1d6", description: "Thrown (20/60), Special: Returning Edge - Returns to hand at end of turn (If thrown and hand free)." } },
    { name: "Balanced Steel", type: "Weapon", class: ["Any"], apCost: 2, effect: { type: "damage", dice: "1d8", description: "Versatile (1d10), Special: Guard Breaker - Ignore 1 point of target's Shield Bonus." } },
    { name: "Bolt Sprinter", type: "Weapon", class: ["Ranger", "Rogue", "Warrior"], apCost: 2, effect: { type: "damage", dice: "1d8", description: "Ammunition, Loading, Special: Steady Aim - First attack on next turn deals +1d4 damage." } },
    { name: "Bone Thumper", type: "Weapon", class: ["Any"], apCost: 2, effect: { type: "damage", dice: "1d6", description: "Special: Solid Strike - Deal an additional 1 damage (When hitting target with Shield Bonus from armor, not shield)." } },
    { name: "Doomcleaver", type: "Weapon", class: ["Barbarian", "Warrior"], apCost: 2, effect: { type: "damage", dice: "2d6", critBonusDice: "1d6", description: "Two-Handed, Heavy, Special: Savage Chop - Make 1 additional melee attack vs same target (Natural 20 on attack roll)." } },
    { name: "Duelist's Point", type: "Weapon", class: ["Rogue", "Ranger"], apCost: 2, effect: { type: "damage", dice: "1d8", description: "Finesse, Special: Opening Flourish - First successful attack deals +1d4 damage." } },
    { name: "Farstrike Bow", type: "Weapon", class: ["Ranger", "Warrior"], apCost: 2, effect: { type: "damage", dice: "1d8", description: "Ammunition, Heavy, Two-Handed, Special: Piercing Shot - +1 Attack Roll but ignore 1 point of target's Shield Bonus." } },
    { name: "Quick Blade", type: "Weapon", class: ["Rogue"], apCost: 1, effect: { type: "damage", dice: "1d6", description: "Finesse, Special: Fluid Motion - Can use Break Away for 0 AP (If make two attacks with this weapon on turn)." } },
    { name: "Shadowtooth", type: "Weapon", class: ["Rogue"], apCost: 1, effect: { type: "damage", dice: "1d4", description: "Finesse, Thrown (20/60), Special: Poison Ready - Advantage on attack roll when applying poison." } },
    { name: "Swiftflight Bow", type: "Weapon", class: ["Ranger"], apCost: 2, effect: { type: "damage", dice: "1d6", description: "Ammunition, Close-Range Penalty (-1d4 damage when attacking Close enemy)." } },
];
const armorCards = [
    { name: "Arcanist's Weave", type: "Armor", class: ["Mage", "Cleric"], effect: { bonuses: { shieldBonus: 2, ap: 2 }, description: "+1 to Magic Resistance." } },
    { name: "Bastion Shield", type: "Armor", class: ["Warrior", "Cleric"], effect: { bonuses: { shieldBonus: 3, ap: -1 }, description: "Provides cover to adjacent allies." } },
    { name: "Crystal Hide", type: "Armor", class: ["Warrior", "Barbarian"], effect: { bonuses: { shieldBonus: 6, ap: 0 }, description: "Resistance to non-magical damage." } },
    { name: "Earth-Forged Mail", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 7, ap: -1 }, description: "Resistance to Bludgeoning damage." } },
    { name: "Fury Cuirass", type: "Armor", class: ["Barbarian", "Warrior"], effect: { bonuses: { shieldBonus: 6, ap: 1 }, description: "While below half health, gain +1 to attack rolls." } },
    { name: "Hide Vest", type: "Armor", class: ["Any"], effect: { bonuses: { shieldBonus: 2, ap: 1 }, description: "Light and flexible." } },
    { name: "Indomitable Plating", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 10, ap: -2 }, description: "Ignores the first point of damage from any attack." } },
    { name: "Ironclad Harness", type: "Armor", class: ["Warrior"], effect: { bonuses: { shieldBonus: 8, ap: -1 }, description: "Complete coverage in heavy metal." } },
    { name: "Nightfall Shroud", type: "Armor", class: ["Rogue", "Ranger"], effect: { bonuses: { shieldBonus: 1, ap: 3 }, description: "Advantage on Stealth checks." } },
    { name: "Phase Shroud", type: "Armor", class: ["Mage", "Rogue"], effect: { bonuses: { shieldBonus: 5, ap: 0 }, description: "Once per turn, may force an attacker to reroll their attack roll." } },
];
const worldEventCards = [
    { name: "Crimson Orb", type: "World Event", tags: "Celestial", outcome: "The moon bleeds red, its eerie glow stirring unease and dark dreams.", saveInfo: { save: "Wisdom", dc: 12, effectOnFail: "Gain 1 level of exhaustion." } },
    { name: "Sky Scourge", type: "World Event", tags: "Celestial", outcome: "Bolts of fire pierce the atmosphere, threatening to fall with destructive force.", saveInfo: { save: "Dexterity", dc: 15, effectOnFail: "Take 2d6 bludgeoning damage." } },
    { name: "Sun Eater", type: "World Event", tags: "Celestial", outcome: "A creeping shadow consumes the sun, plunging the world into an unnatural, foreboding twilight.", saveInfo: { save: "Constitution", dc: 11, effectOnFail: "Disadvantage on attack rolls for one hour." } },
    { name: "Groundswell Tremor", type: "World Event", tags: "Hazard", outcome: "A low rumble builds to a violent shake, sending cracks through the earth.", saveInfo: { save: "Dexterity", dc: 13, effectOnFail: "Take 1d6 bludgeoning damage and are knocked prone." } },
    { name: "Arcane Flux", type: "World Event", tags: "Magical", outcome: "The air crackles with raw magic, and reality seems to twist and bend.", saveInfo: { save: "None", dc: 0, effectOnFail: "" } },
];
const playerEventCards = [
    { name: "A Moment of Clarity", type: "Player Event", outcome: "Success: A puzzling mystery becomes clear. Failure: The mystery becomes more confusing.", effect: { name: "Insight", type: "utility", duration: 1 } },
    { name: "Divine Favor", type: "Player Event", outcome: "Success: You gain a blessing (DM's choice). Failure: You attract the attention of a devious entity.", effect: { name: "Blessing", type: "utility", duration: 1 } },
    { name: "Renewed Vigor", type: "Player Event", outcome: "Success: You recover 1d4 hit points. Failure: You gain 1 level of exhaustion.", effect: { name: "Vigor", type: "utility", duration: 1 } },
    { name: "Equipment Malfunction", type: "Player Event", outcome: "Success: You fix the problem quickly. Failure: A piece of your equipment breaks or becomes unusable.", effect: { name: "Malfunction", type: "utility", duration: 1 } },
    { name: "Frightening Vision", type: "Player Event", outcome: "Success: You shake off the vision. Failure: You are frightened for 1d4 rounds.", effect: { name: "Fear", type: "utility", duration: 1 } },
];
const partyEventCards = [
    { name: "Ailment Cleansed", type: "Party Event", outcome: "You are cured of one condition (blinded, deafened, paralyzed, poisoned, or stunned).", effect: { type: "utility" } },
    { name: "Endurance Test", type: "Party Event", outcome: "Success: You recover 1d4 hit points. Failure: You gain 1 level of exhaustion.", effect: { type: "heal", dice: "1d4" } },
    { name: "Fortunate Discovery", type: "Party Event", outcome: "Success: You find a valuable item (GM's choice). Failure: You find nothing of value.", effect: { type: "utility" } },
    { name: "Moment of Grace", type: "Party Event", outcome: "The next ability check, attack roll, or saving throw you make is rolled with advantage.", effect: { type: "utility" } },
];

const allMonsters = [
    { name: "Phantom Light", tier: 1, primaryType: "Undead", type: "Monster", maxHp: 5, requiredRollToHit: 12, attackBonus: 2, ap: 1, effect: { type: "damage", dice: "1d8", description: "Incorporeal Movement. Proximity damage." } },
    { name: "Ember Flicker", tier: 1, primaryType: "Elemental", type: "Monster", maxHp: 6, requiredRollToHit: 12, attackBonus: 4, ap: 2, effect: { type: "damage", dice: "1d10", description: "On miss: Ignite (DC 12 DEX save or catch fire, 1d4 fire/turn)." } },
    { name: "Pestie Prowler", tier: 1, primaryType: "Humanoid", type: "Monster", maxHp: 7, requiredRollToHit: 10, attackBonus: 8, ap: 2, effect: { type: "damage", dice: "1d6", description: "Sneaky Escape — Dex roll (DC 12) to flee if ≤ 3 HP." } },
    { name: "Pestie Pilferer", tier: 1, primaryType: "Humanoid", type: "Monster", maxHp: 8, requiredRollToHit: 12, attackBonus: 4, ap: 2, effect: { type: "damage", dice: "1d6+2", description: "Quick Feet (Can Break Away as a bonus action.)." } },
    { name: "Grotto Weaver", tier: 1, primaryType: "Beast", type: "Monster", maxHp: 10, requiredRollToHit: 12, attackBonus: 6, ap: 2, effect: { type: "damage", dice: "1d6", description: "Web Shot (DC 10 Strength save to escape)." } },
    { name: "Flutterwing Swarm", tier: 1, primaryType: "Beast", type: "Monster", maxHp: 10, requiredRollToHit: 12, attackBonus: 4, ap: 2, effect: { type: "damage", dice: "2d4", description: "Blind Flight (Immune to blindness conditions.)." } },
    { name: "Pestie Whisperer", tier: 1, primaryType: "Humanoid", type: "Monster", maxHp: 10, requiredRollToHit: 12, attackBonus: 3, ap: 2, effect: { type: "damage", dice: "1d4", description: "Tribal Magic (+2 attack for pesties)." } },
    { name: "Scale-kin Skulker", tier: 1, primaryType: "Humanoid", type: "Monster", maxHp: 10, requiredRollToHit: 12, attackBonus: 2, ap: 2, effect: { type: "damage", dice: "1d4+1", description: "Trap Master (Sets a trap at start of combat)." } },
    { name: "Essence Thief", tier: 1, primaryType: "Undead", type: "Monster", maxHp: 15, requiredRollToHit: 12, attackBonus: 4, ap: 2, effect: { type: "damage", dice: "2d6", description: "Incorporeal." } },
    { name: "Bone Archer", tier: 1, primaryType: "Undead", type: "Monster", maxHp: 18, requiredRollToHit: 12, attackBonus: 3, ap: 2, effect: { type: "damage", dice: "1d8", description: "Bone Resilience (Immune to poison and charm.)." } },
    { name: "Veiled Fanatic", tier: 1, primaryType: "Humanoid", type: "Monster", maxHp: 20, requiredRollToHit: 12, attackBonus: 5, ap: 2, effect: { type: "damage", dice: "1d4+3", description: "Unholy Fervor (Can re-roll a failed saving throw)." } },
    { name: "Striped Marauder", tier: 1, primaryType: "Humanoid", type: "Monster", maxHp: 23, requiredRollToHit: 12, attackBonus: 4, ap: 3, effect: { type: "damage", dice: "1d8+2", description: "Rampage (Make another attack on kill)." } },
    { name: "Segmented Horror", tier: 1, primaryType: "Beast", type: "Monster", maxHp: 24, requiredRollToHit: 12, attackBonus: 5, ap: 3, effect: { type: "damage", dice: "1d4+3", description: "Wall Climber." } },
    { name: "Stonegaze Wyrmlet", tier: 1, primaryType: "Monstrosity", type: "Monster", maxHp: 24, requiredRollToHit: 12, attackBonus: 4, ap: 3, effect: { type: "damage", dice: "1d6+2", description: "Petrification Gaze (DC 12 CON save or petrified)" } },
    { name: "Caustic Sludge", tier: 1, primaryType: "Ooze", type: "Monster", maxHp: 24, requiredRollToHit: 12, attackBonus: 3, ap: 2, effect: { type: "damage", dice: "1d8", description: "Split on Lightning." } },
    { name: "Sky Lurer", tier: 2, primaryType: "Monstrosity", type: "Monster", maxHp: 27, requiredRollToHit: 12, attackBonus: 4, ap: 3, effect: { type: "damage", dice: "1d6+1", description: "Swooping Attack." } },
    { name: "Highway Scourge", tier: 2, primaryType: "Humanoid", type: "Monster", maxHp: 28, requiredRollToHit: 12, attackBonus: 6, ap: 3, effect: { type: "damage", dice: "2d6+3", description: "Shout (+1 attack for allies)." } },
    { name: "Ruined Sentinel", tier: 2, primaryType: "Construct", type: "Monster", maxHp: 33, requiredRollToHit: 13, attackBonus: 6, ap: 3, effect: { type: "damage", dice: "2d8", description: "Magic Resistance." } },
    { name: "Shadowmaw Alpha", tier: 2, primaryType: "Beast", type: "Monster", maxHp: 34, requiredRollToHit: 13, attackBonus: 5, ap: 3, effect: { type: "damage", dice: "2d6+2", description: "Pack Tactics." } },
    { name: "Stone Wing", tier: 2, primaryType: "Monstrosity", type: "Monster", maxHp: 35, requiredRollToHit: 13, attackBonus: 5, ap: 3, effect: { type: "damage", dice: "1d6+3", description: "Stone Form." } },
    { name: "Haunted Cuirass", tier: 2, primaryType: "Construct", type: "Monster", maxHp: 41, requiredRollToHit: 13, attackBonus: 4, ap: 3, effect: { type: "damage", dice: "2d6", description: "Unyielding Form (Immune to poison, fear)." } },
    { name: "Greenskin Mauler", tier: 2, primaryType: "Humanoid", type: "Monster", maxHp: 44, requiredRollToHit: 14, attackBonus: 5, ap: 3, effect: { type: "damage", dice: "1d12+3", description: "Relentless Endurance (Survives at 1 HP)." } },
    { name: "Spectral Corruptor", tier: 2, primaryType: "Undead", type: "Monster", maxHp: 45, requiredRollToHit: 14, attackBonus: 6, ap: 3, effect: { type: "damage", dice: "3d6", description: "Incorporeal Passage." } },
    { name: "Axehorn Brute", tier: 2, primaryType: "Monstrosity", type: "Monster", maxHp: 55, requiredRollToHit: 14, attackBonus: 7, ap: 4, effect: { type: "damage", dice: "2d12+4", description: "Labyrinthine Recall." } },
    { name: "Briar Witch", tier: 2, primaryType: "Humanoid", type: "Monster", maxHp: 59, requiredRollToHit: 14, attackBonus: 5, ap: 4, effect: { type: "damage", dice: "2d6", description: "Cackle of Madness (Confuse enemies)." } },
    { name: "Wrapped Ancient", tier: 2, primaryType: "Undead", type: "Monster", maxHp: 60, requiredRollToHit: 14, attackBonus: 5, ap: 4, effect: { type: "damage", dice: "2d6+3", description: "Undead Fortitude (Can drop to 1 HP)." } },
    { name: "Watery Charmer", tier: 3, primaryType: "Elemental", type: "Monster", maxHp: 63, requiredRollToHit: 14, attackBonus: 6, ap: 4, effect: { type: "damage", dice: "1d6+3", description: "Captivating Song (Charmed)." } },
    { name: "Hill Oaf", tier: 3, primaryType: "Humanoid", type: "Monster", maxHp: 64, requiredRollToHit: 15, attackBonus: 6, ap: 4, effect: { type: "damage", dice: "2d8+4", description: "Powerful Blow (+2 damage)." } },
    { name: "Deathlord Marshal", tier: 3, primaryType: "Undead", type: "Monster", maxHp: 78, requiredRollToHit: 15, attackBonus: 7, ap: 4, effect: { type: "damage", dice: "3d6+4", description: "Unholy Endurance (Can rise with 10 HP)." } },
    { name: "Earth Colossus", tier: 3, primaryType: "Construct", type: "Monster", maxHp: 112, requiredRollToHit: 16, attackBonus: 8, ap: 5, effect: { type: "damage", dice: "2d10+5", description: "Immutable Form." } },
    { name: "Winter Juggernaut", tier: 3, primaryType: "Construct", type: "Monster", maxHp: 130, requiredRollToHit: 17, attackBonus: 9, ap: 5, effect: { type: "damage", dice: "3d12+6", description: "Icy Aura (Deals cold damage)." } },
    { name: "Hellfire Sovereign", tier: 3, primaryType: "Elemental", type: "Monster", maxHp: 195, requiredRollToHit: 18, attackBonus: 9, ap: 6, effect: { type: "damage", dice: "4d6+5", description: "Hellish Regeneration." } },
    { name: "Rotwood Behemoth", tier: 3, primaryType: "Beast", type: "Monster", maxHp: 214, requiredRollToHit: 18, attackBonus: 8, ap: 6, effect: { type: "damage", dice: "3d8+4", description: "Rooted Horror (difficult terrain)." } },
];

const monsterTiers = {
    tier1: allMonsters.filter(m => m.tier === 1),
    tier2: allMonsters.filter(m => m.tier === 2),
    tier3: allMonsters.filter(m => m.tier === 3),
};

module.exports = {
  classes,
  itemCards,
  spellCards,
  monsterTiers,
  weaponCards,
  armorCards,
  worldEventCards,
  playerEventCards,
  partyEventCards,
  statusEffectDefinitions,
  npcDialogue,
  skillChallenges,
  actionCosts,
  magicalAffixes,
};