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
//    - 3.5. Turn Management (REBUILT)
//    - 3.6. AI Logic (NPC Turns)
//    - 3.7. Action Resolution (Attacks, Abilities, etc.)
//    - 3.8. Event & Challenge Handling
//    - 3.9. Chat & Disconnect Logic (REBUILT)
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
    
    // REBUILT: Single point of emission for game state.
    emitGameState(roomId) {
        if (this.rooms[roomId]) {
            // Include static game data needed by the client for rendering.
            const stateWithStaticData = {
                ...this.rooms[roomId],
                staticData: {
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
        // Handle cases like "1" for fixed damage
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
            id, // The temporary socket ID
            playerId, // The persistent ID for reconnects
            name,
            isNpc: false,
            isDowned: false, // Player defeat state
            disconnected: false, // For reconnect logic
            cleanupTimer: null, // For removing disconnected players
            isGuaranteedCrit: false, // For server-side crit tracking
            role: null,
            class: null,
            stats: { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, maxAP: 0, shieldHp: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
            currentAp: 0,
            hand: [],
            equipment: { weapon: null, armor: null },
            statusEffects: [],
        };
    }

    createRoom(socket, { playerName, gameMode, customSettings }) {
        // --- SURGICAL REVERSION: Player object creation moved inline for stability ---
        const playerId = `player_${Math.random().toString(36).substr(2, 9)}`;
        const newPlayer = {
            id: socket.id,
            playerId: playerId,
            name: playerName,
            isNpc: false,
            isDowned: false,
            disconnected: false,
            cleanupTimer: null,
            isGuaranteedCrit: false,
            role: null,
            class: null,
            stats: { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, maxAP: 0, shieldHp: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
            currentAp: 0,
            hand: [], // Explicitly initialized as an empty array.
            equipment: { weapon: null, armor: null }, // Using stable, single-slot equipment structure.
            statusEffects: [], // Explicitly initialized as an empty array.
        };
        // --- END REVERSION ---

        const newRoomId = this.generateRoomId();
    
        const defaultSettings = {
            startWithWeapon: true, startWithArmor: true, startingItems: 2, 
            startingSpells: 2, lootDropRate: 50, maxHandSize: 7 // STABILITY: Hardcoded default.
        };
    
        const newRoom = {
            id: newRoomId,
            hostId: socket.id,
            players: { [socket.id]: newPlayer },
            voiceChatPeers: [],
            settings: { ...defaultSettings, ...(customSettings || {}) },
            gameState: {
                phase: 'class_selection',
                gameMode: gameMode || 'Beginner',
                winner: null, // To determine game over state
                decks: { /* Initialized during game start */ },
                discardPile: [], // v6.4.1: Initialize discard pile
                turnOrder: [],
                currentPlayerIndex: -1,
                board: { monsters: [] },
                lootPool: [],
                turnCount: 0,
                worldEvents: { currentEvent: null, duration: 0 },
                currentPartyEvent: null,
                skillChallenge: { isActive: false, details: null }, // v6.5.0 Framework
            },
            chatLog: []
        };
    
        newPlayer.role = 'Explorer';
        this.rooms[newRoomId] = newRoom;
        socket.join(newRoomId);
        this.socketToRoom[socket.id] = newRoomId;
    
        // Send the persistent ID to the client for session storage
        socket.emit('playerIdentity', { playerId: newPlayer.playerId, roomId: newRoomId });

        this.emitGameState(newRoomId);
    }
    
    joinRoom(socket, { roomId, playerName }) {
        const room = this.rooms[roomId];
        if (!room) return socket.emit('actionError', 'Room not found.');
    
        const isGameInProgress = room.gameState.phase !== 'class_selection';
        const humanPlayersCount = Object.values(room.players).filter(p => !p.isNpc).length;
    
        if (isGameInProgress) {
            return socket.emit('actionError', 'Game is already in progress.');
        }
    
        // Game is in lobby (class_selection) phase
        const MAX_PLAYERS = 4;
        if (humanPlayersCount >= MAX_PLAYERS) {
             return socket.emit('actionError', 'This game lobby is full.');
        }
    
        // Lobby is not full, join as an explorer
        const newPlayer = this.createPlayerObject(socket.id, playerName);
        newPlayer.role = 'Explorer';
        room.players[socket.id] = newPlayer;
        socket.join(roomId);
        this.socketToRoom[socket.id] = roomId;
        
        socket.emit('playerIdentity', { playerId: newPlayer.playerId, roomId: roomId });
        this.emitGameState(roomId);
    }

    // --- 3.3. Game Lifecycle (The New Core Orchestrator) ---
    chooseClass(socket, { classId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player || player.class) return;

        // 1. Assign class to the human player
        this.assignClassToPlayer(player, classId);

        // 2. Create and set up NPCs
        this.createNpcs(room);
        
        // 3. Initialize Decks
        this.initializeDecks(room);

        // 4. Deal starting hands and gear to all explorers
        Object.values(room.players).filter(p => p.role === 'Explorer').forEach(p => {
            this.dealStartingLoadout(room, p);
        });
        
        // 5. Finalize stats and AP for all players
        Object.values(room.players).forEach(p => {
            p.stats = this.calculatePlayerStats(p);
            p.stats.currentHp = p.stats.maxHp;
            
            // AP FIX (v6.5.46): Set the initial current AP from the final calculated stat.
            // `calculatePlayerStats` now correctly sets `stats.maxAP` itself.
            p.currentAp = p.stats.ap;
        });

        // 6. Set turn order and start the game
        let dmId = null;
        let humanPlayerId = null;
        let npcExplorerIds = [];
    
        // 6.1 Segment Players by Type
        Object.keys(room.players).forEach(id => {
            const player = room.players[id];
            if (player.role === 'DM') {
                dmId = id;
            } else if (player.isNpc) { // NPC Explorer
                npcExplorerIds.push(id);
            } else if (player.role === 'Explorer') { // Human Player
                humanPlayerId = id;
            }
        });
    
        // 6.2 Establish the New Priority Order
        const newTurnOrder = [];
        if (dmId) newTurnOrder.push(dmId);
        if (humanPlayerId) newTurnOrder.push(humanPlayerId);
        newTurnOrder.push(...shuffle(npcExplorerIds)); // Shuffle NPCs among themselves
    
        // 6.3 Update the room's turn order list
        room.gameState.turnOrder = newTurnOrder;
        room.gameState.currentPlayerIndex = -1; // Will be incremented to 0 by endCurrentTurn
        room.gameState.phase = 'started';
        room.gameState.turnCount = 0; // Will be incremented to 1 by endCurrentTurn

        // 7. Start the first turn (DM's turn)
        this.endCurrentTurn(room.id);
    }
    
    createNpcs(room) {
        const dmNpc = this.createPlayerObject('npc-dm', 'Dungeon Master');
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
        const createDeck = (cardArray) => cardArray.map(c => ({ ...c, id: this.generateUniqueCardId() }));
        
        room.gameState.decks = {
            item: shuffle(createDeck(gameData.itemCards)),
            spell: shuffle(createDeck(gameData.spellCards)),
            weapon: shuffle(createDeck(gameData.weaponCards)),
            armor: shuffle(createDeck(gameData.armorCards)),
            worldEvent: shuffle(createDeck(gameData.worldEventCards)),
            playerEvent: shuffle(createDeck(gameData.playerEventCards)),
            partyEvent: shuffle(createDeck(gameData.partyEventCards)),
            monster: {
                tier1: shuffle(createDeck(gameData.monsterTiers.tier1)),
                tier2: shuffle(createDeck(gameData.monsterTiers.tier2)),
                tier3: shuffle(createDeck(gameData.monsterTiers.tier3)),
            }
        };
        // Treasure deck is a mix of other decks
        room.gameState.decks.treasure = shuffle([
            ...room.gameState.decks.item,
            ...room.gameState.decks.weapon,
            ...room.gameState.decks.armor
        ]);
    }

    _giveCardToPlayer(room, player, card) {
        if (!card) return;
    
        // v6.4.0: Choose to Discard on Full Hand
        if (room && player && room.settings && player.hand.length >= room.settings.maxHandSize) {
            // v6.4.1: CRITICAL FIX - Resolve socket via io instance
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) {
                // If player is connected, prompt them to choose
                playerSocket.emit('chooseToDiscard', { newCard: card, currentHand: player.hand });
            } else {
                // Fallback: If socket is not found (disconnected), auto-discard the new card
                room.gameState.discardPile.push(card);
                room.chatLog.push({ type: 'system', text: `${player.name}'s hand was full, and they are disconnected. The new card '${card.name}' was discarded.` });
            }
        } else {
            // Hand is not full, add the card normally.
            player.hand.push(card);
        }
    }

    dealStartingLoadout(room, player) {
        const { gameMode } = room.gameState;
        const customSettings = room.settings;
        
        // --- This part remains for equipping weapon/armor ---
        const dealAndEquip = (type) => {
            const card = this.drawCardFromDeck(room.id, type, player.class);
            if (card) {
                player.equipment[type] = card;
            }
        };

        if (gameMode === 'Beginner' || (gameMode === 'Custom' && customSettings.startWithWeapon)) {
            dealAndEquip('weapon');
        }
        if (gameMode === 'Beginner' || (gameMode === 'Custom' && customSettings.startWithArmor)) {
            dealAndEquip('armor');
        }
        if (gameMode === 'Advanced') {
            dealAndEquip('weapon');
            dealAndEquip('armor');
        }
        // --- End of existing equip logic ---

        // --- FIX: Class-specific starting hand ---
        const classData = gameData.classes[player.class];
        if (classData && classData.startingDeck) {
            for (const cardName in classData.startingDeck) {
                const quantity = classData.startingDeck[cardName];
                const cardTemplate = cardDataMap[cardName];

                if (cardTemplate) {
                    for (let i = 0; i < quantity; i++) {
                        const newCard = { ...cardTemplate, id: this.generateUniqueCardId() };
                        this._giveCardToPlayer(room, player, newCard);
                    }
                }
            }
        }
    }

    drawCardFromDeck(roomId, deckName, playerClass = null) {
        const room = this.rooms[roomId];
        if (!room) return null;

        let deck;
        if (deckName.includes('.')) {
            const [parent, child] = deckName.split('.');
            deck = room.gameState.decks[parent]?.[child];
        } else {
            deck = room.gameState.decks[deckName];
        }

        if (!deck || deck.length === 0) return null;

        if (playerClass && (deckName === 'spell' || deckName === 'weapon' || deckName === 'armor')) {
            const suitableCardIndex = deck.findIndex(card => 
                !card.class || card.class.includes("Any") || card.class.includes(playerClass)
            );
            if (suitableCardIndex !== -1) {
                return deck.splice(suitableCardIndex, 1)[0];
            }
            return null; // No suitable card found
        }
        return deck.pop();
    }

    // --- 3.4. Player Setup ---
    assignClassToPlayer(player, classId) {
        const classData = gameData.classes[classId];
        if (!classData || !player) return;
        player.class = classId;
        // Temporary stats until equipment is finalized
        player.stats = this.calculatePlayerStats(player);
    }

    _getStatModifier(player, statName) {
        if (!player || !player.stats || typeof player.stats[statName] === 'undefined') {
            return 0;
        }
        // As per user request: 1 point of bonus per 5 points of the stat.
        return Math.floor(player.stats[statName] / 5);
    }

    calculatePlayerStats(player) {
        const baseStats = { maxHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, maxAP: 0, shieldHp: player.stats.shieldHp || 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
        if (!player.class) return baseStats;
    
        const classData = gameData.classes[player.class];
        const newStats = {
            ...baseStats,
            maxHp: classData.baseHp,
            damageBonus: classData.baseDamageBonus,
            shieldBonus: classData.baseShieldBonus,
            ap: classData.baseAP,
            ...classData.stats
        };
    
        for (const item of Object.values(player.equipment)) {
            if (item?.effect?.bonuses) {
                Object.keys(item.effect.bonuses).forEach(key => {
                    newStats[key] = (newStats[key] || 0) + item.effect.bonuses[key];
                });
            }
        }
        
        newStats.hitBonus = 0; // Initialize temporary bonus
        for (const effect of player.statusEffects) {
            if (effect.type === 'stat_modifier' && effect.bonuses) {
                Object.keys(effect.bonuses).forEach(key => {
                    newStats[key] = (newStats[key] || 0) + effect.bonuses[key];
                });
            } else if (effect.type === 'damage_buff' && effect.damageBonus) {
                newStats.damageBonus += effect.damageBonus;
            } else if (effect.type === 'hit_buff' && effect.hitBonus) {
                newStats.hitBonus += effect.hitBonus;
            }
        }
    
        // Ensure current HP doesn't exceed new max HP
        if (player.stats.currentHp) {
            newStats.currentHp = Math.min(player.stats.currentHp, newStats.maxHp);
        } else {
            newStats.currentHp = newStats.maxHp;
        }
        
        // AP FIX (v6.5.46): Always set maxAP equal to the final calculated AP total.
        newStats.maxAP = newStats.ap;

        return newStats;
    }

    equipItem(socket, { cardId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player || player.isDowned) return;

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;
        
        const cardToEquip = player.hand[cardIndex];
        const itemType = cardToEquip.type.toLowerCase();

        if (itemType !== 'weapon' && itemType !== 'armor') {
            return; // Not an equippable item type
        }
        
        player.hand.splice(cardIndex, 1);

        if (player.equipment[itemType]) {
            this._giveCardToPlayer(room, player, player.equipment[itemType]);
        }
        
        player.equipment[itemType] = cardToEquip;
        player.stats = this.calculatePlayerStats(player);
        this.emitGameState(room.id);
    }
    
    // --- 3.5. Turn Management (REBUILT) ---
    async startTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.phase !== 'started') return;
    
        const player = room.players[room.gameState.turnOrder[room.gameState.currentPlayerIndex]];
        if (!player) return;
    
        player.stats = this.calculatePlayerStats(player);
        player.currentAp = player.stats.maxAP; // Refresh AP to the new, correct max.
    
        this.emitGameState(roomId);
    
        if (player.isNpc) {
            await new Promise(res => setTimeout(res, 1500));
    
            if (player.role === 'DM') {
                await this.handleDmTurn(room);
            } else {
                await this.handleNpcExplorerTurn(room, player);
            }
    
            // Automatically end their turn if the game is still going
            if(room.gameState.phase === 'started') {
                this.endCurrentTurn(roomId);
            }
        }
    }

    endTurn(socket) {
        const room = this.findRoomBySocket(socket);
        if (!room) return;
        const player = room.players[socket.id];
        if (!player || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== player.id) return;
        
        this.endCurrentTurn(room.id);
    }
    
    endCurrentTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.turnOrder.length === 0 || (room.gameState.phase !== 'started' && room.gameState.phase !== 'skill_challenge')) return;

        // Don't advance turns during a skill challenge
        if (room.gameState.phase === 'skill_challenge') {
            this.emitGameState(roomId);
            return;
        }
    
        const oldPlayerIndex = room.gameState.currentPlayerIndex;
        if (oldPlayerIndex > -1) {
            const oldPlayer = room.players[room.gameState.turnOrder[oldPlayerIndex]];
            if (oldPlayer) {
                // Shield reset for explorers
                if (oldPlayer.role === 'Explorer') {
                    oldPlayer.stats.shieldHp = 0;
                }
                // Status effect duration decay for the player/DM whose turn just ended
                oldPlayer.statusEffects = oldPlayer.statusEffects.map(effect => {
                    if (effect.duration) effect.duration -= 1;
                    return effect;
                }).filter(effect => !effect.duration || effect.duration > 0);
    
                // Decay monster effects at the end of the DM's turn
                if (oldPlayer.role === 'DM') {
                    room.gameState.board.monsters.forEach(monster => {
                        monster.statusEffects = monster.statusEffects.map(effect => {
                            if (effect.duration) effect.duration -= 1;
                            return effect;
                        }).filter(effect => !effect.duration || effect.duration > 0);
                    });
                }
            }
        }
    
        // Advance to the next non-downed player
        let nextIndex = room.gameState.currentPlayerIndex;
        let attempts = 0;
        do {
            nextIndex = (nextIndex + 1) % room.gameState.turnOrder.length;
            attempts++;
        } while (room.players[room.gameState.turnOrder[nextIndex]].isDowned && attempts <= room.gameState.turnOrder.length)

        // Check if all players are downed
        if (attempts > room.gameState.turnOrder.length) {
            room.gameState.phase = 'game_over';
            room.gameState.winner = 'Monsters';
            this.emitGameState(roomId);
            return;
        }

        room.gameState.currentPlayerIndex = nextIndex;
    
        if (nextIndex === 0 && oldPlayerIndex === room.gameState.turnOrder.length - 1) { // A full round has passed
            room.gameState.turnCount++;
        }
    
        this.startTurn(roomId);
    }
    
    // --- 3.6. AI Logic ---
    async handleDmTurn(room) {
        // Simple logic: if no monsters, try to spawn one.
        if (room.gameState.board.monsters.length < 2) { // Allow up to 2 monsters
            const monsterDeck = room.gameState.decks.monster.tier1;
            if (monsterDeck.length > 0) {
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
        }

        // Each monster gets to attack
        for (const monster of room.gameState.board.monsters) {
            const livingExplorers = Object.values(room.players).filter(p => p.role === 'Explorer' && !p.isDowned);
            if (livingExplorers.length > 0) {
                const target = livingExplorers[Math.floor(Math.random() * livingExplorers.length)];
                
                // --- Replicate Player Attack Logic for Monsters ---
                const hitRoll = this.rollDice('1d20');
                const totalRoll = hitRoll + monster.attackBonus;
                const targetAC = 10 + target.stats.shieldBonus; // Simplified AC for now
                
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
        // Simple NPC logic: Find a monster and attack it.
        if (room.gameState.board.monsters.length > 0) {
            const targetMonster = room.gameState.board.monsters[0]; // Always attack the first monster
            const weapon = npc.equipment.weapon || { id: 'unarmed', name: 'Fists', effect: { dice: '1d4' }, apCost: 1 };
            
            if (npc.currentAp >= weapon.apCost) {
                npc.currentAp -= weapon.apCost;

                // --- Replicate Player Attack Logic for NPCs ---
                const hitRoll = this.rollDice('1d20');
                const totalRoll = hitRoll + npc.stats.hitBonus; // Simplified hit bonus
                const targetAC = targetMonster.requiredRollToHit;
                
                const outcome = totalRoll >= targetAC ? 'Hit' : 'Miss';
                room.chatLog.push({ type: 'combat', text: `${npc.name} attacks ${targetMonster.name} with ${weapon.name}... Rolled a ${totalRoll}. It's a ${outcome}!` });

                if (outcome === 'Hit') {
                    const damageRoll = this.rollDice(weapon.effect.dice);
                    const totalDamage = damageRoll + npc.stats.damageBonus;
                    
                    targetMonster.currentHp -= totalDamage;
                    room.chatLog.push({ type: 'combat-hit', text: `${npc.name} dealt ${totalDamage} damage to ${targetMonster.name}.` });

                    if (targetMonster.currentHp <= 0) {
                        this.handleMonsterDefeated(room, targetMonster.id);
                    }
                }
            }
        }
        
        this.emitGameState(room.id);
    }
    
    handleMonsterDefeated(room, monsterId) {
        const monsterIndex = room.gameState.board.monsters.findIndex(m => m.id === monsterId);
        if (monsterIndex !== -1) {
            const defeatedMonster = room.gameState.board.monsters[monsterIndex];
            room.chatLog.push({ type: 'dm', text: `${defeatedMonster.name} has been defeated!` });
            
            // Add loot to the loot pool
            const lootDropChance = room.settings.lootDropRate || 50;
            if (Math.random() * 100 < lootDropChance) {
                const lootCard = this.drawCardFromDeck(room.id, 'treasure');
                if (lootCard) {
                    room.gameState.lootPool.push(lootCard);
                    room.chatLog.push({ type: 'system-good', text: `The party discovered a ${lootCard.name}!` });
                }
            }
            
            room.gameState.board.monsters.splice(monsterIndex, 1);
            
            // Check for victory
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
        if (!isMyTurn) return socket.emit('actionError', "It's not your turn.");
    
        const actions = {
            'attack': this.resolveAttack,
            'resolve_hit': this.resolveHit,
            'resolve_damage': this.resolveDamage,
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
            actionHandler.call(this, room, player, payload);
        }
    }
    
    resolveAttack(room, player, { cardId, targetId, narrative }) {
        if (narrative) {
            room.chatLog.push({ type: 'narrative', playerName: player.name, text: narrative });
        }

        const weapon = cardId === 'unarmed' 
            ? { id: 'unarmed', name: 'Fists', effect: { dice: '1d4' }, apCost: 1 }
            : player.equipment[cardId] || Object.values(player.equipment).find(e => e && e.id === cardId);

        if (!weapon || player.currentAp < weapon.apCost) {
            return;
        }

        player.currentAp -= weapon.apCost;
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!target) return;
        
        const bonus = player.stats.hitBonus || this._getStatModifier(player, 'str'); // or dex for ranged
        
        io.to(player.id).emit('promptAttackRoll', {
            title: `Attacking ${target.name}`,
            dice: '1d20',
            bonus: bonus,
            targetAC: target.requiredRollToHit,
            weaponId: cardId,
            targetId: targetId
        });
        
        this.emitGameState(room.id);
    }
    
    resolveHit(room, player, { weaponId, targetId }) {
        const weapon = weaponId === 'unarmed' 
            ? { id: 'unarmed', name: 'Fists', effect: { dice: '1d4' }, apCost: 1 }
            : Object.values(player.equipment).find(e => e && e.id === weaponId);
        if (!weapon) return;

        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!target) return;
        
        const bonus = player.stats.hitBonus || this._getStatModifier(player, 'str');
        const roll = this.rollDice('1d20');
        const total = roll + bonus;
        
        const outcome = total >= target.requiredRollToHit ? 'Hit' : 'Miss';
        
        io.to(room.id).emit('attackResult', {
            rollerId: player.id,
            rollerName: player.name,
            targetName: target.name,
            action: 'attack',
            roll: roll,
            bonus: bonus,
            total: total,
            outcome: outcome,
            needsDamageRoll: outcome === 'Hit',
            weaponId: weaponId,
            targetId: targetId,
            damageDice: weapon.effect.dice
        });
    }

    resolveDamage(room, player, { weaponId, targetId }) {
        const weapon = weaponId === 'unarmed' 
            ? { id: 'unarmed', name: 'Fists', effect: { dice: '1d4' }, apCost: 1 }
            : Object.values(player.equipment).find(e => e && e.id === weaponId);
        if (!weapon) return;
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!target) return;

        const damageRoll = this.rollDice(weapon.effect.dice);
        const damageBonus = player.stats.damageBonus || 0;
        const totalDamage = damageRoll + damageBonus;

        target.currentHp -= totalDamage;

        io.to(room.id).emit('damageResult', {
            rollerId: player.id,
            rollerName: player.name,
            targetName: target.name,
            damageRoll: damageRoll,
            damageBonus: damageBonus,
            damage: totalDamage
        });

        if (target.currentHp <= 0) {
            this.handleMonsterDefeated(room, target.id);
        }

        this.emitGameState(room.id);
    }

    applyDamage(target, damageAmount) {
        if (!target || target.isDowned) return;

        // First, apply damage to shield HP if any
        if (target.stats.shieldHp > 0) {
            const shieldDamage = Math.min(damageAmount, target.stats.shieldHp);
            target.stats.shieldHp -= shieldDamage;
            damageAmount -= shieldDamage;
        }

        // Apply remaining damage to main HP
        if (damageAmount > 0) {
            target.stats.currentHp -= damageAmount;
        }

        // Check for being downed
        if (target.stats.currentHp <= 0) {
            target.stats.currentHp = 0;
            target.isDowned = true;
            // Add logic here to check if all players are downed
        }
    }
    
    resolveUseConsumable(room, player, { cardId, targetId }) {
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;
        const card = player.hand[cardIndex];

        if (player.currentAp < card.apCost) {
            return socket.emit('actionError', "Not enough AP.");
        }
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
            if (targetMonster.currentHp <= 0) {
                this.handleMonsterDefeated(room, targetMonster.id);
            }
        }
        // ... add other consumable effects ...
        
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
            // Player chose to discard the new card
            room.gameState.discardPile.push(newCard);
            room.chatLog.push({ type: 'system', text: `${player.name} discarded the new card, ${newCard.name}, due to a full hand.` });
        } else {
            // Player chose to discard a card from their hand
            const cardIndex = player.hand.findIndex(c => c.id === cardToDiscardId);
            if (cardIndex > -1) {
                const [discardedCard] = player.hand.splice(cardIndex, 1);
                room.gameState.discardPile.push(discardedCard);
                player.hand.push(newCard); // Add the new card
                room.chatLog.push({ type: 'system', text: `${player.name} discarded ${discardedCard.name} to make room for ${newCard.name}.` });
            }
        }
        this.emitGameState(room.id);
    }
    
    resolveGuard(room, player) {
        if (player.currentAp < gameData.actionCosts.guard) return;
        player.currentAp -= gameData.actionCosts.guard;
        player.stats.shieldHp += player.stats.shieldBonus;
        room.chatLog.push({ type: 'action', text: `${player.name} takes a defensive stance, gaining ${player.stats.shieldBonus} temporary Shield HP.` });
        this.emitGameState(room.id);
    }

    resolveRespite(room, player) {
        if (player.currentAp < gameData.actionCosts.briefRespite) return;
        player.currentAp -= gameData.actionCosts.briefRespite;
        const healing = this.rollDice('1d4') + this._getStatModifier(player, 'con');
        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
        room.chatLog.push({ type: 'action-good', text: `${player.name} takes a brief respite, healing for ${healing} HP.` });
        this.emitGameState(room.id);
    }

    resolveRest(room, player) {
        if (player.currentAp < gameData.actionCosts.fullRest) return;
        player.currentAp -= gameData.actionCosts.fullRest;
        const classData = gameData.classes[player.class];
        const healing = this.rollDice(`${classData.healthDice}d4`) + this._getStatModifier(player, 'con');
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
    
    resolveUseAbility(room, player, { abilityName }) {
        const classData = gameData.classes[player.class];
        if (!classData || classData.ability.name !== abilityName) return;
        
        if (player.currentAp < classData.ability.apCost) return;
        player.currentAp -= classData.ability.apCost;
        
        // Simple implementation for now
        player.stats.damageBonus += 6; // Example for Barbarian
        player.statusEffects.push({ name: 'Unchecked Assault', type: 'damage_buff', damageBonus: 6, duration: 1 });
        room.chatLog.push({ type: 'action-good', text: `${player.name} uses ${abilityName}!` });
        
        this.emitGameState(room.id);
    }

    // --- 3.8. Event & Challenge Handling ---
    resolveSkillCheck(room, player) {
        if (!room.gameState.skillChallenge.isActive) return;
        const challenge = room.gameState.skillChallenge.details;
        
        if (player.currentAp < 1) return;
        player.currentAp -= 1;
        
        const roll = this.rollDice('1d20');
        const modifier = this._getStatModifier(player, challenge.skill);
        const total = roll + modifier;

        if (total >= challenge.dc) {
            room.chatLog.push({ type: 'system-good', text: `${player.name} succeeds the skill check! (Rolled ${total})` });
            // Add success logic
        } else {
            room.chatLog.push({ type: 'system-bad', text: `${player.name} fails the skill check. (Rolled ${total})` });
            // Add failure logic
        }
        
        room.gameState.phase = 'started'; // Return to normal gameplay
        room.gameState.skillChallenge.isActive = false;
        
        this.emitGameState(room.id);
    }

    // --- 3.9. Chat & Disconnect Logic ---
    handleChatMessage(socket, { channel, message }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player) return;

        room.chatLog.push({
            type: 'chat',
            playerId: player.id,
            playerName: player.name,
            channel: channel,
            text: message
        });

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
        
        // If the game hasn't started, remove them
        if (room.gameState.phase === 'class_selection') {
            delete room.players[socket.id];
        } else {
             // Set a timer to clean them up if they don't reconnect
            player.cleanupTimer = setTimeout(() => {
                if (room.players[socket.id]?.disconnected) {
                    delete room.players[socket.id];
                    this.emitGameState(roomId);
                }
            }, 60000); // 60 seconds
        }
        
        delete this.socketToRoom[socket.id];
        this.emitGameState(roomId);
    }
    
    rejoinRoom(socket, { roomId, playerId }) {
        const room = this.rooms[roomId];
        if (!room) return;

        const originalPlayerEntry = Object.entries(room.players).find(([id, p]) => p.playerId === playerId);
        if (originalPlayerEntry) {
            const [oldSocketId, playerObject] = originalPlayerEntry;
            
            // Re-assign the player object to the new socket ID
            delete room.players[oldSocketId];
            playerObject.id = socket.id; // Update to the new socket ID
            playerObject.disconnected = false;
            if (playerObject.cleanupTimer) {
                clearTimeout(playerObject.cleanupTimer);
                playerObject.cleanupTimer = null;
            }
            room.players[socket.id] = playerObject;

            socket.join(roomId);
            this.socketToRoom[socket.id] = roomId;
            
            // Re-affirm identity
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