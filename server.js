// This file is the main Node.js server for the Quest & Chronicle application.
// It uses Express to serve the static frontend files (HTML, CSS, JS) from the 'public' directory
// and uses Socket.IO for real-time, event-based communication to manage the multiplayer game logic.

// --- INDEX ---
// 1. SERVER SETUP
// 2. HELPER FUNCTIONS
// 3. GAME STATE MANAGEMENT (GameManager Class)
//    - 3.1. Constructor & Core Utilities
//    - 3.2. Room & Player Management
//    - 3.3. Game Lifecycle (Create, Join, Start)
//    - 3.4. Player Setup (Class, Stats, Cards)
//    - 3.5. Turn Management
//    - 3.6. AI Logic (NPC Turns) & Event Triggers
//    - 3.7. Action Resolution (Attacks, Abilities, etc.)
//    - 3.8. Loot & Item Generation
//    - 3.9. Event & Challenge Handling
//    - 3.10. Chat & Disconnect Logic
// 4. SOCKET.IO CONNECTION HANDLING

// --- 1. SERVER SETUP ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const gameData = require('./game-data'); // Import card and class data

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Create a lookup map for all cards for efficient access
const allCards = [
    ...gameData.itemCards,
    ...gameData.spellCards,
    ...gameData.weaponCards,
    ...gameData.armorCards
];
const cardDataMap = allCards.reduce((map, card) => {
    map[card.name] = card;
    return map;
}, {});

// --- 2. HELPER FUNCTIONS ---
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- 3. GAME STATE MANAGEMENT (GameManager Class) ---
class GameManager {
    // --- 3.1. Constructor & Core Utilities ---
    constructor() {
        this.rooms = {};
        this.socketToRoom = {}; // Maps socket.id to roomId for efficient lookups
        this.cardIdCounter = 1000; // Start card IDs high to avoid collision with data file
    }

    findRoomBySocket(socket) {
        const roomId = this.socketToRoom[socket.id];
        return this.rooms[roomId];
    }
    
    // The single point of emission for game state, ensuring clients are always in sync.
    emitGameState(roomId) {
        if (this.rooms[roomId]) {
            const stateWithStaticData = {
                ...this.rooms[roomId],
                staticData: { // We only need to send static data once, but this is simple for now
                    classes: gameData.classes
                }
            };
            io.to(roomId).emit('gameStateUpdate', stateWithStaticData);
        }
    }

    generateRoomId() {
        let roomId;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        do {
            roomId = '';
            for (let i = 0; i < 4; i++) {
                roomId += chars.charAt(Math.floor(Math.random() * chars.length));
            }
        } while (this.rooms[roomId]);
        return roomId;
    }
    
    generateUniqueCardId() {
        this.cardIdCounter++;
        return `card-${this.cardIdCounter}`;
    }
    
    rollDice(diceString) {
        if (!diceString || typeof diceString !== 'string') return 0;
        if (!diceString.includes('d')) {
            const val = Number(diceString);
            return isNaN(val) ? 0 : val;
        }
        const [count, sides] = diceString.toLowerCase().split('d').map(Number);
        if (isNaN(count) || isNaN(sides)) return 0;
        let total = 0;
        for (let i = 0; i < count; i++) {
            total += Math.floor(Math.random() * sides) + 1;
        }
        return total;
    }

    // --- 3.2. Room & Player Management ---
    createPlayerObject(id, name) {
        const playerId = `player_${Math.random().toString(36).substr(2, 9)}`;
        return {
            id, // Socket ID
            playerId, // Persistent ID for reconnection
            name,
            isNpc: false,
            isDowned: false,
            disconnected: false,
            cleanupTimer: null,
            role: null,
            class: null,
            stats: { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, maxAP: 0, shieldHp: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
            baseStats: {},
            statBonuses: {},
            currentAp: 0,
            hand: [],
            equipment: { weapon: null, armor: null },
            statusEffects: [],
            usedAbilityThisTurn: false,
        };
    }

    createRoom(socket, { playerName, gameMode, customSettings }) {
        const newPlayer = this.createPlayerObject(socket.id, playerName);
        const newRoomId = this.generateRoomId();
    
        const defaultSettings = {
            startWithWeapon: true, startWithArmor: true, startingItems: 2, 
            startingSpells: 2, lootDropRate: 80, maxHandSize: 7
        };
    
        const newRoom = {
            id: newRoomId,
            hostId: socket.id,
            players: { [socket.id]: newPlayer },
            settings: { ...defaultSettings, ...(customSettings || {}) },
            gameState: {
                phase: 'class_selection',
                gameMode: gameMode || 'Beginner',
                winner: null,
                decks: {},
                discardPile: [],
                turnOrder: [],
                currentPlayerIndex: -1,
                board: { monsters: [] },
                lootPool: [],
                turnCount: 0,
                worldEvents: { currentEvent: null, duration: 0 },
                currentPartyEvent: null,
                skillChallenge: { isActive: false, details: null },
            },
            chatLog: []
        };
    
        newPlayer.role = 'Explorer';
        this.rooms[newRoomId] = newRoom;
        socket.join(newRoomId);
        this.socketToRoom[socket.id] = newRoomId;
    
        socket.emit('playerIdentity', { playerId: newPlayer.playerId, roomId: newRoomId });
        this.emitGameState(newRoomId);
    }
    
    joinRoom(socket, { roomId, playerName }) {
        const room = this.rooms[roomId];
        if (!room) return socket.emit('actionError', 'Room not found.');
    
        const isGameInProgress = room.gameState.phase !== 'class_selection';
        const humanPlayersCount = Object.values(room.players).filter(p => !p.isNpc).length;
    
        if (isGameInProgress) return socket.emit('actionError', 'Game is already in progress.');
    
        const MAX_PLAYERS = 4;
        if (humanPlayersCount >= MAX_PLAYERS) return socket.emit('actionError', 'This game lobby is full.');
    
        const newPlayer = this.createPlayerObject(socket.id, playerName);
        newPlayer.role = 'Explorer';
        room.players[socket.id] = newPlayer;
        socket.join(roomId);
        this.socketToRoom[socket.id] = roomId;
        
        socket.emit('playerIdentity', { playerId: newPlayer.playerId, roomId: roomId });
        this.emitGameState(roomId);
    }

    // --- 3.3. Game Lifecycle ---
    chooseClass(socket, { classId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player || player.class) return;

        this.assignClassToPlayer(player, classId);
        this.createNpcs(room); // Adds DM and other explorers
        this.initializeDecks(room);

        // Deal starting cards to all explorers (human and NPC)
        Object.values(room.players).filter(p => p.role === 'Explorer').forEach(p => {
            this.dealStartingLoadout(room, p);
        });
        
        // Finalize stats and set initial health/AP for everyone
        Object.values(room.players).forEach(p => {
            p.stats = this.calculatePlayerStats(p);
            p.stats.currentHp = p.stats.maxHp;
            p.currentAp = p.stats.ap;
        });

        const dmId = 'npc-dm';
        const humanPlayerId = socket.id;
        const npcExplorerIds = Object.keys(room.players).filter(id => room.players[id].isNpc && room.players[id].role === 'Explorer');
        
        room.gameState.turnOrder = [dmId, humanPlayerId, ...shuffle(npcExplorerIds)];
        room.gameState.currentPlayerIndex = -1;
        room.gameState.phase = 'started';
        room.gameState.turnCount = 0;

        // Start the first turn sequence
        this.endCurrentTurn(room.id);
    }
    
    createNpcs(room) {
        const dmNpc = this.createPlayerObject('npc-dm', 'DM');
        dmNpc.role = 'DM';
        dmNpc.isNpc = true;
        room.players[dmNpc.id] = dmNpc;

        const npcNames = ["Grok", "Lyra", "Finn"];
        const availableClasses = Object.keys(gameData.classes);
        for (const name of npcNames) {
            const npcId = `npc-${name.toLowerCase()}`;
            const npc = this.createPlayerObject(npcId, name);
            npc.isNpc = true;
            npc.role = 'Explorer';
            const randomClassId = availableClasses[Math.floor(Math.random() * availableClasses.length)];
            this.assignClassToPlayer(npc, randomClassId);
            room.players[npc.id] = npc;
        }
    }

    initializeDecks(room) {
        // Helper to ensure all cards get a unique, server-assigned ID.
        const createDeck = (cardArray) => cardArray.map(c => ({ ...c, id: this.generateUniqueCardId() }));
        
        room.gameState.decks = {
            item: shuffle(createDeck(gameData.itemCards)),
            spell: shuffle(createDeck(gameData.spellCards)),
            weapon: shuffle(createDeck(gameData.weaponCards)),
            armor: shuffle(createDeck(gameData.armorCards)),
            worldEvent: shuffle(createDeck(gameData.worldEventCards)),
            partyEvent: shuffle(createDeck(gameData.partyEventCards)),
            monster: {
                tier1: shuffle(createDeck(gameData.monsterTiers.tier1)),
                tier2: shuffle(createDeck(gameData.monsterTiers.tier2)),
                tier3: shuffle(createDeck(gameData.monsterTiers.tier3)),
            }
        };
        // The treasure deck is a combined pool for generating magical loot.
        room.gameState.decks.treasure = shuffle([...gameData.weaponCards, ...gameData.armorCards]);
    }

    // Handles giving a card to a player, accounting for hand size limits.
    _giveCardToPlayer(room, player, card) {
        if (!card) return;
    
        if (player.hand.length >= room.settings.maxHandSize) {
            if (player.isNpc) {
                // NPC LOGIC: Automatically discard the oldest card (at index 0) to make room.
                const discardedCard = player.hand.shift();
                room.gameState.discardPile.push(discardedCard);
                player.hand.push(card);
                 room.chatLog.push({ type: 'system', text: `${player.name}'s hand was full. Discarded ${discardedCard.name} for ${card.name}.` });

            } else {
                const playerSocket = io.sockets.sockets.get(player.id);
                if (playerSocket) {
                    // HUMAN LOGIC: Prompt connected player to choose.
                    playerSocket.emit('chooseToDiscard', { newCard: card, currentHand: player.hand });
                } else {
                    // Fallback for disconnected humans: Discard the new card to prevent game stall.
                    room.gameState.discardPile.push(card);
                    room.chatLog.push({ type: 'system', text: `${player.name}'s hand was full and they are disconnected. '${card.name}' was discarded.` });
                }
            }
        } else {
            player.hand.push(card);
        }
    }

    dealStartingLoadout(room, player) {
        const { settings } = room;
        
        // Equips a weapon/armor directly from the class-appropriate deck.
        const dealAndEquip = (type) => {
            const card = this.drawCardFromDeck(room.id, type, player.class);
            if (card) player.equipment[type] = card;
        };
    
        if (settings.startWithWeapon) dealAndEquip('weapon');
        if (settings.startWithArmor) dealAndEquip('armor');
    
        // Give player starting items from the item deck based on settings
        for (let i = 0; i < (settings.startingItems || 0); i++) {
            const card = this.drawCardFromDeck(room.id, 'item');
            if (card) this._giveCardToPlayer(room, player, card);
        }
    
        // Give player starting spells from the spell deck based on settings
        for (let i = 0; i < (settings.startingSpells || 0); i++) {
            const card = this.drawCardFromDeck(room.id, 'spell');
            if (card) this._giveCardToPlayer(room, player, card);
        }
    }

    drawCardFromDeck(roomId, deckName, playerClass = null) {
        const room = this.rooms[roomId];
        if (!room) return null;

        let deck;
        // Allows drawing from nested decks like 'monster.tier1'
        if (deckName.includes('.')) {
            const [parent, child] = deckName.split('.');
            deck = room.gameState.decks[parent]?.[child];
        } else {
            deck = room.gameState.decks[deckName];
        }

        if (!deck || deck.length === 0) return null;
        
        let cardToDraw;
        // For weapons/armor, try to find a class-appropriate item first.
        if (playerClass && (deckName === 'weapon' || deckName === 'armor')) {
            const suitableCardIndex = deck.findIndex(card => !card.class || card.class.includes("Any") || card.class.includes(playerClass));
            if (suitableCardIndex !== -1) {
                cardToDraw = deck.splice(suitableCardIndex, 1)[0];
            } else {
                cardToDraw = deck.pop(); // Fallback to any card if no specific one is found
            }
        } else {
            cardToDraw = deck.pop();
        }
        
        return JSON.parse(JSON.stringify(cardToDraw)); // Return a deep copy
    }

    // --- 3.4. Player Setup ---
    assignClassToPlayer(player, classId) {
        const classData = gameData.classes[classId];
        if (!classData || !player) return;
        player.class = classId;
        player.stats = this.calculatePlayerStats(player);
    }
    
    /**
     * Recalculates all of a player's stats from scratch.
     * This is the single source of truth for player stats, called whenever equipment or status effects change.
     * Order of operations: Class Base Stats -> Equipment Bonuses -> Status Effect Bonuses.
     */
    calculatePlayerStats(player) {
        const initialStats = { maxHp: 0, currentHp: player.stats.currentHp || 0, damageBonus: 0, shieldBonus: 0, ap: 0, maxAP: 0, shieldHp: player.stats.shieldHp || 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, hitBonus: 0 };
        if (!player.class) {
            player.baseStats = {};
            player.statBonuses = {};
            return initialStats;
        }
    
        const classData = gameData.classes[player.class];
        const baseStats = { ...classData.stats, maxHp: classData.baseHp, damageBonus: classData.baseDamageBonus, shieldBonus: classData.baseShieldBonus, ap: classData.baseAP, hitBonus: 0 };
        player.baseStats = baseStats;
    
        const bonuses = { maxHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0, hitBonus: 0 };
    
        // 1. Add bonuses from equipped items
        for (const item of Object.values(player.equipment)) {
            if (item?.effect?.bonuses) {
                Object.keys(item.effect.bonuses).forEach(key => {
                    bonuses[key] = (bonuses[key] || 0) + item.effect.bonuses[key];
                });
            }
        }
        
        // 2. Add bonuses from active status effects
        for (const effect of player.statusEffects) {
            if (effect.bonuses) {
                Object.keys(effect.bonuses).forEach(key => {
                    bonuses[key] = (bonuses[key] || 0) + effect.bonuses[key];
                });
            }
        }
        player.statBonuses = bonuses;
    
        // 3. Sum base stats and all bonuses for the final stats
        const totalStats = {};
        const allStatKeys = new Set([...Object.keys(baseStats), ...Object.keys(bonuses)]);
        
        allStatKeys.forEach(key => {
            totalStats[key] = (baseStats[key] || 0) + (bonuses[key] || 0);
        });
    
        totalStats.maxAP = totalStats.ap;
        totalStats.currentHp = player.stats.currentHp > 0 ? Math.min(player.stats.currentHp, totalStats.maxHp) : totalStats.maxHp;
        totalStats.shieldHp = player.stats.shieldHp || 0;
    
        return totalStats;
    }

    equipItem(socket, { cardId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player || player.isDowned) return;

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;

        // Equip cost: 1 AP during combat
        if (room.gameState.phase === 'started' && player.currentAp < 1) {
            return socket.emit('actionError', 'Not enough AP to equip an item.');
        }
        
        const cardToEquip = player.hand[cardIndex];
        const itemType = cardToEquip.type.toLowerCase();

        if (itemType !== 'weapon' && itemType !== 'armor') return;
        
        // Deduct AP if in combat
        if (room.gameState.phase === 'started') {
            player.currentAp -= 1;
        }

        // Swap item from hand to equipment slot, moving old item back to hand.
        player.hand.splice(cardIndex, 1);
        if (player.equipment[itemType]) {
            this._giveCardToPlayer(room, player, player.equipment[itemType]);
        }
        
        player.equipment[itemType] = cardToEquip;
        player.stats = this.calculatePlayerStats(player); // Recalculate stats with new item
        this.emitGameState(room.id);
    }
    
    // --- 3.5. Turn Management ---
    async startTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.phase !== 'started') return;
    
        const player = room.players[room.gameState.turnOrder[room.gameState.currentPlayerIndex]];
        if (!player) return;
    
        // Refresh stats and AP at the start of the turn.
        player.stats = this.calculatePlayerStats(player);
        player.currentAp = player.stats.maxAP;
        player.usedAbilityThisTurn = false;
    
        // If there's an active world event, activate the skill challenge phase for the player
        if (room.gameState.worldEvents.currentEvent?.eventType === 'skill_challenge') {
            room.gameState.skillChallenge = {
                isActive: true,
                details: room.gameState.worldEvents.currentEvent
            };
        }

        this.emitGameState(roomId);
    
        // If the current player is an NPC, trigger their AI logic.
        if (player.isNpc) {
            await new Promise(res => setTimeout(res, 1500)); // Pause for dramatic effect
            if (player.role === 'DM') {
                await this.handleDmTurn(room);
            } else {
                await this.handleNpcExplorerTurn(room, player);
            }
            // End the NPC's turn automatically after they've acted.
            if(room.gameState.phase === 'started') {
                this.endCurrentTurn(roomId);
            }
        }
    }

    endTurn(socket) {
        const room = this.findRoomBySocket(socket);
        if (!room) return;
        const player = room.players[socket.id];
        // Ensure the player ending the turn is the current active player.
        if (!player || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== player.id) {
            return socket.emit('actionError', "It's not your turn.");
        }
        
        this.endCurrentTurn(room.id);
    }
    
    endCurrentTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.turnOrder.length === 0 || room.gameState.phase !== 'started') return;
    
        // --- End-of-Turn Cleanup Phase ---
        const oldPlayerIndex = room.gameState.currentPlayerIndex;
        if (oldPlayerIndex > -1) {
            const oldPlayer = room.players[room.gameState.turnOrder[oldPlayerIndex]];
            if (oldPlayer) {
                // Shield HP expires at the end of the player's turn.
                if (oldPlayer.role === 'Explorer') oldPlayer.stats.shieldHp = 0;
                
                // Decrement duration of all status effects.
                oldPlayer.statusEffects = oldPlayer.statusEffects.map(e => ({...e, duration: e.duration - 1})).filter(e => e.duration > 0);
    
                // DM turn cleanup applies to monsters and world events.
                if (oldPlayer.role === 'DM') {
                    room.gameState.board.monsters.forEach(m => {
                        m.statusEffects = m.statusEffects.map(e => ({...e, duration: e.duration - 1})).filter(e => e.duration > 0);
                    });
                    if(room.gameState.worldEvents.currentEvent) {
                         room.gameState.worldEvents.duration -= 1;
                         if(room.gameState.worldEvents.duration <= 0) {
                            room.chatLog.push({ type: 'system', text: `The event '${room.gameState.worldEvents.currentEvent.name}' has ended.` });
                            room.gameState.worldEvents.currentEvent = null;
                         }
                    }
                }
            }
        }

        room.gameState.skillChallenge.isActive = false; // Reset challenge flag for next player
    
        // --- Find Next Player ---
        let nextIndex, attempts = 0;
        // Skip over any players who are downed.
        do {
            nextIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
            attempts++;
        } while (room.players[room.gameState.turnOrder[nextIndex]]?.isDowned && attempts <= room.gameState.turnOrder.length)

        // If all explorers are downed, the game is over.
        if (attempts > room.gameState.turnOrder.length) {
            room.gameState.phase = 'game_over';
            room.gameState.winner = 'Monsters';
            this.emitGameState(roomId);
            return;
        }

        room.gameState.currentPlayerIndex = nextIndex;
        if (nextIndex === 0) room.gameState.turnCount++; // Increment turn count when DM's turn starts.
    
        this.startTurn(roomId);
    }
    
    // --- 3.6. AI Logic & Event Triggers ---
    async handleDmTurn(room) {
        // 1. World Event Check: 60% chance each DM turn if no event is active.
        if (!room.gameState.worldEvents.currentEvent && Math.random() < 0.60) {
            const eventCard = this.drawCardFromDeck(room.id, 'worldEvent');
            if(eventCard) {
                room.gameState.worldEvents.currentEvent = eventCard;
                room.gameState.worldEvents.duration = eventCard.duration || 2;
                room.chatLog.push({ type: 'dm', text: `A strange event unfolds: ${eventCard.name}!` });
                room.chatLog.push({ type: 'system', text: eventCard.description });
                this.emitGameState(room.id);
                await new Promise(res => setTimeout(res, 1500));
            }
        }
        
        // 2. Monster Spawning: Keep at least 2 monsters on the board.
        if (room.gameState.board.monsters.length < 2) {
            const monsterCard = this.drawCardFromDeck(room.id, 'monster.tier1');
            if (monsterCard) {
                monsterCard.currentHp = monsterCard.maxHp;
                monsterCard.statusEffects = [];
                room.gameState.board.monsters.push(monsterCard);
                room.chatLog.push({ type: 'dm', text: gameData.npcDialogue.dm.playMonster[Math.floor(Math.random() * gameData.npcDialogue.dm.playMonster.length)] });
                this.emitGameState(room.id);
                await new Promise(res => setTimeout(res, 1000));
            }
        }

        // 3. Monster Attacks: Each monster attacks a random, living explorer.
        for (const monster of room.gameState.board.monsters) {
            const livingExplorers = Object.values(room.players).filter(p => p.role === 'Explorer' && !p.isDowned);
            if (livingExplorers.length > 0) {
                const target = livingExplorers[Math.floor(Math.random() * livingExplorers.length)];
                
                const hitRoll = this.rollDice('1d20');
                const totalRoll = hitRoll + monster.attackBonus;
                const targetAC = 10 + target.stats.shieldBonus; // Basic AC calculation
                
                const outcome = totalRoll >= targetAC ? 'Hit' : 'Miss';
                room.chatLog.push({ type: 'combat', text: `${monster.name} attacks ${target.name}... It rolled a ${totalRoll} and it's a ${outcome}!` });
                
                if (outcome === 'Hit') {
                    const damageRoll = this.rollDice(monster.effect.dice);
                    const totalDamage = damageRoll + (monster.damageBonus || 0);
                    this.applyDamage(target, totalDamage);
                    room.chatLog.push({ type: 'combat-hit', text: `${monster.name} dealt ${totalDamage} damage to ${target.name}.` });
                }

                this.emitGameState(room.id);
                await new Promise(res => setTimeout(res, 1500));
            }
        }
    }

    async handleNpcExplorerTurn(room, npc) {
        // Simple AI: If there's a monster, attack it with the equipped weapon.
        if (room.gameState.board.monsters.length > 0) {
            const targetMonster = room.gameState.board.monsters[0];
            const weapon = npc.equipment.weapon || { id: 'unarmed', name: 'Fists', effect: { dice: '1d4' }, apCost: 1 };
            
            if (npc.currentAp >= weapon.apCost) {
                npc.currentAp -= weapon.apCost;

                const hitRoll = this.rollDice('1d20');
                const totalRoll = hitRoll + npc.stats.hitBonus;
                const targetAC = targetMonster.requiredRollToHit;
                
                const outcome = totalRoll >= targetAC ? 'Hit' : 'Miss';
                room.chatLog.push({ type: 'combat', text: `${npc.name} attacks ${targetMonster.name} with ${weapon.name}... Rolled a ${totalRoll}. It's a ${outcome}!` });

                if (outcome === 'Hit') {
                    const damageRoll = this.rollDice(weapon.effect.dice);
                    const totalDamage = damageRoll + npc.stats.damageBonus;
                    targetMonster.currentHp -= totalDamage;
                    room.chatLog.push({ type: 'combat-hit', text: `${npc.name} dealt ${totalDamage} damage to ${targetMonster.name}.` });

                    if (targetMonster.currentHp <= 0) {
                        this.handleMonsterDefeated(room, targetMonster.id, npc.id);
                    }
                }
            }
        }
        this.emitGameState(room.id);
    }
    
    handleMonsterDefeated(room, monsterId, killerId) {
        const monsterIndex = room.gameState.board.monsters.findIndex(m => m.id === monsterId);
        if (monsterIndex !== -1) {
            const defeatedMonster = room.gameState.board.monsters.splice(monsterIndex, 1)[0];
            room.chatLog.push({ type: 'dm', text: `${defeatedMonster.name} has been defeated!` });
            
            // Check for loot drop based on room settings.
            const lootDropChance = room.settings.lootDropRate || 80;
            if (Math.random() * 100 < lootDropChance) {
                const killer = room.players[killerId];
                const killerClass = killer ? killer.class : null;
                const lootCard = this.generateLoot(room.id, killerClass);
                if (lootCard) {
                    room.gameState.lootPool.push(lootCard);
                    room.chatLog.push({ type: 'system-good', text: `The party discovered a ${lootCard.name}!` });
                }
            }
            
            // Victory condition: after turn 5, if all monsters are gone, explorers win.
            if (room.gameState.turnCount > 5 && room.gameState.board.monsters.length === 0) {
                room.gameState.phase = 'game_over';
                room.gameState.winner = 'Explorers';
            }
        }
    }

    // --- 3.7. Action Resolution ---
    handlePlayerAction(socket, payload) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player || player.isDowned) return;
        
        const isMyTurn = room.gameState.turnOrder[room.gameState.currentPlayerIndex] === player.id;
        // Allow certain actions (claiming loot, discarding for new cards) even when it's not your turn.
        if (!isMyTurn && !['chooseNewCardDiscard', 'claimLoot'].includes(payload.action)) {
            return socket.emit('actionError', "It's not your turn.");
        }
    
        const actions = {
            'attack': this.resolveAttack,
            'resolveAttackRoll': this.resolveAttackRoll,
            'resolveDamageRoll': this.resolveDamageRoll,
            'useConsumable': this.resolveUseConsumable,
            'claimLoot': this.resolveClaimLoot,
            'chooseNewCardDiscard': this.resolveNewCardDiscard,
            'guard': this.resolveGuard,
            'respite': this.resolveRespite,
            'rest': this.resolveRest,
            'discardCard': this.resolveDiscardCard,
            'useAbility': this.resolveUseAbility,
            'resolveSkillCheck': this.resolveSkillCheck,
        };
    
        const actionHandler = actions[payload.action];
        if (actionHandler) {
            actionHandler.call(this, room, player, payload, socket);
        }
    }
    
    resolveAttack(room, player, { cardId, targetId, narrative }, socket) {
        if (narrative) room.chatLog.push({ type: 'narrative', playerName: player.name, text: narrative });

        const weapon = cardId === 'unarmed' 
            ? { id: 'unarmed', name: 'Fists', effect: { dice: '1d4' }, apCost: 1 }
            : Object.values(player.equipment).find(e => e && e.id === cardId);

        if (!weapon) return;
        if (player.currentAp < weapon.apCost) return socket.emit('actionError', "Not enough AP to attack.");

        player.currentAp -= weapon.apCost;
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!target) return;
        
        const bonus = player.stats.hitBonus || 0;
        
        socket.emit('promptAttackRoll', {
            title: `Attacking ${target.name}`,
            dice: '1d20',
            bonus,
            targetAC: target.requiredRollToHit,
            weaponId: cardId,
            targetId: targetId
        });
        
        this.emitGameState(room.id);
    }
    
    resolveAttackRoll(room, player, { weaponId, targetId }, socket) {
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!target) return;

        const hitBonus = player.stats.hitBonus || 0;
        const hitRoll = this.rollDice('1d20');
        const totalRoll = hitRoll + hitBonus;
        const outcome = totalRoll >= target.requiredRollToHit ? 'Hit' : 'Miss';
        
        const weapon = weaponId === 'unarmed' 
            ? { id: 'unarmed', name: 'Fists', effect: { dice: '1d4' } }
            : Object.values(player.equipment).find(e => e && e.id === weaponId);
        if (!weapon) return;

        const resultPayload = {
            rollerId: player.id, rollerName: player.name, targetName: target.name,
            weaponName: weapon.name,
            roll: hitRoll, bonus: hitBonus, total: totalRoll, targetAC: target.requiredRollToHit,
            outcome,
        };
        
        // Emit the hit/miss result to the entire room.
        io.to(room.id).emit('attackResolved', resultPayload);

        // If it was a hit, prompt the roller to roll for damage.
        if (outcome === 'Hit') {
            socket.emit('promptDamageRoll', {
                title: `Damage Roll vs ${target.name}`,
                dice: weapon.effect.dice,
                bonus: player.stats.damageBonus || 0,
                weaponId,
                targetId
            });
        }

        this.emitGameState(room.id);
    }
    
    resolveDamageRoll(room, player, { weaponId, targetId }) {
        const weapon = weaponId === 'unarmed' 
            ? { id: 'unarmed', name: 'Fists', effect: { dice: '1d4' } }
            : Object.values(player.equipment).find(e => e && e.id === weaponId);
        if (!weapon) return;

        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!target) return;

        const damageRoll = this.rollDice(weapon.effect.dice);
        const damageBonus = player.stats.damageBonus || 0;
        const totalDamage = Math.max(1, damageRoll + damageBonus);
        target.currentHp -= totalDamage;
        
        let wasDefeated = false;
        if (target.currentHp <= 0) {
            wasDefeated = true;
            this.handleMonsterDefeated(room, target.id, player.id);
        }
        
        const damagePayload = {
            rollerId: player.id,
            rollerName: player.name,
            targetId: target.id,
            targetName: target.name,
            damageDice: weapon.effect.dice,
            damageRoll,
            damageBonus,
            totalDamage,
            wasDefeated,
        };

        io.to(room.id).emit('damageResolved', damagePayload);
        this.emitGameState(room.id); // This will update the monster's HP for all clients
    }


    // Applies damage, accounting for shield HP first.
    applyDamage(target, damageAmount) {
        if (!target || target.isDowned) return;

        const shieldDamage = Math.min(damageAmount, target.stats.shieldHp);
        target.stats.shieldHp -= shieldDamage;
        damageAmount -= shieldDamage;

        if (damageAmount > 0) target.stats.currentHp -= damageAmount;

        if (target.stats.currentHp <= 0) {
            target.stats.currentHp = 0;
            target.isDowned = true;
        }
    }
    
    resolveUseConsumable(room, player, { cardId, targetId }, socket) {
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;
        const card = player.hand[cardIndex];

        if (player.currentAp < card.apCost) return socket.emit('actionError', "Not enough AP.");
        player.currentAp -= card.apCost;
        
        player.hand.splice(cardIndex, 1);
        room.gameState.discardPile.push(card);

        const targetPlayer = room.players[targetId];
        const targetMonster = room.gameState.board.monsters.find(m => m.id === targetId);

        if (card.effect.type === 'heal' && targetPlayer) {
            const healing = this.rollDice(card.effect.dice);
            targetPlayer.stats.currentHp = Math.min(targetPlayer.stats.maxHp, targetPlayer.stats.currentHp + healing);
            room.chatLog.push({ type: 'system-good', text: `${player.name} uses ${card.name} on ${targetPlayer.name}, healing for ${healing} HP.` });
        } else if (card.effect.type === 'damage' && targetMonster) {
            const damage = this.rollDice(card.effect.dice);
            targetMonster.currentHp -= damage;
            room.chatLog.push({ type: 'combat-hit', text: `${player.name} uses ${card.name} on ${targetMonster.name}, dealing ${damage} damage.` });
            if (targetMonster.currentHp <= 0) this.handleMonsterDefeated(room, targetMonster.id, player.id);
        }
        
        this.emitGameState(room.id);
    }

    resolveClaimLoot(room, player, { itemId, targetPlayerId }) {
        const lootIndex = room.gameState.lootPool.findIndex(i => i.id === itemId);
        if (lootIndex === -1) return;
        
        const targetPlayer = room.players[targetPlayerId];
        if (!targetPlayer) return;
        
        const [item] = room.gameState.lootPool.splice(lootIndex, 1);
        this._giveCardToPlayer(room, targetPlayer, item);
        room.chatLog.push({ type: 'system-good', text: `${targetPlayer.name} claimed the ${item.name}.` });
        this.emitGameState(room.id);
    }
    
    resolveNewCardDiscard(room, player, { cardToDiscardId, newCard }) {
        if (cardToDiscardId === newCard.id) {
            room.gameState.discardPile.push(newCard);
            room.chatLog.push({ type: 'system', text: `${player.name} discarded the new card, ${newCard.name}.` });
        } else {
            const cardIndex = player.hand.findIndex(c => c.id === cardToDiscardId);
            if (cardIndex > -1) {
                const [discardedCard] = player.hand.splice(cardIndex, 1);
                room.gameState.discardPile.push(discardedCard);
                player.hand.push(newCard);
                room.chatLog.push({ type: 'system', text: `${player.name} discarded ${discardedCard.name} for ${newCard.name}.` });
            }
        }
        this.emitGameState(room.id);
    }
    
    resolveGuard(room, player, _, socket) {
        if (player.currentAp < gameData.actionCosts.guard) return socket.emit('actionError', "Not enough AP.");
        player.currentAp -= gameData.actionCosts.guard;
        player.stats.shieldHp += player.stats.shieldBonus;
        room.chatLog.push({ type: 'action', text: `${player.name} takes a defensive stance, gaining ${player.stats.shieldBonus} Shield HP.` });
        this.emitGameState(room.id);
    }

    resolveRespite(room, player, _, socket) {
        if (player.currentAp < gameData.actionCosts.briefRespite) return socket.emit('actionError', "Not enough AP.");
        player.currentAp -= gameData.actionCosts.briefRespite;
        const healing = this.rollDice('1d4');
        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
        room.chatLog.push({ type: 'action-good', text: `${player.name} takes a brief respite, healing for ${healing} HP.` });
        this.emitGameState(room.id);
    }

    resolveRest(room, player, _, socket) {
        if (player.currentAp < gameData.actionCosts.fullRest) return socket.emit('actionError', "Not enough AP.");
        player.currentAp -= gameData.actionCosts.fullRest;
        const classData = gameData.classes[player.class];
        const healing = this.rollDice(`${classData.healthDice}d4`);
        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
        room.chatLog.push({ type: 'action-good', text: `${player.name} takes a full rest, healing for ${healing} HP.` });
        this.emitGameState(room.id);
    }
    
    resolveDiscardCard(room, player, { cardId }) {
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex > -1) {
            const [discardedCard] = player.hand.splice(cardIndex, 1);
            room.gameState.discardPile.push(discardedCard);
            room.chatLog.push({ type: 'system', text: `${player.name} discarded ${discardedCard.name}.` });
            this.emitGameState(room.id);
        }
    }
    
    resolveUseAbility(room, player, { abilityName }, socket) {
        const classData = gameData.classes[player.class];
        if (!classData || classData.ability.name !== abilityName) return;
        if (player.currentAp < classData.ability.apCost) return socket.emit('actionError', "Not enough AP.");
    
        let success = true; // Assume success unless a condition fails
        switch (player.class) {
            case 'Barbarian':
                player.statusEffects.push({ name: 'Rage', duration: 2, bonuses: { damageBonus: 4 } });
                break;
            case 'Cleric':
                // For simplicity, we'll make this self-heal. Targeting would require client-side changes.
                const healing = this.rollDice('1d8') + player.stats.wis;
                player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
                break;
            case 'Mage':
                if (player.usedAbilityThisTurn) {
                    socket.emit('actionError', "You can only use Arcane Recovery once per turn.");
                    success = false;
                } else {
                    player.currentAp = Math.min(player.stats.maxAP, player.currentAp + 1);
                    player.usedAbilityThisTurn = true;
                }
                break;
            case 'Ranger':
                player.statusEffects.push({ name: 'Hunters Mark', duration: 2, bonuses: { hitBonus: 5 } });
                break;
            case 'Rogue':
                player.statusEffects.push({ name: 'Sneak Attack', duration: 2, bonuses: { damageBonus: this.rollDice('1d6') } });
                break;
            case 'Warrior':
                player.statusEffects.push({ name: 'Power Surge', duration: 2, bonuses: { damageBonus: 2, hitBonus: 2 } });
                break;
            default:
                success = false;
        }
    
        if (success) {
            player.currentAp -= classData.ability.apCost;
            room.chatLog.push({ type: 'action-good', text: `${player.name} uses ${abilityName}!` });
            this.emitGameState(room.id);
        }
    }

    // --- 3.8. Loot & Item Generation ---
    generateLoot(roomId, playerClass) {
        const baseCard = this.drawCardFromDeck(roomId, 'treasure', playerClass);
        if (!baseCard) return null;
        
        // Determine rarity
        const roll = Math.random() * 100;
        let rarity = 'Common';
        if (roll < 5) rarity = 'Legendary';       // 5%
        else if (roll < 20) rarity = 'Rare';      // 15%
        else if (roll < 50) rarity = 'Uncommon';  // 30%

        if (rarity === 'Common') {
            baseCard.id = this.generateUniqueCardId();
            return baseCard;
        }

        const rarityMap = { 'Uncommon': 1, 'Rare': 2, 'Legendary': 3 };
        const tier = rarityMap[rarity];

        const eligibleAffixes = gameData.magicalAffixes.filter(affix => 
            affix.types.includes(baseCard.type.toLowerCase()) && affix.tier <= tier
        );
        if(eligibleAffixes.length === 0) return baseCard;

        const affix = eligibleAffixes[Math.floor(Math.random() * eligibleAffixes.length)];

        // Create the magical item by adding the affix to the base card.
        const magicalItem = JSON.parse(JSON.stringify(baseCard));
        magicalItem.id = this.generateUniqueCardId();
        magicalItem.rarity = rarity;
        magicalItem.name = `${affix.name} ${baseCard.name}`;
        if (!magicalItem.effect.bonuses) magicalItem.effect.bonuses = {};

        Object.keys(affix.bonuses).forEach(key => {
            magicalItem.effect.bonuses[key] = (magicalItem.effect.bonuses[key] || 0) + affix.bonuses[key];
        });
        
        return magicalItem;
    }

    // --- 3.9. Event & Challenge Handling ---
    resolveSkillCheck(room, player, _, socket) {
        if (!room.gameState.skillChallenge.isActive) return;
        const challenge = room.gameState.skillChallenge.details;
        
        if (player.currentAp < 1) return socket.emit('actionError', "Not enough AP to attempt the challenge.");
        player.currentAp -= 1;
        
        let hasAdvantage = false;
        const relevantItem = player.hand.find(card => card.relevantSkill && card.relevantSkill === challenge.skill);
        if (relevantItem) {
            hasAdvantage = true;
            room.chatLog.push({ type: 'system-good', text: `${player.name} uses their ${relevantItem.name} to gain advantage on the check!` });
        }

        let roll;
        if (hasAdvantage) {
            const roll1 = this.rollDice('1d20');
            const roll2 = this.rollDice('1d20');
            roll = Math.max(roll1, roll2);
        } else {
            roll = this.rollDice('1d20');
        }
        
        // TODO: Add stat modifiers based on challenge.skill
        const total = roll; 

        if (total >= challenge.dc) {
            room.chatLog.push({ type: 'system-good', text: `${player.name} succeeds the skill check! (Rolled ${total})` });
            const lootCard = this.generateLoot(room.id, player.class);
            if (lootCard) {
                room.gameState.lootPool.push(lootCard);
                room.chatLog.push({ type: 'system-good', text: `Their insight reveals a hidden treasure: a ${lootCard.name}!` });
            }
        } else {
            const damage = this.rollDice('1d6');
            this.applyDamage(player, damage);
            room.chatLog.push({ type: 'system-bad', text: `${player.name} fails the skill check (Rolled ${total}) and takes ${damage} damage from the hazardous event!` });
        }
        
        room.gameState.skillChallenge.isActive = false;
        room.gameState.worldEvents.currentEvent = null; // Event is resolved
        
        this.emitGameState(room.id);
    }

    // --- 3.10. Chat & Disconnect Logic ---
    handleChatMessage(socket, { channel, message }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player) return;

        room.chatLog.push({ type: 'chat', playerId: player.id, playerName: player.name, channel, text: message });
        this.emitGameState(room.id);
    }
    
    handleDisconnect(socket) {
        const roomId = this.socketToRoom[socket.id];
        const room = this.rooms[roomId];
        if (!room) return;

        const player = room.players[socket.id];
        if (!player) return;

        player.disconnected = true;
        room.chatLog.push({ type: 'system', text: `${player.name} has disconnected.` });
        
        // If the game hasn't started, just remove them.
        if (room.gameState.phase === 'class_selection') {
            // If the host disconnects during setup, close the room for everyone.
            if (player.id === room.hostId) {
                io.to(roomId).emit('roomClosed', { message: 'The host has disconnected. The room has been closed.' });
                // Clean up sockets from room
                const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
                if (socketsInRoom) {
                    socketsInRoom.forEach(socketId => {
                        const sock = io.sockets.sockets.get(socketId);
                        if(sock) sock.leave(roomId);
                    });
                }
                delete this.rooms[roomId];
                return;
            }
            delete room.players[socket.id];
        } else {
            // If the game is running, give them 60 seconds to reconnect before removal.
            player.cleanupTimer = setTimeout(() => {
                if (room.players[socket.id]?.disconnected) {
                    delete room.players[socket.id];
                    // Also remove from turn order to prevent errors
                    const turnIndex = room.gameState.turnOrder.indexOf(socket.id);
                    if(turnIndex > -1) room.gameState.turnOrder.splice(turnIndex, 1);
                    this.emitGameState(roomId);
                }
            }, 60000);
        }
        
        delete this.socketToRoom[socket.id];
        this.emitGameState(roomId);
    }
    
    rejoinRoom(socket, { roomId, playerId }) {
        const room = this.rooms[roomId];
        if (!room) return;

        // Find the player data using their persistent playerId, not the old socket.id
        const originalPlayerEntry = Object.entries(room.players).find(([id, p]) => p.playerId === playerId);
        if (originalPlayerEntry) {
            const [oldSocketId, playerObject] = originalPlayerEntry;
            
            // Re-assign the player object to the new socket.id
            delete room.players[oldSocketId];
            playerObject.id = socket.id;
            playerObject.disconnected = false;
            if (playerObject.cleanupTimer) clearTimeout(playerObject.cleanupTimer);
            playerObject.cleanupTimer = null;
            
            room.players[socket.id] = playerObject;
            socket.join(roomId);
            this.socketToRoom[socket.id] = roomId;
            
            // Update turn order with new socket id
            const turnIndex = room.gameState.turnOrder.indexOf(oldSocketId);
            if (turnIndex > -1) {
                room.gameState.turnOrder[turnIndex] = socket.id;
            }

            socket.emit('playerIdentity', { playerId: playerObject.playerId, roomId });
            room.chatLog.push({ type: 'system', text: `${playerObject.name} has reconnected.` });
            this.emitGameState(roomId);
        }
    }
}


// --- 4. SOCKET.IO CONNECTION HANDLING ---
const gameManager = new GameManager();

io.on('connection', (socket) => {
    socket.on('createRoom', (data) => gameManager.createRoom(socket, data));
    socket.on('joinRoom', (data) => gameManager.joinRoom(socket, data));
    socket.on('rejoinRoom', (data) => gameManager.rejoinRoom(socket, data));
    socket.on('chooseClass', (data) => gameManager.chooseClass(socket, data));
    socket.on('equipItem', (data) => gameManager.equipItem(socket, data));
    socket.on('endTurn', () => gameManager.endTurn(socket));
    socket.on('playerAction', (data) => gameManager.handlePlayerAction(socket, data));
    socket.on('chatMessage', (data) => gameManager.handleChatMessage(socket, data));
    socket.on('disconnect', () => gameManager.handleDisconnect(socket));
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});