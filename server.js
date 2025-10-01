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
            stats: { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, shieldHp: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
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
            stats: { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, shieldHp: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
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
        
        // 5. Finalize stats for all players
        Object.values(room.players).forEach(p => {
            p.stats = this.calculatePlayerStats(p);
            p.stats.currentHp = p.stats.maxHp;
        });

        // 6. Set turn order and start the game
        const explorerIds = Object.keys(room.players).filter(id => room.players[id].role === 'Explorer');
        const dmId = Object.keys(room.players).find(id => room.players[id].role === 'DM');
        room.gameState.turnOrder = [dmId, ...shuffle(explorerIds)];
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

        let itemsToDraw = 0, spellsToDraw = 0;
        if (gameMode === 'Beginner') { itemsToDraw = 2; spellsToDraw = 2; }
        if (gameMode === 'Advanced') { itemsToDraw = 2; spellsToDraw = 1; }
        if (gameMode === 'Custom') { itemsToDraw = customSettings.startingItems; spellsToDraw = customSettings.startingSpells; }

        for (let i = 0; i < itemsToDraw; i++) {
            this._giveCardToPlayer(room, player, this.drawCardFromDeck(room.id, 'item'));
        }
        for (let i = 0; i < spellsToDraw; i++) {
            this._giveCardToPlayer(room, player, this.drawCardFromDeck(room.id, 'spell', player.class));
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
        const baseStats = { maxHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, shieldHp: player.stats.shieldHp || 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
        if (!player.class) return baseStats;
    
        const classData = gameData.classes[player.class];
        const newStats = {
            ...baseStats,
            maxHp: classData.baseHp,
            damageBonus: classData.baseDamageBonus,
            shieldBonus: classData.baseShieldBonus,
            ap: classData.baseAp,
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
        player.currentAp = player.stats.ap;
    
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
    
        if (room.gameState.currentPlayerIndex === 0) {
            room.gameState.turnCount++;
        }
    
        this.startTurn(room.id);
    }

    // --- 3.6. AI Logic (NPC Turns) ---
    async handleDmTurn(room) {
        const pause = ms => new Promise(res => setTimeout(res, ms));
        if (room.gameState.turnCount === 1) {
             const playMonsterChance = 0.7;
             if (Math.random() < playMonsterChance) {
                 this.dmPlayMonster(room);
             } else {
                 this.dmPlayWorldEvent(room);
             }
             this.emitGameState(room.id);
        } else {
            if (room.gameState.board.monsters.length > 0) {
                 for (const monster of [...room.gameState.board.monsters]) {
                    await pause(1000);
                    const targetId = this._chooseMonsterTarget(room);
                    if (targetId) {
                         await this._resolveFullMonsterAttack(room, monster.id, targetId);
                         if (room.gameState.phase === 'game_over') break; // Stop attacking if game ends
                    }
                }
            } else {
                this.dmPlayMonster(room);
                this.emitGameState(room.id);
            }
        }
    }
    
     async handleNpcExplorerTurn(room, player) {
        const pause = ms => new Promise(res => setTimeout(res, ms));
        const monsters = room.gameState.board.monsters;
        let actionTaken = false;

        if (monsters.length > 0) {
            const weakestMonster = [...monsters].sort((a, b) => a.currentHp - b.currentHp)[0];
            const weapon = player.equipment.weapon;
            const weaponApCost = weapon?.apCost || 2;
            const unarmedApCost = 1;

            const canUseWeapon = weapon && player.currentAp >= weaponApCost;
            const canUseUnarmed = player.currentAp >= unarmedApCost;

            if (canUseWeapon || canUseUnarmed) {
                const weaponId = canUseWeapon ? weapon.id : 'unarmed';
                const narrative = gameData.npcDialogue.explorer.attack[Math.floor(Math.random() * gameData.npcDialogue.explorer.attack.length)];
                room.chatLog.push({ type: 'narrative', playerName: player.name, text: narrative });
                this.emitGameState(room.id);
                await pause(1000);
                
                await this._resolveFullPlayerAttack(room, player, { weaponId, targetId: weakestMonster.id });
                actionTaken = true;
            }
        }

        if (!actionTaken && player.currentAp >= 1) {
             player.currentAp -= 1;
             player.stats.shieldHp += player.equipment.armor?.guardBonus || 2;
             actionTaken = true;
        }

        if (actionTaken) {
            this.emitGameState(room.id);
        }
    }

    _chooseMonsterTarget(room) {
        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer' && p.stats.currentHp > 0 && !p.isDowned);
        return explorers.length > 0 ? explorers[Math.floor(Math.random() * explorers.length)].id : null;
    }

    dmPlayMonster(room) {
        const { turnCount } = room.gameState;
        const tier = turnCount <= 3 ? 'tier1' : (turnCount <= 6 ? 'tier2' : 'tier3');
        const monsterCard = this.drawCardFromDeck(room.id, `monster.${tier}`);
        if (monsterCard) {
            monsterCard.currentHp = monsterCard.maxHp;
            monsterCard.statusEffects = [];
            room.gameState.board.monsters.push(monsterCard);
            room.chatLog.push({ type: 'system', text: `The Dungeon Master summons a ${monsterCard.name}!` });
        }
    }
    
    dmPlayWorldEvent(room) {
        const eventCard = this.drawCardFromDeck(room.id, 'worldEvent');
        if (eventCard) {
            room.gameState.worldEvents.currentEvent = eventCard;
            room.gameState.worldEvents.duration = 2;
        }
    }
    
    // --- 3.7. Action Resolution ---
    handlePlayerAction(socket, data) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        // Allow skill check resolution even if it's not your turn
        if (data.action === 'resolveSkillCheck') {
            if (room && room.gameState.phase === 'skill_challenge') {
                 // Placeholder logic as requested
                room.chatLog.push({ type: 'system', text: `${player.name} leads the party in resolving the challenge...` });
                room.gameState.phase = 'started'; 
                room.gameState.skillChallenge = { isActive: false, details: null };
                this.emitGameState(room.id);
            }
            return;
        }

        if (!player || player.isDowned || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== player.id) return;
        
        // P0 FIX: Halt any new player-initiated action if they have no AP.
        if (player.currentAp <= 0 && data.action !== 'resolve_hit' && data.action !== 'resolve_damage') {
            socket.emit('apZeroPrompt');
            return; // Halt the action immediately.
        }

        const { action, cardId, targetId, weaponId, narrative, itemId, targetPlayerId } = data;

        switch (action) {
            case 'attack':
                this._initiateAttack(socket, room, player, { weaponId: cardId, targetId, narrative });
                break;
            case 'resolve_hit':
                 this._resolveHitRoll(room, player, { weaponId: data.weaponId, targetId: data.targetId });
                 break;
            case 'resolve_damage':
                 this._resolveDamageRoll(room, player, { weaponId: data.weaponId, targetId: data.targetId });
                 break;
            case 'discardCard': {
                if (!cardId) return;
                const cardIndex = player.hand.findIndex(c => c.id === cardId);
                if (cardIndex > -1) {
                    const [discardedCard] = player.hand.splice(cardIndex, 1);
                    room.gameState.discardPile.push(discardedCard);
                    room.chatLog.push({ type: 'system', text: `${player.name} discards ${discardedCard.name}.` });
                    this.emitGameState(room.id);
                }
                break;
            }
            case 'chooseNewCardDiscard': {
                const { cardToDiscardId, newCard } = data;
                if (!cardToDiscardId || !newCard) return;
    
                if (cardToDiscardId === newCard.id) {
                    room.gameState.discardPile.push(newCard);
                    room.chatLog.push({ type: 'system', text: `${player.name}'s hand was full. They chose to discard the new card: ${newCard.name}.` });
                } else {
                    const cardIndex = player.hand.findIndex(c => c.id === cardToDiscardId);
                    if (cardIndex > -1) {
                        const [cardFromHand] = player.hand.splice(cardIndex, 1);
                        room.gameState.discardPile.push(cardFromHand);
                        player.hand.push(newCard);
                        room.chatLog.push({ type: 'system', text: `${player.name}'s hand was full. They discarded ${cardFromHand.name} to make room for ${newCard.name}.` });
                    }
                }
                this.emitGameState(room.id);
                break;
            }
            case 'guard': {
                const guardCost = gameData.actionCosts.guard;
                if (player.currentAp >= guardCost) {
                    const conBonus = this._getStatModifier(player, 'con');
                    const shieldGain = (player.equipment.armor?.guardBonus || 2) + conBonus;
                    player.currentAp -= guardCost;
                    player.stats.shieldHp += shieldGain;
                    socket.emit('showToast', { message: `You gain ${shieldGain} Shield.` });
                    if (player.currentAp <= 0) {
                        socket.emit('apZeroPrompt');
                    }
                }
                this.emitGameState(room.id);
                break;
            }
            case 'respite': {
                const cost = 1;
                if (player.currentAp < cost) return;
                player.stats.shieldHp = (player.stats.shieldHp || 0) + 1;
                player.currentAp -= cost;
                socket.emit('showToast', { message: 'You take a brief respite and restore 1 Shield.' });
                if (player.currentAp <= 0) {
                    socket.emit('apZeroPrompt');
                }
                this.emitGameState(room.id);
                break;
            }
            case 'rest': {
                const cost = 2;
                if (player.currentAp < cost) return;
                player.stats.currentHp = Math.min(player.stats.currentHp + 5, player.stats.maxHp);
                player.currentAp -= cost;
                socket.emit('showToast', { message: 'You rest and restore 5 HP.' });
                if (player.currentAp <= 0) {
                    socket.emit('apZeroPrompt');
                }
                this.emitGameState(room.id);
                break;
            }
            case 'useAbility':
                this._resolveAbility(socket, room, player, data);
                break;
            case 'useConsumable':
                this._resolveUseConsumable(socket, room, player, { cardId, targetId });
                break;
            case 'claimLoot': {
                const lootIndex = room.gameState.lootPool.findIndex(i => i.id === itemId);
                if (lootIndex === -1) return;
                
                const targetPlayerForLoot = room.players[targetPlayerId];
                if (!targetPlayerForLoot || targetPlayerForLoot.role !== 'Explorer') return;
    
                const [claimedItem] = room.gameState.lootPool.splice(lootIndex, 1);
                this._giveCardToPlayer(room, targetPlayerForLoot, claimedItem);
    
                room.chatLog.push({ type: 'system', text: `${player.name} claimed ${claimedItem.name} for ${targetPlayerForLoot.name}.` });
                this.emitGameState(room.id);
                break;
            }
        }
    }

    _initiateAttack(socket, room, player, { weaponId, targetId, narrative }) {
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!target) return;

        const isUnarmed = weaponId === 'unarmed';
        const weapon = isUnarmed ? null : player.equipment.weapon;
        if (!isUnarmed && (!weapon || weapon.id !== weaponId)) return;

        const apCost = isUnarmed ? 1 : (weapon.apCost || 2);
        if (player.currentAp < apCost) return;

        if (narrative && narrative.trim().length > 0) {
            room.chatLog.push({ type: 'narrative', playerName: player.name, text: narrative });
            this.emitGameState(room.id);
        }

        const strBonus = this._getStatModifier(player, 'str');
        const toHitBonus = strBonus + (player.stats.hitBonus || 0);
        
        socket.emit('promptAttackRoll', {
            action: 'attack',
            weaponId,
            targetId,
            dice: '1d20',
            bonus: toHitBonus,
            targetAC: target.requiredRollToHit,
            title: `Attack: Hit Check`
        });
    }
    
    _resolveHitRoll(room, attacker, { weaponId, targetId }) {
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!attacker || !target) return;

        const isUnarmed = weaponId === 'unarmed';
        const weapon = isUnarmed ? null : attacker.equipment.weapon;
        if (!isUnarmed && (!weapon || weapon.id !== weaponId)) return;

        const apCost = isUnarmed ? 1 : (weapon.apCost || 2);
        if (attacker.currentAp < apCost) return;
        
        const strBonus = this._getStatModifier(attacker, 'str');
        const toHitBonus = strBonus + (attacker.stats.hitBonus || 0);
        const d20 = this.rollDice('1d20');
        const totalRoll = d20 + toHitBonus;
        const isCrit = d20 === 20;
        const isMiss = d20 === 1;
        const hit = !isMiss && (isCrit || totalRoll >= target.requiredRollToHit);

        // SECURITY FIX: Store crit status server-side
        if (isCrit) {
            attacker.isGuaranteedCrit = true;
        }

        // Consume single-use hit buffs like Divine Aid
        const divineAidBuffIndex = attacker.statusEffects.findIndex(e => e.name === 'Divine Aid');
        if (divineAidBuffIndex > -1) {
            attacker.statusEffects.splice(divineAidBuffIndex, 1);
        }

        const damageDice = isUnarmed ? '1d4' : weapon.effect.dice;

        const result = {
            rollerId: attacker.id,
            rollerName: attacker.name,
            action: 'Attack',
            targetName: target.name,
            dice: '1d20',
            roll: d20,
            bonus: toHitBonus,
            total: totalRoll,
            targetAC: target.requiredRollToHit,
            outcome: isCrit ? 'CRIT!' : (hit ? 'HIT' : 'MISS'),
            needsDamageRoll: hit,
            damageDice: hit ? damageDice : null,
            weaponId,
            targetId,
        };
        
        room.chatLog.push({ type: 'system', text: `${attacker.name} attacks ${target.name}... ${result.outcome}! (Rolled ${result.total})` });

        if (!hit) {
            attacker.currentAp -= apCost;
            if (attacker.currentAp <= 0) {
                const socket = io.sockets.sockets.get(attacker.id);
                if (socket) socket.emit('apZeroPrompt');
            }
            this.emitGameState(room.id);
        }

        io.to(room.id).emit('attackResult', result);
    }

    _resolveDamageRoll(room, attacker, { weaponId, targetId }) { // isCrit removed
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!attacker || !target) return;

        // SECURITY FIX: Check internal state for crit, don't trust client.
        const isCrit = attacker.isGuaranteedCrit;
        if (isCrit) {
            attacker.isGuaranteedCrit = false; // Clear the flag after use
        }

        const isUnarmed = weaponId === 'unarmed';
        const weapon = isUnarmed ? null : attacker.equipment.weapon;
        if (!isUnarmed && (!weapon || weapon.id !== weaponId)) return;
        
        const apCost = isUnarmed ? 1 : (weapon.apCost || 2);
        if (attacker.currentAp < apCost) return;
        attacker.currentAp -= apCost;

        const damageDice = isUnarmed ? '1d4' : weapon.effect.dice;
        let damageRoll = this.rollDice(damageDice);
        let damage = damageRoll + attacker.stats.damageBonus;

        if (isCrit) damage *= 2; 

        const huntersMark = target.statusEffects.find(e => e.name === 'Hunters Mark');
        if (huntersMark) {
            damage += huntersMark.damageTakenBonus || 2;
        }

        target.currentHp = Math.max(0, target.currentHp - damage);

        room.chatLog.push({ type: 'system', text: `${attacker.name} deals ${damage} damage to ${target.name}.` });

        if (target.currentHp <= 0) {
            this._handleMonsterDefeat(room, target.id);
        } else {
            this.emitGameState(room.id);
        }

        io.to(room.id).emit('damageResult', {
            rollerId: attacker.id,
            rollerName: attacker.name,
            targetName: target.name,
            damage,
            damageRoll,
            damageDice,
            damageBonus: attacker.stats.damageBonus
        });
        
        if (attacker.currentAp <= 0) {
            const socket = io.sockets.sockets.get(attacker.id);
            if (socket) socket.emit('apZeroPrompt');
        }
    }
    
    async _resolveFullPlayerAttack(room, attacker, { weaponId, targetId }) {
        const pause = ms => new Promise(res => setTimeout(res, ms));
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!attacker || !target) return;

        const isUnarmed = weaponId === 'unarmed';
        const weapon = isUnarmed ? null : attacker.equipment.weapon;
        const apCost = isUnarmed ? 1 : (weapon.apCost || 2);
        
        // --- HIT ROLL ---
        const strBonus = this._getStatModifier(attacker, 'str');
        const toHitBonus = strBonus + (attacker.stats.hitBonus || 0);
        const d20 = this.rollDice('1d20');
        const totalRoll = d20 + toHitBonus;
        const isCrit = d20 === 20;
        const isMiss = d20 === 1;
        const hit = !isMiss && (isCrit || totalRoll >= target.requiredRollToHit);

        // SECURITY: Server-side crit tracking for NPCs
        if (isCrit) {
            attacker.isGuaranteedCrit = true;
        }

        room.chatLog.push({ type: 'system', text: `${attacker.name} attacks ${target.name}... ${hit ? 'HIT' : 'MISS'}! (Rolled ${totalRoll})` });

        io.to(room.id).emit('attackResult', {
            rollerId: attacker.id, rollerName: attacker.name, action: 'Attack', targetName: target.name,
            dice: '1d20', roll: d20, bonus: toHitBonus, total: totalRoll, targetAC: target.requiredRollToHit,
            outcome: isCrit ? 'CRIT!' : (hit ? 'HIT' : 'MISS'),
        });
        
        await pause(1500);

        // --- DAMAGE ROLL (if hit) ---
        if (hit) {
            const damageDice = isUnarmed ? '1d4' : weapon.effect.dice;
            const damageRoll = this.rollDice(damageDice);
            let damage = damageRoll + attacker.stats.damageBonus;

            // SECURITY: Check internal flag for NPC crits
            if (attacker.isGuaranteedCrit) {
                damage *= 2;
                attacker.isGuaranteedCrit = false;
            }

            const huntersMark = target.statusEffects.find(e => e.name === 'Hunters Mark');
            if (huntersMark) {
                damage += huntersMark.damageTakenBonus || 2;
            }

            target.currentHp = Math.max(0, target.currentHp - damage);

            room.chatLog.push({ type: 'system', text: `${attacker.name} deals ${damage} damage to ${target.name}.` });
            
            io.to(room.id).emit('damageResult', {
                rollerId: attacker.id, rollerName: attacker.name, targetName: target.name,
                damage, damageRoll, damageDice, damageBonus: attacker.stats.damageBonus
            });
            
            if (target.currentHp <= 0) {
                 this._handleMonsterDefeat(room, target.id);
            }

            await pause(1000);
        }

        attacker.currentAp -= apCost;
        if (target.currentHp > 0) this.emitGameState(room.id); // Emit state to update HP and AP
    }

    async _resolveFullMonsterAttack(room, monsterId, targetId) {
        const pause = ms => new Promise(res => setTimeout(res, ms));
        const monster = room.gameState.board.monsters.find(m => m.id === monsterId);
        const target = room.players[targetId];
        if (!monster || !target) return;
        
        let d20 = this.rollDice('1d20');
        const evasion = target.statusEffects.find(e => e.name === 'Evasion');
        if (evasion) {
            const d20_2 = this.rollDice('1d20');
            d20 = Math.min(d20, d20_2);
        }

        const isCrit = d20 === 20;
        const isMiss = d20 === 1;
        const targetAC = 10 + target.stats.shieldBonus;
        const totalRoll = d20 + monster.attackBonus;
        const hit = !isMiss && (isCrit || totalRoll >= targetAC);

        room.chatLog.push({ type: 'system', text: `${monster.name} attacks ${target.name}... ${hit ? 'HIT' : 'MISS'}! (Rolled ${totalRoll})` });

        io.to(room.id).emit('attackResult', {
            rollerId: monster.id, rollerName: monster.name, action: 'Attack', targetName: target.name,
            dice: '1d20', roll: d20, bonus: monster.attackBonus, total: totalRoll, targetAC,
            outcome: isCrit ? 'CRIT!' : (hit ? 'HIT' : 'MISS'),
        });
        
        await pause(1500);
        
        if (hit) {
            let damageRoll = this.rollDice(monster.effect.dice);
            let damage = damageRoll;
            if (isCrit) damage *= 2;
            
            room.chatLog.push({ type: 'system', text: `${monster.name} deals ${damage} damage to ${target.name}.` });

            io.to(room.id).emit('damageResult', {
                rollerId: monster.id, rollerName: monster.name, targetName: target.name,
                damage, damageRoll, damageDice: monster.effect.dice, damageBonus: 0
            });

            this._applyDamageToPlayer(room, target, damage);
            
            await pause(1000);
        }
        
        this.emitGameState(room.id);
    }

    _handleMonsterDefeat(room, monsterId) {
        const monsterIndex = room.gameState.board.monsters.findIndex(m => m.id === monsterId);
        if (monsterIndex === -1) return;
    
        const monsterName = room.gameState.board.monsters[monsterIndex].name;
        room.gameState.board.monsters.splice(monsterIndex, 1);
        room.chatLog.push({ type: 'system', text: `${monsterName} has been defeated!` });
    
        const lootChance = (room.settings.lootDropRate || 50) / 100;
        if (Math.random() < lootChance) {
            const loot = this.drawCardFromDeck(room.id, 'treasure');
            if (loot) {
                room.gameState.lootPool.push(loot);
                room.chatLog.push({ type: 'system', text: `The party discovered a ${loot.name}!` });
            }
        }
        
        // v6.5.0: After a monster is defeated, check if combat is over to trigger a discovery event.
        if (room.gameState.board.monsters.length === 0 && room.gameState.phase === 'started') {
            const DISCOVERY_CHANCE = 0.5; // 50% chance for an event
            if (Math.random() < DISCOVERY_CHANCE) {
                const challenge = gameData.skillChallenges[Math.floor(Math.random() * gameData.skillChallenges.length)];
                if (challenge) {
                    room.gameState.phase = 'skill_challenge';
                    room.gameState.skillChallenge = { isActive: true, details: challenge };
                    room.chatLog.push({ type: 'system', text: `With the monsters defeated, you discover something new: ${challenge.name}!` });
                }
            }
        }
    
        this.emitGameState(room.id);
    }

    _applyDamageToPlayer(room, player, damage) {
        const shieldedDamage = Math.min(player.stats.shieldHp, damage);
        player.stats.shieldHp -= shieldedDamage;
        damage -= shieldedDamage;
        player.stats.currentHp -= damage;

        if (player.stats.currentHp <= 0) {
            player.stats.currentHp = 0;
            player.isDowned = true;
            room.chatLog.push({ type: 'system', text: `${player.name} has been knocked down!` });
            if (!player.isNpc) {
                room.gameState.phase = 'game_over';
                room.gameState.winner = 'Monsters';
            }
        }
    }

    _discardCardFromHand(player, cardType) {
        const cardIndex = player.hand.findIndex(c => c.type.toLowerCase() === cardType.toLowerCase());
        if (cardIndex > -1) {
            const discardedCard = player.hand.splice(cardIndex, 1)[0];
            return discardedCard;
        }
        return null;
    }

    _resolveAbility(socket, room, player, data) {
        if (!player.class) return;
        const ability = gameData.classes[player.class].ability;
        if (!ability || ability.name !== data.abilityName) return;

        if (player.currentAp < ability.apCost) {
            return socket.emit('actionError', "Not enough AP to use this ability.");
        }

        if (ability.cost && ability.cost.type === 'discard') {
            const discardedCard = this._discardCardFromHand(player, ability.cost.cardType);
            if (!discardedCard) {
                return socket.emit('actionError', `You need to discard a ${ability.cost.cardType} card.`);
            }
            room.chatLog.push({ type: 'system', text: `${player.name} discards ${discardedCard.name} to use ${ability.name}.` });
        }

        player.currentAp -= ability.apCost;
        let successMessage = `${player.name} used ${ability.name}!`;

        switch(ability.name) {
            case 'Unchecked Assault':
                player.statusEffects.push({ name: 'Unchecked Assault', type: 'damage_buff', damageBonus: 6, duration: 2 });
                successMessage = `${player.name}'s next attack is empowered with fury!`;
                break;
            case 'Weapon Surge':
                player.statusEffects.push({ name: 'Weapon Surge', type: 'damage_buff', damageBonus: 4, duration: 2 });
                successMessage = `${player.name}'s next attack surges with power!`;
                break;
            case 'Mystic Recall':
                const drawnCard = this.drawCardFromDeck(room.id, 'spell', player.class);
                this._giveCardToPlayer(room, player, drawnCard);
                successMessage = drawnCard ? `${player.name} recalls arcane knowledge, drawing a spell.` : `${player.name} reaches for arcane knowledge, but finds none.`;
                break;
            case 'Divine Aid': {
                const wisBonus = this._getStatModifier(player, 'wis');
                const bonus = this.rollDice('1d4') + wisBonus;
                player.statusEffects.push({ name: 'Divine Aid', type: 'hit_buff', hitBonus: bonus, duration: 2, uses: 1 });
                successMessage = `${player.name} calls for divine aid, gaining a +${bonus} bonus on their next roll!`;
                break;
            }
            case 'Hunters Mark':
                const target = room.gameState.board.monsters[0];
                if (target) {
                    target.statusEffects.push({ name: 'Hunters Mark', type: 'debuff', damageTakenBonus: 2, duration: 2 });
                    successMessage = `${player.name} marks ${target.name} as their quarry!`;
                } else {
                    successMessage = `${player.name} looks for a target, but finds none.`;
                }
                break;
            case 'Evasion':
                player.statusEffects.push({ name: 'Evasion', type: 'defense_buff', evasion: true, duration: 2 });
                successMessage = `${player.name} becomes preternaturally evasive!`;
                break;
        }

        socket.emit('showToast', { message: successMessage });
        player.stats = this.calculatePlayerStats(player);
        this.emitGameState(room.id);
    }
    
    _resolveUseConsumable(socket, room, player, { cardId, targetId }) {
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return socket.emit('actionError', "Card not found in hand.");
        
        const card = player.hand[cardIndex];
        if (card.type !== 'Consumable' || player.currentAp < (card.apCost || 1)) {
            return socket.emit('actionError', "Cannot use this item.");
        }

        player.currentAp -= (card.apCost || 1);
        const [usedCard] = player.hand.splice(cardIndex, 1);
        room.gameState.discardPile.push(usedCard);

        let logMessage = `${player.name} uses ${card.name}.`;
        const effect = card.effect;

        if (effect.type === 'damage' && effect.target === 'any-monster') {
            const target = room.gameState.board.monsters.find(m => m.id === targetId);
            if (target) {
                const damage = this.rollDice(effect.dice);
                target.currentHp = Math.max(0, target.currentHp - damage);
                logMessage = `${card.name} deals ${damage} damage to ${target.name}!`;
                if (target.currentHp <= 0) {
                    this._handleMonsterDefeat(room, target.id);
                }
            }
        } else if (effect.type === 'heal' && effect.target === 'any-player') {
            const target = room.players[targetId];
            if (target) {
                const healing = this.rollDice(effect.dice);
                target.stats.currentHp = Math.min(target.stats.maxHp, target.stats.currentHp + healing);
                logMessage = `${target.name} is healed for ${healing} HP!`;
            }
        } else if (effect.type === 'utility' && effect.status === 'Cure Poison' && effect.target === 'any-player') {
            const target = room.players[targetId];
            if (target) {
                target.statusEffects = target.statusEffects.filter(se => se.name !== 'Poisoned');
                logMessage = `${target.name} is cured of poison!`;
            }
        }

        room.chatLog.push({ type: 'system', text: logMessage });
        socket.emit('showToast', { message: logMessage });
        this.emitGameState(room.id);
    }

    // --- 3.9. Chat & Disconnect Logic (REBUILT) ---
    handleChatMessage(socket, { channel, message }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        
        if (!room || !player) {
            socket.emit('actionError', 'Cannot send message: Not in a valid game session.');
            return;
        }

        if (!message || message.trim().length === 0) {
            return;
        }

        room.chatLog.push({
            type: 'chat',
            channel: channel,
            playerName: player.name,
            playerId: player.id,
            text: message.trim()
        });

        this.emitGameState(room.id);
    }
    
    rejoinRoom(socket, { roomId, playerId }) {
        const room = this.rooms[roomId];
        if (!room) {
            socket.emit('actionError', 'Room to rejoin not found.');
            return;
        }

        const playerToReconnect = Object.values(room.players).find(p => p.playerId === playerId && p.disconnected);

        if (playerToReconnect) {
            const oldId = playerToReconnect.id;
            
            if (playerToReconnect.cleanupTimer) {
                clearTimeout(playerToReconnect.cleanupTimer);
                playerToReconnect.cleanupTimer = null;
            }

            playerToReconnect.id = socket.id;
            playerToReconnect.disconnected = false;

            room.players[socket.id] = playerToReconnect;
            delete room.players[oldId];

            if (room.hostId === oldId) {
                room.hostId = socket.id;
            }

            const turnOrderIndex = room.gameState.turnOrder.indexOf(oldId);
            if (turnOrderIndex > -1) {
                room.gameState.turnOrder[turnOrderIndex] = socket.id;
            }

            this.socketToRoom[socket.id] = roomId;
            socket.join(roomId);

            console.log(`Player ${playerToReconnect.name} reconnected to room ${roomId}`);
            this.emitGameState(roomId);
        } else {
            socket.emit('actionError', 'Could not find a disconnected character to rejoin.');
        }
    }
    
    handleDisconnect(socket) {
        const roomId = this.socketToRoom[socket.id];
        const room = this.rooms[roomId];
        if (!room) return;

        const player = room.players[socket.id];
        if (player && !player.isNpc) {
            console.log(`Player ${player.name} in room ${roomId} has disconnected.`);
            player.disconnected = true;
            
            const persistentPlayerId = player.playerId;
            player.cleanupTimer = setTimeout(() => {
                const roomForCleanup = this.rooms[roomId];
                if (roomForCleanup) {
                    const playerKeyToDelete = Object.keys(roomForCleanup.players).find(key => roomForCleanup.players[key].playerId === persistentPlayerId);
                    if (playerKeyToDelete && roomForCleanup.players[playerKeyToDelete].disconnected) {
                        console.log(`Cleaning up disconnected player ${roomForCleanup.players[playerKeyToDelete].name} from room ${roomId}`);
                        delete roomForCleanup.players[playerKeyToDelete];
                        this.emitGameState(roomId);
                    }
                }
            }, 300000); // 5 minutes

            this.emitGameState(roomId);
        }
        
        delete this.socketToRoom[socket.id];
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
    socket.on('playerAction', (data) => gameManager.handlePlayerAction(socket, data));
    socket.on('endTurn', () => gameManager.endTurn(socket));
    socket.on('chatMessage', (data) => gameManager.handleChatMessage(socket, data));
    
    socket.on('disconnect', () => gameManager.handleDisconnect(socket));
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});