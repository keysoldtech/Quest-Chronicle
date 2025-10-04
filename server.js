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

/**
 * Sanitizes a string by escaping HTML characters to prevent XSS.
 * @param {string} unsafe The string to sanitize.
 * @returns {string} The sanitized string.
 */
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
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
    createPlayerObject(id, name, isNpc = false) {
        const playerId = `player_${Math.random().toString(36).substr(2, 9)}`;
        return {
            id, // Socket ID
            playerId, // Persistent ID for reconnection
            name,
            isNpc,
            isDowned: false,
            disconnected: false,
            hasTakenFirstTurn: false, // For new player tutorial
            pauseTimer: null,
            replacementTimer: null,
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
            isResolvingDiscovery: false,
            discoveryItem: null,
        };
    }

    createRoom(socket, { playerName, gameMode, customSettings }) {
        const newPlayer = this.createPlayerObject(socket.id, playerName);
        const newRoomId = this.generateRoomId();
    
        const defaultSettings = {
            startWithWeapon: true, startWithArmor: true, startingItems: 2, 
            startingSpells: 2, lootDropRate: 80, maxHandSize: 7, discoveryRolls: true
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
                board: { monsters: [], environment: [] },
                lootPool: [],
                turnCount: 0,
                partyHope: 5, // Starts at neutral
                worldEvents: { currentEvent: null, duration: 0 },
                currentPartyEvent: null,
                skillChallenge: { isActive: false, details: null, currentStage: 0, targetId: null },
                isPaused: false,
                pauseReason: '',
            },
            chatLog: [],
            savedPlayers: {}, // For storing data of disconnected players
            voiceChatters: [], // List of socket IDs in voice chat
        };
    
        newPlayer.role = 'Explorer';
        this.rooms[newRoomId] = newRoom;
        socket.join(newRoomId);
        this.socketToRoom[socket.id] = newRoomId;

        this.createNpcs(newRoom, 3); // Fill the remaining 3 slots with NPCs initially
    
        socket.emit('playerIdentity', { playerId: newPlayer.playerId, roomId: newRoomId });
        this.emitGameState(newRoomId);
    }
    
    joinRoom(socket, { roomId, playerName }) {
        const room = this.rooms[roomId];
        if (!room) return socket.emit('actionError', 'Room not found.');
    
        if (room.gameState.phase !== 'class_selection') {
            return socket.emit('actionError', 'Game is already in progress.');
        }
    
        // Find an NPC explorer to replace
        const npcToReplace = Object.values(room.players).find(p => p.isNpc && p.role === 'Explorer');
    
        if (!npcToReplace) {
            return socket.emit('actionError', 'This game lobby is full of human players.');
        }
    
        // Remove the NPC
        delete room.players[npcToReplace.id];

        // Add the new human player
        const newPlayer = this.createPlayerObject(socket.id, playerName);
        newPlayer.role = 'Explorer';
        room.players[socket.id] = newPlayer;
        socket.join(roomId);
        this.socketToRoom[socket.id] = roomId;
        
        socket.emit('playerIdentity', { playerId: newPlayer.playerId, roomId: roomId });
        this.emitGameState(roomId);
    }

    // --- 3.3. Game Lifecycle ---
    startGame(socket) {
        const room = this.findRoomBySocket(socket);
        if (!room || socket.id !== room.hostId) return;

        const humanPlayers = Object.values(room.players).filter(p => !p.isNpc);
        if (!humanPlayers.every(p => p.class)) {
            return socket.emit('actionError', 'All players must select a class before starting.');
        }

        this.initializeDecks(room);

        // Deal starting cards to all explorers (human and NPC)
        Object.values(room.players).filter(p => p.role === 'Explorer').forEach(p => {
            this.dealStartingLoadout(room, p);
        });
        
        // Finalize stats and set initial health/AP for everyone
        Object.values(room.players).forEach(p => {
            p.stats = this.calculatePlayerStats(p, room.gameState.partyHope);
            p.stats.currentHp = p.stats.maxHp;
            p.currentAp = p.stats.ap;
        });

        // --- Correct Turn Order Logic ---
        const dmId = 'npc-dm';
        const hostId = room.hostId;
        
        // Filter out the host from the list of explorers to be shuffled.
        const otherExplorerIds = Object.keys(room.players).filter(id => 
            room.players[id].role === 'Explorer' && id !== hostId
        );
        
        // The final turn order is DM -> Host -> Randomized Other Explorers.
        room.gameState.turnOrder = [dmId, hostId, ...shuffle(otherExplorerIds)];
        
        room.gameState.currentPlayerIndex = -1;
        room.gameState.phase = 'started';
        room.gameState.turnCount = 0;

        // Start the first turn sequence
        this.endCurrentTurn(room.id);
    }

    chooseClass(socket, { classId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player || player.class || room.gameState.phase !== 'class_selection') return;

        this.assignClassToPlayer(player, classId, room.gameState.partyHope);
        this.emitGameState(room.id);
    }
    
    createNpcs(room, count) {
        // Always create the DM
        if (!room.players['npc-dm']) {
            const dmNpc = this.createPlayerObject('npc-dm', 'DM', true);
            dmNpc.role = 'DM';
            room.players[dmNpc.id] = dmNpc;
        }

        const npcNames = ["Grok", "Lyra", "Finn"];
        const availableClasses = Object.keys(gameData.classes);
        for (let i = 0; i < count; i++) {
            const name = npcNames[i % npcNames.length];
            const npcId = `npc-${name.toLowerCase()}-${i}`;
            const npc = this.createPlayerObject(npcId, name, true);
            npc.role = 'Explorer';
            const randomClassId = availableClasses[Math.floor(Math.random() * availableClasses.length)];
            this.assignClassToPlayer(npc, randomClassId, room.gameState.partyHope);
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
            environmental: shuffle(createDeck(gameData.environmentalCards)),
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
                 room.chatLog.push({ type: 'system', text: `${player.name}'s hand was full. Discarded ${discardedCard.name} for ${card.name}.`, timestamp: Date.now() });

            } else {
                const playerSocket = io.sockets.sockets.get(player.id);
                if (playerSocket) {
                    // HUMAN LOGIC: Prompt connected player to choose.
                    playerSocket.emit('chooseToDiscard', { newCard: card, currentHand: player.hand });
                } else {
                    // Fallback for disconnected humans: Discard the new card to prevent game stall.
                    room.gameState.discardPile.push(card);
                    room.chatLog.push({ type: 'system', text: `${player.name}'s hand was full and they are disconnected. '${card.name}' was discarded.`, timestamp: Date.now() });
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
        if (playerClass && (deckName === 'weapon' || deckName === 'armor' || deckName === 'treasure')) {
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
    assignClassToPlayer(player, classId, partyHope) {
        const classData = gameData.classes[classId];
        if (!classData || !player) return;
        player.class = classId;
        player.stats = this.calculatePlayerStats(player, partyHope);
    }
    
    /**
     * Recalculates all of a player's stats from scratch.
     * This is the single source of truth for player stats, called whenever equipment or status effects change.
     * Order of operations: Class Base Stats -> Equipment Bonuses -> Status Effect Bonuses -> Hope Bonuses.
     */
    calculatePlayerStats(player, partyHope) {
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

        // 4. Apply Party Hope bonus/penalty
        if (partyHope >= 9) totalStats.hitBonus += 1; // Inspired
        else if (partyHope <= 2) totalStats.hitBonus -= 1; // Despairing
    
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
        const itemType = cardToEquip.type.toLowerCase(); // 'weapon' or 'armor'
    
        if (itemType !== 'weapon' && itemType !== 'armor') return;
        
        // Deduct AP if in combat
        if (room.gameState.phase === 'started') {
            player.currentAp -= 1;
        }
    
        // Remove the new item from hand.
        player.hand.splice(cardIndex, 1);
    
        // If an item is already equipped in that slot, return it to the appropriate deck.
        if (player.equipment[itemType]) {
            const oldItem = player.equipment[itemType];
            room.gameState.decks.treasure.push(oldItem);
            shuffle(room.gameState.decks.treasure);
            room.chatLog.push({ type: 'system', text: `${player.name} returned their ${oldItem.name} to the treasure deck.`, timestamp: Date.now() });
        }
        
        // Equip the new item.
        player.equipment[itemType] = cardToEquip;
        player.stats = this.calculatePlayerStats(player, room.gameState.partyHope); // Recalculate stats with new item
        this.emitGameState(room.id);
    }
    
    // --- 3.5. Turn Management ---
    async startTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.phase !== 'started') return;
    
        const player = room.players[room.gameState.turnOrder[room.gameState.currentPlayerIndex]];
        if (!player) return;
    
        // --- Start of Turn Setup ---
        player.stats = this.calculatePlayerStats(player, room.gameState.partyHope);
        player.currentAp = player.stats.maxAP;
        player.usedAbilityThisTurn = false;
        if (!player.hasTakenFirstTurn) {
            player.hasTakenFirstTurn = true;
        }
        io.to(player.id).emit('turnStarted', { playerId: player.id });

        // --- Event Checks ---
        // Check for Individual Discovery event every 3 rounds for human players
        if (!player.isNpc && room.gameState.turnCount > 0 && room.gameState.turnCount % 3 === 0) {
            this.triggerIndividualDiscovery(room, player);
            this.emitGameState(roomId);
            return; // Halt the turn until discovery is resolved.
        }
    
        // If there's an active world event, activate the skill challenge phase for the player
        if (room.gameState.worldEvents.currentEvent?.eventType.includes('skill_challenge')) {
            room.gameState.skillChallenge = {
                isActive: true,
                details: room.gameState.worldEvents.currentEvent,
                currentStage: 0,
                targetId: null
            };
        }

        this.emitGameState(roomId);
    
        // --- AI Turn Logic ---
        if (player.isNpc) {
            // This robust try/catch ensures that any error during an AI turn will be logged
            // and the turn will end gracefully, preventing the entire game from stalling.
            try {
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
            } catch (error) {
                // Enhanced error logging for better debugging.
                console.error(`[CRITICAL AI ERROR] An error occurred during the turn for ${player.name} (Role: ${player.role}, ID: ${player.id}). The game will proceed to the next turn to prevent a stall.`);
                console.error("Error Details:", error.stack || error);
                
                // Even if AI fails, end its turn to not block the game.
                if(room.gameState.phase === 'started') {
                    this.endCurrentTurn(roomId);
                }
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
        // This block handles effects that expire at the end of a player's or the DM's turn.
        const oldPlayerIndex = room.gameState.currentPlayerIndex;
        if (oldPlayerIndex > -1) {
            const oldPlayer = room.players[room.gameState.turnOrder[oldPlayerIndex]];
            if (oldPlayer) {
                // Shield HP always expires at the end of the player's turn.
                if (oldPlayer.role === 'Explorer') oldPlayer.stats.shieldHp = 0;
                
                // Decrement duration of all status effects on the active player.
                oldPlayer.statusEffects = oldPlayer.statusEffects.map(e => ({...e, duration: e.duration - 1})).filter(e => e.duration > 0);
    
                // If it was the DM's turn, also decrement status effects on all monsters.
                if (oldPlayer.role === 'DM') {
                    room.gameState.board.monsters.forEach(m => {
                        m.statusEffects = m.statusEffects.map(e => ({...e, duration: e.duration - 1})).filter(e => e.duration > 0);
                    });
                }
            }
        }
        // Reset the skill challenge flag for the next player.
        room.gameState.skillChallenge.isActive = false; 
    
        // --- Find Next Player Phase ---
        // This loop ensures the game skips over any players who are downed or disconnected.
        let nextIndex, attempts = 0;
        do {
            nextIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
            const nextPlayerId = room.gameState.turnOrder[nextIndex];
            const nextPlayer = room.players[nextPlayerId];
            if (nextPlayer && !nextPlayer.isDowned && !nextPlayer.disconnected) {
                break; // Found a valid, active player.
            }
            attempts++;
        } while (attempts <= room.gameState.turnOrder.length)

        // --- Game Over Check ---
        // Checks if all human explorers are downed or have left the game.
        const allExplorersDown = Object.values(room.players)
            .filter(p => p.role === 'Explorer' && !p.isNpc)
            .every(p => p.isDowned || p.disconnected);

        if (allExplorersDown && attempts > room.gameState.turnOrder.length) {
            room.gameState.phase = 'game_over';
            room.gameState.winner = 'Monsters';
            this.emitGameState(roomId);
            return; // Stop the turn sequence.
        }

        // --- Start Next Turn ---
        room.gameState.currentPlayerIndex = nextIndex;
        // The turn counter increments only at the start of a full round (i.e., when it's the DM's turn again).
        if (nextIndex === 0) {
            room.gameState.turnCount++; 
        }
    
        this.startTurn(roomId);
    }
    
    // --- 3.6. AI Logic & Event Triggers ---
    async handleDmTurn(room) {
        // 1. World Event Management: Decrement duration of existing event at the START of the DM turn.
        if (room.gameState.worldEvents.currentEvent) {
            room.gameState.worldEvents.duration -= 1;
            if (room.gameState.worldEvents.duration <= 0) {
                room.chatLog.push({ type: 'system', text: `The event '${room.gameState.worldEvents.currentEvent.name}' has ended.`, timestamp: Date.now() });
                room.gameState.worldEvents.currentEvent = null;
                this.emitGameState(room.id); // Update clients that the event ended
                await new Promise(res => setTimeout(res, 1000));
            }
        }

        // 2. New World Event Check: 60% chance each DM turn if no event is currently active.
        if (!room.gameState.worldEvents.currentEvent && Math.random() < 0.60) {
            const eventCard = this.drawCardFromDeck(room.id, 'worldEvent');
            if(eventCard) {
                room.gameState.worldEvents.currentEvent = eventCard;
                room.gameState.worldEvents.duration = eventCard.duration || 2;
                room.chatLog.push({ type: 'dm', text: `A strange event unfolds: ${eventCard.name}!`, timestamp: Date.now() });
                room.chatLog.push({ type: 'system', text: eventCard.description || eventCard.stages[0].description, timestamp: Date.now() });
                this.emitGameState(room.id);
                await new Promise(res => setTimeout(res, 1500));
            }
        }
        
        // 3. Spawn Environmental Object Check: 25% chance to spawn if none exist.
        if (room.gameState.board.environment.length === 0 && Math.random() < 0.25) {
            const envCardData = this.drawCardFromDeck(room.id, 'environmental');
            if (envCardData) {
                const envCardInstance = { ...envCardData, id: this.generateUniqueCardId() };
                room.gameState.board.environment.push(envCardInstance);
                room.chatLog.push({ type: 'dm', text: `The party notices a ${envCardInstance.name} in the room.`, timestamp: Date.now() });
                this.emitGameState(room.id);
                await new Promise(res => setTimeout(res, 1000));
            }
        }

        // 4. Monster Spawning: Keep at least 2 monsters on the board.
        if (room.gameState.board.monsters.length < 2) {
            const monsterData = this.drawCardFromDeck(room.id, 'monster.tier1');
            if (monsterData) {
                const monsterInstance = { 
                    ...monsterData, 
                    id: this.generateUniqueCardId(), // Assign a unique instance ID
                    currentHp: monsterData.maxHp, 
                    statusEffects: [] 
                };
                room.gameState.board.monsters.push(monsterInstance);
                room.chatLog.push({ type: 'dm', text: gameData.npcDialogue.dm.playMonster[Math.floor(Math.random() * gameData.npcDialogue.dm.playMonster.length)], timestamp: Date.now() });
                this.emitGameState(room.id);
                await new Promise(res => setTimeout(res, 1000));
            }
        }

        // 5. Monster Attacks: Each monster attacks a random, living explorer.
        for (const monster of room.gameState.board.monsters) {
            if (monster.statusEffects.some(e => ['Stunned', 'Frightened'].includes(e.name))) {
                room.chatLog.push({ type: 'combat', text: `${monster.name} is ${monster.statusEffects[0].name} and cannot act!`, timestamp: Date.now() });
                this.emitGameState(room.id);
                await new Promise(res => setTimeout(res, 1500));
                continue;
            }

            const livingExplorers = Object.values(room.players).filter(p => p.role === 'Explorer' && !p.isDowned && !p.disconnected);
            if (livingExplorers.length > 0) {
                const target = livingExplorers[Math.floor(Math.random() * livingExplorers.length)];
                
                const hitRoll = this.rollDice('1d20');
                const totalRoll = hitRoll + monster.attackBonus;
                const targetAC = 10 + target.stats.shieldBonus; // Basic AC calculation
                
                const outcome = totalRoll >= targetAC ? 'Hit' : 'Miss';
                room.chatLog.push({ type: 'combat', text: `${monster.name} attacks ${target.name}... It rolled a ${totalRoll} and it's a ${outcome}!`, timestamp: Date.now() });
                
                if (outcome === 'Hit') {
                    const damageRoll = this.rollDice(monster.effect.dice);
                    const totalDamage = damageRoll + (monster.damageBonus || 0);
                    this.applyDamage(room, target, totalDamage);
                    room.chatLog.push({ type: 'combat-hit', text: `${monster.name} dealt ${totalDamage} damage to ${target.name}.`, timestamp: Date.now() });
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
                
                if (hitRoll === 20) { // NPC Crits
                    room.gameState.partyHope = Math.min(10, room.gameState.partyHope + 1);
                    room.chatLog.push({ type: 'system-good', text: `CRITICAL HIT! Party Hope increases!`, timestamp: Date.now() });
                }

                const outcome = totalRoll >= targetAC ? 'Hit' : 'Miss';
                room.chatLog.push({ type: 'combat', text: `${npc.name} attacks ${targetMonster.name} with ${weapon.name}... Rolled a ${totalRoll}. It's a ${outcome}!`, timestamp: Date.now() });

                if (outcome === 'Hit') {
                    const damageRoll = this.rollDice(weapon.effect.dice);
                    const totalDamage = damageRoll + npc.stats.damageBonus;
                    targetMonster.currentHp -= totalDamage;
                    room.chatLog.push({ type: 'combat-hit', text: `${npc.name} dealt ${totalDamage} damage to ${targetMonster.name}.`, timestamp: Date.now() });

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
            room.chatLog.push({ type: 'dm', text: `${defeatedMonster.name} has been defeated!`, timestamp: Date.now() });
            
            // If it was a boss, increase Party Hope
            if (defeatedMonster.isBoss) {
                room.gameState.partyHope = Math.min(10, room.gameState.partyHope + 2);
                room.chatLog.push({ type: 'system-good', text: `The party defeated a powerful foe! Party Hope surges!`, timestamp: Date.now() });
            }

            // Check for loot drop based on room settings.
            const lootDropChance = room.settings.lootDropRate || 80;
            if (Math.random() * 100 < lootDropChance) {
                const killer = room.players[killerId];
                const killerClass = killer ? killer.class : null;
                const lootCard = this.generateLoot(room.id, killerClass);
                if (lootCard) {
                    room.gameState.lootPool.push(lootCard);
                    room.chatLog.push({ type: 'system-good', text: `The party discovered a ${lootCard.name}!`, timestamp: Date.now() });
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
        if (!room || !player || player.isDowned || room.gameState.isPaused) return;

        // Block most actions if the player is in the middle of a discovery.
        if (player.isResolvingDiscovery && !['resolveDiscovery', 'resolveDiscoveryRoll'].includes(payload.action)) {
            return socket.emit('actionError', 'You must resolve your discovery first.');
        }
        
        const isMyTurn = room.gameState.turnOrder[room.gameState.currentPlayerIndex] === player.id;
        // Allow certain actions (claiming loot, discarding for new cards) even when it's not your turn.
        if (!isMyTurn && !['chooseNewCardDiscard', 'claimLoot', 'resolveDiscovery', 'resolveDiscoveryRoll'].includes(payload.action)) {
            return socket.emit('actionError', "It's not your turn.");
        }
    
        const actions = {
            'attack': this.resolveAttack,
            'resolveAttackRoll': this.resolveAttackRoll,
            'resolveDamageRoll': this.resolveDamageRoll,
            'useConsumable': this.resolveUseConsumable,
            'claimLoot': this.resolveClaimLoot,
            'chooseNewCardDiscard': this.resolveNewCardDiscard,
            'resolveDiscovery': this.resolveDiscovery,
            'resolveDiscoveryRoll': this.resolveDiscoveryRoll,
            'guard': this.resolveGuard,
            'respite': this.resolveRespite,
            'rest': this.resolveRest,
            'discardCard': this.resolveDiscardCard,
            'useAbility': this.resolveUseAbility,
            'resolveSkillCheck': this.resolveSkillCheck,
            'resolveSkillCheckRoll': this.resolveSkillCheckRoll,
            'resolveSkillInteraction': this.resolveSkillInteraction,
        };
    
        const actionHandler = actions[payload.action];
        if (actionHandler) {
            actionHandler.call(this, room, player, payload, socket);
        }
    }
    
    resolveAttack(room, player, { cardId, targetId, narrative }, socket) {
        if (narrative) {
            const sanitizedNarrative = escapeHtml(narrative.substring(0, 250));
            room.chatLog.push({ type: 'narrative', playerName: player.name, text: sanitizedNarrative, timestamp: Date.now() });
        }

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
    
    resolveAttackRoll(room, player, payload, socket) {
        try {
            const { weaponId, targetId } = payload;
            const target = room.gameState.board.monsters.find(m => m.id === targetId);
            const weapon = weaponId === 'unarmed' 
                ? { id: 'unarmed', name: 'Fists', effect: { dice: '1d4' } }
                : Object.values(player.equipment).find(e => e && e.id === weaponId);

            if (!target || !weapon || !weapon.effect || !weapon.effect.dice) {
                console.error(`Error resolving attack roll: Invalid target or weapon data.`, { weaponId, targetId });
                socket.emit('actionError', 'A server error occurred with weapon/target data.');
                socket.emit('diceRollError');
                return;
            }

            const hitBonus = player.stats.hitBonus || 0;
            const hitRoll = this.rollDice('1d20');
            const totalRoll = hitRoll + hitBonus;
            
            if (hitRoll === 20) { // Critical Hit!
                room.gameState.partyHope = Math.min(10, room.gameState.partyHope + 1);
                room.chatLog.push({ type: 'system-good', text: `${player.name} landed a CRITICAL HIT! Party Hope increases!`, timestamp: Date.now() });
            }

            const outcome = totalRoll >= target.requiredRollToHit ? 'Hit' : 'Miss';
            
            const resultPayload = {
                rollerId: player.id, rollerName: player.name, targetName: target.name,
                weaponName: weapon.name,
                roll: hitRoll, bonus: hitBonus, total: totalRoll, targetAC: target.requiredRollToHit,
                outcome,
            };
            
            io.to(room.id).emit('attackResolved', resultPayload);

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
        } catch (e) {
            console.error("Critical error in resolveAttackRoll:", e);
            socket.emit('actionError', 'A server error occurred during attack resolution.');
            socket.emit('diceRollError');
        }
    }
    
    resolveDamageRoll(room, player, payload, socket) {
        try {
            const { weaponId, targetId } = payload;
            const weapon = weaponId === 'unarmed' 
                ? { id: 'unarmed', name: 'Fists', effect: { dice: '1d4' } }
                : Object.values(player.equipment).find(e => e && e.id === weaponId);
            const target = room.gameState.board.monsters.find(m => m.id === targetId);

            if (!target || !weapon || !weapon.effect || !weapon.effect.dice) {
                console.error(`Error resolving damage roll: Invalid target or weapon data.`, { weaponId, targetId });
                socket.emit('actionError', 'A server error occurred with weapon/target data.');
                socket.emit('diceRollError');
                return;
            }

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
            this.emitGameState(room.id);
        } catch (e) {
            console.error("Critical error in resolveDamageRoll:", e);
            socket.emit('actionError', 'A server error occurred during damage resolution.');
            socket.emit('diceRollError');
        }
    }


    // Applies damage, accounting for shield HP first.
    applyDamage(room, target, damageAmount) {
        if (!target || target.isDowned) return;

        const shieldDamage = Math.min(damageAmount, target.stats.shieldHp);
        target.stats.shieldHp -= shieldDamage;
        damageAmount -= shieldDamage;

        if (damageAmount > 0) target.stats.currentHp -= damageAmount;

        if (target.stats.currentHp <= 0) {
            target.stats.currentHp = 0;
            target.isDowned = true;
            // If a player is downed, reduce Party Hope
            if (target.role === 'Explorer') {
                room.gameState.partyHope = Math.max(0, room.gameState.partyHope - 1);
                room.chatLog.push({ type: 'system-bad', text: `${target.name} has been downed! Party Hope falters.`, timestamp: Date.now() });
            }
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
            room.chatLog.push({ type: 'system-good', text: `${player.name} uses ${card.name} on ${targetPlayer.name}, healing for ${healing} HP.`, timestamp: Date.now() });
        } else if (card.effect.type === 'damage' && targetMonster) {
            const damage = this.rollDice(card.effect.dice);
            targetMonster.currentHp -= damage;
            room.chatLog.push({ type: 'combat-hit', text: `${player.name} uses ${card.name} on ${targetMonster.name}, dealing ${damage} damage.`, timestamp: Date.now() });
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
        room.chatLog.push({ type: 'system-good', text: `${targetPlayer.name} claimed the ${item.name}.`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }
    
    resolveNewCardDiscard(room, player, { cardToDiscardId, newCard }) {
        if (cardToDiscardId === newCard.id) {
            room.gameState.discardPile.push(newCard);
            room.chatLog.push({ type: 'system', text: `${player.name} discarded the new card, ${newCard.name}.`, timestamp: Date.now() });
        } else {
            const cardIndex = player.hand.findIndex(c => c.id === cardToDiscardId);
            if (cardIndex > -1) {
                const [discardedCard] = player.hand.splice(cardIndex, 1);
                room.gameState.discardPile.push(discardedCard);
                player.hand.push(newCard);
                room.chatLog.push({ type: 'system', text: `${player.name} discarded ${discardedCard.name} for ${newCard.name}.`, timestamp: Date.now() });
            }
        }
        this.emitGameState(room.id);
    }
    
    resolveGuard(room, player, _, socket) {
        if (player.currentAp < gameData.actionCosts.guard) return socket.emit('actionError', "Not enough AP.");
        player.currentAp -= gameData.actionCosts.guard;
        player.stats.shieldHp += player.stats.shieldBonus;
        room.chatLog.push({ type: 'action', text: `${player.name} takes a defensive stance, gaining ${player.stats.shieldBonus} Shield HP.`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }

    resolveRespite(room, player, _, socket) {
        if (player.currentAp < gameData.actionCosts.briefRespite) return socket.emit('actionError', "Not enough AP.");
        player.currentAp -= gameData.actionCosts.briefRespite;
        const healing = this.rollDice('1d4');
        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
        room.chatLog.push({ type: 'action-good', text: `${player.name} takes a brief respite, healing for ${healing} HP.`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }

    resolveRest(room, player, _, socket) {
        if (player.currentAp < gameData.actionCosts.fullRest) return socket.emit('actionError', "Not enough AP.");
        player.currentAp -= gameData.actionCosts.fullRest;
        const classData = gameData.classes[player.class];
        const healing = this.rollDice(`${classData.healthDice}d4`);
        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healing);
        room.chatLog.push({ type: 'action-good', text: `${player.name} takes a full rest, healing for ${healing} HP.`, timestamp: Date.now() });
        this.emitGameState(room.id);
    }
    
    resolveDiscardCard(room, player, { cardId }) {
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex > -1) {
            const [discardedCard] = player.hand.splice(cardIndex, 1);
            room.gameState.discardPile.push(discardedCard);
            room.chatLog.push({ type: 'system', text: `${player.name} discarded ${discardedCard.name}.`, timestamp: Date.now() });
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
            room.chatLog.push({ type: 'action-good', text: `${player.name} uses ${abilityName}!`, timestamp: Date.now() });
            this.emitGameState(room.id);
        }
    }

    // --- 3.8. Loot & Item Generation ---
    generateLoot(roomId, playerClass, rarityBoost = 0) {
        const baseCard = this.drawCardFromDeck(roomId, 'treasure', playerClass);
        if (!baseCard) return null;
        
        const roll = Math.random() * 100;
        let rarity = 'Common';
        // Rarity thresholds: Legendary < 5, Rare < 20, Uncommon < 50
        if (roll < (5 + rarityBoost)) rarity = 'Legendary';
        else if (roll < (20 + rarityBoost)) rarity = 'Rare';
        else if (roll < (50 + rarityBoost)) rarity = 'Uncommon';

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
    triggerIndividualDiscovery(room, player) {
        const socket = io.sockets.sockets.get(player.id);
        if (!socket) return;
        
        player.isResolvingDiscovery = true;

        const discoveryRollsEnabled = 
            room.gameState.gameMode === 'Beginner' || 
            room.gameState.gameMode === 'Advanced' ||
            (room.gameState.gameMode === 'Custom' && room.settings.discoveryRolls);

        if (discoveryRollsEnabled) {
            socket.emit('promptDiscoveryRoll', { title: 'Roll for Fortune!', dice: '1d20' });
        } else {
            // If rolls are disabled (only possible in Custom), use a fixed high boost
            const discoveredItem = this.generateLoot(room.id, player.class, 25);
            if (discoveredItem) {
                player.discoveryItem = discoveredItem;
                room.chatLog.push({ type: 'system-good', text: `${player.name} has made a personal discovery!`, timestamp: Date.now() });
                socket.emit('promptIndividualDiscovery', { newCard: discoveredItem });
            } else {
                player.isResolvingDiscovery = false; // No item found
            }
        }
    }
    
    resolveDiscoveryRoll(room, player, payload, socket) {
        if (!player.isResolvingDiscovery) return;

        const roll = this.rollDice('1d20');
        let rarityBoost = 0;
        if (roll <= 10) rarityBoost = 0; // 50% chance common
        else if (roll <= 15) rarityBoost = 15; // 25% chance uncommon
        else if (roll <= 19) rarityBoost = 25; // 20% chance rare
        else rarityBoost = 40; // 5% chance legendary

        // Emit the roll result back to the player so they can see it
        socket.emit('discoveryRollResolved', {
            rollerId: player.id,
            rollerName: player.name,
            roll: roll,
        });

        const discoveredItem = this.generateLoot(room.id, player.class, rarityBoost);
        if (discoveredItem) {
            player.discoveryItem = discoveredItem;
            socket.emit('promptIndividualDiscovery', { newCard: discoveredItem });
        } else {
            player.isResolvingDiscovery = false;
            room.chatLog.push({ type: 'system', text: `Despite their efforts, ${player.name} found nothing of interest.`, timestamp: Date.now() });
        }
        this.emitGameState(room.id);
    }

    resolveDiscovery(room, player, { keptItemId }) {
        if (!player.isResolvingDiscovery || !player.discoveryItem) return;
    
        const newCard = player.discoveryItem;
        // Ensure itemType is either 'weapon' or 'armor' to prevent errors
        const itemType = (newCard.type || '').toLowerCase();
        if (itemType !== 'weapon' && itemType !== 'armor') {
            player.isResolvingDiscovery = false;
            player.discoveryItem = null;
            this.emitGameState(room.id);
            return;
        }
    
        const currentlyEquipped = player.equipment[itemType];
        let unkeptItem = null;
    
        if (keptItemId === newCard.id) {
            // Player kept the new item. The old item (if it exists) is unkept.
            player.equipment[itemType] = newCard;
            unkeptItem = currentlyEquipped;
            if (unkeptItem) {
                room.chatLog.push({ type: 'system-good', text: `${player.name} equipped the newfound ${newCard.name}, replacing their ${unkeptItem.name}!`, timestamp: Date.now() });
            } else {
                room.chatLog.push({ type: 'system-good', text: `${player.name} equipped the newfound ${newCard.name}!`, timestamp: Date.now() });
            }
        } else if (currentlyEquipped && keptItemId === currentlyEquipped.id) {
            // Player kept their old item. The new item is unkept.
            unkeptItem = newCard;
            room.chatLog.push({ type: 'system', text: `${player.name} decided to keep their ${currentlyEquipped.name} instead of the ${newCard.name}.`, timestamp: Date.now() });
        } else {
             // Failsafe: if the keptItemId is invalid, assume they kept their old gear.
             unkeptItem = newCard;
             if (currentlyEquipped) {
                 room.chatLog.push({ type: 'system', text: `${player.name} decided to keep their ${currentlyEquipped.name} over the ${newCard.name}.`, timestamp: Date.now() });
             } else {
                 room.chatLog.push({ type: 'system', text: `${player.name} decided to leave the ${newCard.name} behind.`, timestamp: Date.now() });
             }
        }
        
        // Return the unkept item to the treasure deck
        if (unkeptItem) {
            room.gameState.decks.treasure.push(unkeptItem);
            shuffle(room.gameState.decks.treasure);
        }
        
        // Reset state and recalculate stats
        player.isResolvingDiscovery = false;
        player.discoveryItem = null;
        player.stats = this.calculatePlayerStats(player, room.gameState.partyHope);
        this.emitGameState(room.id);
    }

    resolveSkillInteraction(room, player, { cardId, interactionName }, socket) {
        const allBoardCards = [...room.gameState.board.monsters, ...room.gameState.board.environment];
        const sourceCard = allBoardCards.find(c => c.id === cardId);
        if (!sourceCard || !sourceCard.skillInteractions) return;

        const interaction = sourceCard.skillInteractions.find(i => i.name === interactionName);
        if (!interaction) return;

        if (player.currentAp < interaction.apCost) return socket.emit('actionError', "Not enough AP.");
        player.currentAp -= interaction.apCost;

        // If it's a multi-stage challenge embedded in an interaction (like a trapped chest)
        if (interaction.eventType === 'multi_stage_skill_challenge') {
            room.gameState.skillChallenge = {
                isActive: true,
                details: interaction,
                currentStage: 0,
                targetId: cardId // Link the challenge to the source card
            };
            this.resolveSkillCheck(room, player, { apCost: 0 }, socket); // Start the challenge, no extra AP cost
            return;
        }

        const bonus = player.stats[interaction.skill] || 0;
        socket.emit('promptSkillCheckRoll', {
            title: interactionName,
            description: `Attempting to ${interactionName} the ${sourceCard.name}. + ${bonus} vs Target AC of ${interaction.dc}`,
            dice: '1d20',
            bonus,
            targetAC: interaction.dc,
            skill: interaction.skill,
            interactionData: { cardId, interactionName } // Pass context for resolution
        });
        this.emitGameState(room.id);
    }
    
    resolveSkillCheck(room, player, { apCost = 1 }, socket) {
        if (!room.gameState.skillChallenge.isActive) return;
        const challenge = room.gameState.skillChallenge.details;
        
        if (player.currentAp < apCost) return socket.emit('actionError', "Not enough AP to attempt the challenge.");
        if (apCost > 0) player.currentAp -= apCost;
        
        const currentStage = room.gameState.skillChallenge.currentStage;
        const stageDetails = challenge.eventType === 'multi_stage_skill_challenge' ? challenge.stages[currentStage] : challenge;

        let hasAdvantage = false;
        const relevantItem = player.hand.find(card => card.relevantSkill && card.relevantSkill === stageDetails.skill);
        if (relevantItem) hasAdvantage = true;

        const bonus = player.stats[stageDetails.skill] || 0;
        
        socket.emit('promptSkillCheckRoll', {
            title: `Skill Challenge: ${challenge.name}`,
            description: stageDetails.description,
            dice: '1d20',
            bonus,
            targetAC: stageDetails.dc,
            hasAdvantage,
            skill: stageDetails.skill,
            relevantItemName: relevantItem ? relevantItem.name : null,
            interactionData: room.gameState.skillChallenge.targetId ? { cardId: room.gameState.skillChallenge.targetId } : null
        });

        this.emitGameState(room.id);
    }

    resolveSkillCheckRoll(room, player, payload, socket) {
        try {
            const challenge = room.gameState.skillChallenge.details;
            let roll;
            const advantageText = '';
            
            if (payload.hasAdvantage) {
                const [roll1, roll2] = [this.rollDice('1d20'), this.rollDice('1d20')];
                roll = Math.max(roll1, roll2);
                room.chatLog.push({ type: 'system-good', text: `${player.name} uses their ${payload.relevantItemName} to gain advantage! (Rolled ${roll1}, ${roll2})`, timestamp: Date.now() });
            } else {
                roll = this.rollDice('1d20');
            }
            
            const isInteraction = payload.interactionData;
            const sourceCardId = isInteraction ? payload.interactionData.cardId : room.gameState.skillChallenge.targetId;
            const currentStageIndex = room.gameState.skillChallenge.currentStage;
            let sourceCard = null;
            if (sourceCardId) {
                sourceCard = [...room.gameState.board.monsters, ...room.gameState.board.environment].find(c => c.id === sourceCardId);
            }

            let stageDetails = null;
            if (isInteraction && sourceCard) {
                stageDetails = sourceCard.skillInteractions?.find(i => i.name === payload.interactionData.interactionName);
            } else if (challenge) {
                stageDetails = challenge.eventType === 'multi_stage_skill_challenge' 
                    ? challenge.stages[currentStageIndex] 
                    : challenge;
            }
            
            if (!stageDetails) {
                console.error("Could not find stage details for skill check.", { payload });
                socket.emit('diceRollError');
                return;
            }

            const statBonus = player.stats[stageDetails.skill] || 0;
            const total = roll + statBonus;
            const outcome = total >= stageDetails.dc ? 'Success' : 'Failure';
            
            const effect = outcome === 'Success' ? stageDetails.success : stageDetails.failure;

            room.chatLog.push({ type: 'system', text: `${player.name} attempts ${challenge?.name || stageDetails.name}... (Roll: ${roll}${advantageText} + ${statBonus} ${stageDetails.skill.toUpperCase()} = ${total} vs DC ${stageDetails.dc}) - ${outcome}!`, timestamp: Date.now() });
            if (effect.text) room.chatLog.push({ type: outcome === 'Success' ? 'system-good' : 'system-bad', text: effect.text, timestamp: Date.now() });

            // Apply effect
            this.applySkillCheckEffect(room, player, effect, sourceCardId);

            // Handle multi-stage progression
            const isMultiStage = challenge && challenge.eventType === 'multi_stage_skill_challenge';
            if (isMultiStage && outcome === 'Success' && currentStageIndex < challenge.stages.length - 1) {
                room.gameState.skillChallenge.currentStage++;
                const nextStage = challenge.stages[room.gameState.skillChallenge.currentStage];
                room.chatLog.push({ type: 'system', text: `Next stage: ${nextStage.description}`, timestamp: Date.now() });
                // Re-trigger the check for the next stage automatically
                this.resolveSkillCheck(room, player, { apCost: 0 }, socket);
            } else {
                // End the challenge
                room.gameState.skillChallenge.isActive = false;
                room.gameState.skillChallenge.details = null;
                if (challenge && challenge.type === 'World Event') room.gameState.worldEvents.currentEvent = null;
            }

            io.to(room.id).emit('skillCheckResolved', { rollerId: player.id, rollerName: player.name, roll, bonus: statBonus, total, targetAC: stageDetails.dc, outcome });
            this.emitGameState(room.id);
        } catch (e) {
            console.error("Critical error in resolveSkillCheckRoll:", e);
            socket.emit('actionError', 'A server error occurred during a skill check.');
            socket.emit('diceRollError');
        }
    }
    
    applySkillCheckEffect(room, player, effect, sourceCardId) {
        if (!effect) return;
        switch (effect.type) {
            case 'damage':
            case 'self_damage':
                this.applyDamage(room, player, this.rollDice(effect.value));
                break;
            case 'aoe_damage':
                room.gameState.board.monsters.forEach(monster => {
                    monster.currentHp -= this.rollDice(effect.value);
                    if (monster.currentHp <= 0) this.handleMonsterDefeated(room, monster.id, player.id);
                });
                break;
            case 'loot':
                const lootCard = this.generateLoot(room.id, player.class);
                if (lootCard) {
                    room.gameState.lootPool.push(lootCard);
                    room.chatLog.push({ type: 'system-good', text: `The party found a ${lootCard.name}!`, timestamp: Date.now() });
                }
                break;
            case 'status_effect':
                const target = room.gameState.board.monsters.find(m => m.id === sourceCardId);
                if (target) {
                    target.statusEffects.push({ name: effect.effect, duration: effect.duration });
                }
                break;
            case 'apply_vulnerability':
                // This is a special, temporary effect. We'll add it directly to the monster.
                const monsterTarget = room.gameState.board.monsters.find(m => m.id === sourceCardId);
                if(monsterTarget) {
                    monsterTarget.statusEffects.push({ name: 'Vulnerable', duration: 2, description: 'Next attack has advantage.' });
                }
                break;
            case 'none':
            default:
                break;
        }
    }


    // --- 3.10. Chat & Disconnect Logic ---
    handleChatMessage(socket, { channel, message }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player) return;

        const sanitizedMessage = escapeHtml(message.substring(0, 250));
        room.chatLog.push({ type: 'chat', playerId: player.id, playerName: player.name, channel, text: sanitizedMessage, timestamp: Date.now() });
        this.emitGameState(room.id);
    }
    
    handleDisconnect(socket) {
        const roomId = this.socketToRoom[socket.id];
        const room = this.rooms[roomId];
        if (!room) return;

        const player = room.players[socket.id];
        if (!player) return;

        player.disconnected = true;
        room.chatLog.push({ type: 'system', text: `${player.name} has disconnected.`, timestamp: Date.now() });
        
        // Handle voice chat disconnect
        const vcIndex = room.voiceChatters.indexOf(socket.id);
        if (vcIndex > -1) {
            room.voiceChatters.splice(vcIndex, 1);
            io.to(roomId).emit('voice-chatter-left', socket.id);
        }

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
            // Add an NPC back to keep the player count at 4
            this.createNpcs(room, 1);
        } else { // Game is in progress
            // Start a 30-second timer. If they don't reconnect, pause the game.
            player.pauseTimer = setTimeout(() => {
                if (!room.gameState.isPaused) {
                    room.gameState.isPaused = true;
                    room.gameState.pauseReason = `${player.name} has disconnected. Waiting for them to reconnect...`;
                    this.emitGameState(roomId);
                }

                // Start a 90-second timer to replace them with an NPC
                player.replacementTimer = setTimeout(() => {
                    const stillDisconnectedPlayer = room.players[socket.id];
                    if (stillDisconnectedPlayer && stillDisconnectedPlayer.disconnected) {
                        this.replacePlayerWithNpc(room, socket.id);
                        if (room.gameState.isPaused) {
                            room.gameState.isPaused = false;
                            room.gameState.pauseReason = '';
                        }
                        this.emitGameState(roomId);
                    }
                }, 90000); // 90 seconds
            }, 30000); // 30 seconds
        }
        
        delete this.socketToRoom[socket.id];
        this.emitGameState(roomId);
    }

    replacePlayerWithNpc(room, oldSocketId) {
        const player = room.players[oldSocketId];
        if (!player) return;
    
        room.chatLog.push({ type: 'system', text: `${player.name} was replaced by an NPC due to inactivity.`, timestamp: Date.now() });

        // Save the player's data for potential reconnection
        room.savedPlayers[player.playerId] = {
            class: player.class,
            equipment: player.equipment,
            hand: player.hand,
            stats: player.stats
        };
    
        // Create a new NPC to take their place
        const npcId = `npc-replacement-${Math.random().toString(36).substr(2, 5)}`;
        const npc = this.createPlayerObject(npcId, `${player.name} (AI)`, true);
        npc.role = 'Explorer';
        npc.class = player.class;
        npc.equipment = player.equipment;
        npc.hand = player.hand;
        npc.stats = player.stats;
        npc.isDowned = player.isDowned;
        
        // Replace in players object
        delete room.players[oldSocketId];
        room.players[npcId] = npc;
    
        // Replace in turn order
        const turnIndex = room.gameState.turnOrder.indexOf(oldSocketId);
        if (turnIndex > -1) {
            room.gameState.turnOrder[turnIndex] = npcId;
        }
    }
    
    rejoinRoom(socket, { roomId, playerId }) {
        const room = this.rooms[roomId];
        if (!room) return;

        // Find the player data using their persistent playerId
        const originalPlayerEntry = Object.entries(room.players).find(([id, p]) => p.playerId === playerId);
        
        if (originalPlayerEntry) {
            const [oldSocketId, playerObject] = originalPlayerEntry;
            
            // Clear any pending timers for this player
            if (playerObject.pauseTimer) clearTimeout(playerObject.pauseTimer);
            if (playerObject.replacementTimer) clearTimeout(playerObject.replacementTimer);

            // Re-assign the player object to the new socket.id
            delete room.players[oldSocketId];
            playerObject.id = socket.id;
            playerObject.disconnected = false;
            
            room.players[socket.id] = playerObject;
            socket.join(roomId);
            this.socketToRoom[socket.id] = roomId;
            
            // Update turn order with new socket id
            const turnIndex = room.gameState.turnOrder.indexOf(oldSocketId);
            if (turnIndex > -1) room.gameState.turnOrder[turnIndex] = socket.id;

            room.chatLog.push({ type: 'system-good', text: `${playerObject.name} has reconnected.`, timestamp: Date.now() });
            
            // If the game was paused for this player, unpause it.
            if (room.gameState.isPaused && room.gameState.pauseReason.includes(playerObject.name)) {
                room.gameState.isPaused = false;
                room.gameState.pauseReason = '';
            }

        } else if (room.savedPlayers[playerId]) {
            // Player was replaced by an NPC. Try to find an open NPC slot to rejoin into.
            const npcToReplace = Object.values(room.players).find(p => p.isNpc && p.role === 'Explorer');
            if (npcToReplace) {
                delete room.players[npcToReplace.id];
                const savedData = room.savedPlayers[playerId];
                
                const newPlayer = this.createPlayerObject(socket.id, savedData.name);
                Object.assign(newPlayer, savedData); // Restore saved data
                newPlayer.disconnected = false;

                room.players[socket.id] = newPlayer;
                socket.join(roomId);
                this.socketToRoom[socket.id] = roomId;

                const turnIndex = room.gameState.turnOrder.indexOf(npcToReplace.id);
                if(turnIndex > -1) room.gameState.turnOrder[turnIndex] = socket.id;
                
                delete room.savedPlayers[playerId];
                room.chatLog.push({ type: 'system-good', text: `${newPlayer.name} has rejoined the game!`, timestamp: Date.now() });
            } else {
                 socket.emit('actionError', 'Could not rejoin, the game is now full.');
                 return;
            }
        } else {
            socket.emit('actionError', 'Could not find your player in this game.');
            return;
        }

        socket.emit('playerIdentity', { playerId: playerId, roomId });
        this.emitGameState(roomId);
    }
}


// --- 4. SOCKET.IO CONNECTION HANDLING ---
const gameManager = new GameManager();

io.on('connection', (socket) => {
    socket.on('createRoom', (data) => gameManager.createRoom(socket, data));
    socket.on('joinRoom', (data) => gameManager.joinRoom(socket, data));
    socket.on('rejoinRoom', (data) => gameManager.rejoinRoom(socket, data));
    socket.on('chooseClass', (data) => gameManager.chooseClass(socket, data));
    socket.on('startGame', () => gameManager.startGame(socket));
    socket.on('equipItem', (data) => gameManager.equipItem(socket, data));
    socket.on('endTurn', () => gameManager.endTurn(socket));
    socket.on('playerAction', (data) => gameManager.handlePlayerAction(socket, data));
    socket.on('chatMessage', (data) => gameManager.handleChatMessage(socket, data));
    
    // WebRTC Signaling
    socket.on('join-voice-chat', () => {
        const room = gameManager.findRoomBySocket(socket);
        if (room) {
            socket.emit('existing-voice-chatters', room.voiceChatters);
            room.voiceChatters.push(socket.id);
            socket.to(room.id).emit('new-voice-chatter', socket.id);
        }
    });

    socket.on('leave-voice-chat', () => {
        const room = gameManager.findRoomBySocket(socket);
        if (room) {
            room.voiceChatters = room.voiceChatters.filter(id => id !== socket.id);
            socket.to(room.id).emit('voice-chatter-left', socket.id);
        }
    });

    socket.on('webrtc-signal', (payload) => {
        io.to(payload.to).emit('webrtc-signal', {
            from: socket.id,
            signal: payload.signal
        });
    });

    socket.on('disconnect', () => gameManager.handleDisconnect(socket));
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});