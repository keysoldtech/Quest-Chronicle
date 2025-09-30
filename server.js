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
//    - 3.6. AI Logic (NPC Turns)
//    - 3.7. Action Resolution (Attacks, Abilities, etc.)
//    - 3.8. Event & Challenge Handling
//    - 3.9. Chat & Voice Chat Relaying
//    - 3.10. Disconnect Logic
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

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
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
    
    emitGameState(roomId, includeStaticData = false) {
        const room = this.rooms[roomId];
        if (room) {
            // To save bandwidth, we only send the full static data on the first load.
            // All subsequent updates omit it.
            const payload = deepClone(room);
            if (!includeStaticData && payload.staticDataForClient) {
                delete payload.staticDataForClient;
            }
            io.to(roomId).emit('gameStateUpdate', payload);
        }
    }

    emitToRoom(roomId, event, payload) {
        io.to(roomId).emit(event, payload);
    }

    logEvent(roomId, message, type = 'system') {
        const room = this.rooms[roomId];
        if (room) {
            room.gameLog.unshift({ turn: room.gameState.turnCount, message, type });
            if (room.gameLog.length > 100) room.gameLog.pop();
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
        return {
            id,
            name,
            isNpc: false,
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
        const newPlayer = this.createPlayerObject(socket.id, playerName);
        const newRoomId = this.generateRoomId();
    
        const defaultSettings = {
            startWithWeapon: true, startWithArmor: true, startingItems: 2, 
            startingSpells: 2, maxHandSize: 10, lootDropRate: 50
        };
    
        const newRoom = {
            id: newRoomId,
            hostId: socket.id,
            players: { [socket.id]: newPlayer },
            chatLog: [],
            // BUG FIX: Add static data here so the first emit sends it to the client.
            staticDataForClient: { classes: gameData.classes },
            gameState: {
                phase: 'class_selection',
                gameMode: gameMode || 'Beginner',
                customSettings: customSettings || defaultSettings,
                decks: { /* Initialized during game start */ },
                turnOrder: [],
                currentPlayerIndex: -1,
                board: { monsters: [] },
                lootPool: [],
                turnCount: 0,
                worldEvents: { currentEvent: null, duration: 0 },
                currentPartyEvent: null,
                skillChallenge: null,
            },
            gameLog: []
        };
    
        newPlayer.role = 'Explorer';
        this.rooms[newRoomId] = newRoom;
        socket.join(newRoomId);
        this.socketToRoom[socket.id] = newRoomId;
    
        // BUG FIX: The `true` flag sends the static data.
        this.emitGameState(newRoomId, true);
    }
    
    joinRoom(socket, { roomId, playerName }) {
        const room = this.rooms[roomId];
        if (!room) return socket.emit('actionError', 'Room not found.');
        if (Object.keys(room.players).length >= 4) return socket.emit('actionError', 'Room is full.');
        if (room.gameState.phase !== 'class_selection') return socket.emit('actionError', 'Game has already started.');

        const newPlayer = this.createPlayerObject(socket.id, playerName);
        newPlayer.role = 'Explorer';
        room.players[socket.id] = newPlayer;
        socket.join(roomId);
        this.socketToRoom[socket.id] = roomId;
        
        this.emitGameState(roomId, true); // Send full state with static data to joining player
    }

    // --- 3.3. Game Lifecycle (The New Core Orchestrator) ---
    chooseClass(socket, { classId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player || player.class) return;

        // 1. Assign class to the human player
        this.assignClassToPlayer(player, classId);

        // Check if all human players have chosen a class
        const humanPlayers = Object.values(room.players).filter(p => !p.isNpc);
        if (humanPlayers.every(p => p.class)) {
            this.startGame(room.id);
        } else {
            this.emitGameState(room.id);
        }
    }

    startGame(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.phase !== 'class_selection') return;
        
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
        room.gameState.currentPlayerIndex = 0;
        room.gameState.phase = 'started';
        room.gameState.turnCount = 1;

        // 7. Start the first turn (DM's turn)
        this.startTurn(room.id);
    }
    
    createNpcs(room) {
        const dmNpc = this.createPlayerObject('npc-dm', 'Dungeon Master');
        dmNpc.role = 'DM';
        dmNpc.isNpc = true;
        room.players[dmNpc.id] = dmNpc;

        const numHumanPlayers = Object.values(room.players).filter(p => !p.isNpc).length;
        const numNpcsToCreate = Math.max(0, 4 - numHumanPlayers); // Always create a party of 4 explorers
        
        const npcNames = ["Grok", "Lyra", "Finn", "Elara"]; // Added a 4th name
        const availableClasses = Object.keys(gameData.classes);
        for (let i = 0; i < numNpcsToCreate; i++) {
            const name = npcNames[i];
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
        const createDeck = (cardArray) => cardArray.map(c => ({ ...deepClone(c), id: this.generateUniqueCardId() }));
        
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

    dealStartingLoadout(room, player) {
        const { gameMode, customSettings } = room.gameState;
        
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

        for (let i = 0; i < itemsToDraw; i++) player.hand.push(this.drawCardFromDeck(room.id, 'item'));
        for (let i = 0; i < spellsToDraw; i++) player.hand.push(this.drawCardFromDeck(room.id, 'spell', player.class));
        
        player.hand = player.hand.filter(Boolean); // Clean out any nulls if decks were empty
    }

    drawCardFromDeck(roomId, deckName, playerClass = null) {
        const room = this.rooms[roomId];
        if (!room) return null;

        let deck;
        if (deckName.startsWith('monster.')) {
            const tier = deckName.split('.')[1];
            deck = room.gameState.decks.monster[tier];
        } else {
            deck = room.gameState.decks[deckName];
        }
    
        if (!deck || !Array.isArray(deck) || deck.length === 0) return null;

        if (playerClass && (deckName === 'spell' || deckName === 'weapon' || deckName === 'armor')) {
            const suitableCardIndex = deck.findIndex(card => 
                !card.class || card.class.includes("Any") || card.class.includes(playerClass)
            );
            if (suitableCardIndex !== -1) {
                return deck.splice(suitableCardIndex, 1)[0];
            }
        }
        return deck.pop();
    }

    // --- 3.4. Player Setup ---
    assignClassToPlayer(player, classId) {
        const classData = gameData.classes[classId];
        if (!classData || !player) return;
        player.class = classId;
        player.stats = this.calculatePlayerStats(player);
    }

    calculatePlayerStats(player) {
        const baseStats = { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, shieldHp: player.stats.shieldHp || 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
        if (!player.class) return baseStats;
    
        const classData = gameData.classes[player.class];
        const newStats = {
            ...baseStats,
            currentHp: player.stats.currentHp,
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
        
        for (const effect of player.statusEffects) {
             if (effect.type === 'stat_modifier' && effect.bonuses) {
                Object.keys(effect.bonuses).forEach(key => {
                    newStats[key] = (newStats[key] || 0) + effect.bonuses[key];
                });
            }
        }
    
        newStats.currentHp = newStats.currentHp || newStats.maxHp;
        newStats.currentHp = Math.min(newStats.currentHp, newStats.maxHp);
        
        return newStats;
    }

    equipItem(socket, { cardId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player) return;

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;
        
        const cardToEquip = player.hand.splice(cardIndex, 1)[0];
        const itemType = cardToEquip.type.toLowerCase();

        if (player.equipment[itemType]) {
            player.hand.push(player.equipment[itemType]);
        }
        
        player.equipment[itemType] = cardToEquip;
        player.stats = this.calculatePlayerStats(player);
        this.emitGameState(room.id);
    }
    
    // --- 3.5. Turn Management ---
    async startTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room || !room.gameState.turnOrder.length) return;

        const player = room.players[room.gameState.turnOrder[room.gameState.currentPlayerIndex]];
        if (!player) return;

        player.stats = this.calculatePlayerStats(player);
        player.currentAp = player.stats.ap;
        
        this.logEvent(roomId, `<strong>Turn ${room.gameState.turnCount}:</strong> ${player.name}'s turn begins.`, 'turn');
        
        // Handle start-of-turn events
        if (player.role === 'Explorer') {
            this.handlePlayerEventTrigger(room, player);
        }

        this.emitGameState(roomId);
        await new Promise(res => setTimeout(res, 100)); // Brief delay to let client render turn change

        if (player.isNpc) {
            if (player.role === 'DM') {
                await this.handleDmTurn(room);
            } else {
                await this.handleNpcExplorerTurn(room, player);
            }
        }
    }

    async endTurn(socket) {
        const room = this.findRoomBySocket(socket);
        if (!room) return;
        const player = room.players[socket.id];
        if (!player || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== player.id) return;
        
        await this.advanceToNextTurn(room.id);
    }
    
    async advanceToNextTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room) return;
    
        // Reset shield of player whose turn just ended
        const previousPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        const previousPlayer = room.players[previousPlayerId];
        if (previousPlayer) {
            previousPlayer.stats.shieldHp = 0;
        }
    
        // Advance to the next player in the turn order
        room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
        
        // Check if it's the start of a new round (DM's turn)
        if (room.gameState.currentPlayerIndex === 0) { 
            room.gameState.turnCount++;
            // On subsequent rounds, the DM might play a party event
            if (room.gameState.turnCount > 1 && Math.random() < 0.3) {
                this.dmPlayPartyEvent(room);
            }
        }
        
        await this.startTurn(room.id);
    }
    
    // --- 3.6. AI Logic (NPC Turns) ---
    async handleDmTurn(room) {
        await new Promise(res => setTimeout(res, 1000));
        
        // Special logic for the very first turn of the game
        if (room.gameState.turnCount === 1) {
            const actionRoll = Math.random();
            if (actionRoll < 0.33) {
                this.logEvent(room.id, "The DM prepares to unleash a monster...", 'event');
                this.dmPlayMonster(room);
            } else if (actionRoll < 0.66) {
                this.logEvent(room.id, "The DM consults the winds of fate...", 'event');
                this.dmPlayWorldEvent(room);
            } else {
                this.logEvent(room.id, "A dark omen! The DM unleashes a monster and a world event!", 'event');
                this.dmPlayMonster(room);
                await new Promise(res => setTimeout(res, 1000)); // Pause between actions
                this.dmPlayWorldEvent(room);
            }
        } else {
            // Standard DM turn logic for subsequent turns
            if (room.gameState.board.monsters.length > 0) {
                for (const monster of [...room.gameState.board.monsters]) {
                   if (monster.currentHp <= 0) continue;
                   await new Promise(res => setTimeout(res, 1500));
                   const targetId = this._chooseMonsterTarget(room);
                   if (targetId) {
                       await this.initiateAttack(room, { attackerId: monster.id, targetId: targetId, isMonster: true });
                   }
               }
            } else {
                 if (Math.random() < 0.75) {
                    this.dmPlayMonster(room);
                } else {
                    this.dmPlayWorldEvent(room);
                }
            }
        }
        
        await new Promise(res => setTimeout(res, 1500));
        await this.advanceToNextTurn(room.id);
    }
    
     async handleNpcExplorerTurn(room, player) {
        await new Promise(res => setTimeout(res, 1000));
        const monsters = room.gameState.board.monsters.filter(m => m.currentHp > 0);
        let actionTaken = false;

        // Use class ability
        const classAbility = gameData.classes[player.class]?.ability;
        if (classAbility && player.currentAp >= classAbility.apCost) {
            if (Math.random() < 0.3) { // 30% chance to use ability
                this.logEvent(room.id, `${player.name} uses their ability: ${classAbility.name}!`, 'action');
                this.applyEffect(room, {type: 'ability', abilityName: classAbility.name}, player, null);
                player.currentAp -= classAbility.apCost;
                actionTaken = true;
            }
        }
        
        if (!actionTaken && player.stats.currentHp < player.stats.maxHp / 2) {
            const healingSpell = player.hand.find(c => c.effect.type === 'heal');
            if (healingSpell && player.currentAp >= (healingSpell.apCost || 1)) {
                 this.logEvent(room.id, `${player.name} uses ${healingSpell.name} to heal themselves.`, 'action');
                 this.applyEffect(room, healingSpell.effect, player, player);
                 player.currentAp -= (healingSpell.apCost || 1);
                 player.hand.splice(player.hand.findIndex(c => c.id === healingSpell.id), 1);
                 actionTaken = true;
            }
        }

        if (!actionTaken && monsters.length > 0) {
            const weakestMonster = monsters.sort((a, b) => a.currentHp - b.currentHp)[0];
            const weapon = player.equipment.weapon;

            if (weapon && player.currentAp >= (weapon.apCost || 2)) {
                 await this.initiateAttack(room, { attackerId: player.id, targetId: weakestMonster.id, weaponId: weapon.id });
                 actionTaken = true;
            } else if (player.currentAp >= 1) { 
                 await this.initiateAttack(room, { attackerId: player.id, targetId: weakestMonster.id, weaponId: 'unarmed' });
                 actionTaken = true;
            }
        } 
        
        if (!actionTaken && player.currentAp >= 1) {
             player.currentAp -= 1;
             player.stats.shieldHp += (player.equipment.armor?.guardBonus || 2) + player.stats.shieldBonus;
             this.logEvent(room.id, `${player.name} takes a defensive stance.`, 'info');
        }
        
        this.emitGameState(room.id);
        await new Promise(res => setTimeout(res, 1000));
        await this.advanceToNextTurn(room.id);
    }

    _chooseMonsterTarget(room) {
        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer' && p.stats.currentHp > 0);
        return explorers.length > 0 ? explorers[Math.floor(Math.random() * explorers.length)].id : null;
    }
    
    // --- 3.7. Action Resolution ---
    handlePlayerAction(socket, data) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== player.id) return;

        const { action, cardId, targetId, description, challengeId } = data;

        const actionHandlers = {
            'attack': () => this.initiateAttack(room, { attackerId: player.id, targetId, weaponId: cardId, description }),
            'guard': () => {
                if (player.currentAp >= gameData.actionCosts.guard) {
                    player.currentAp -= gameData.actionCosts.guard;
                    player.stats.shieldHp += (player.equipment.armor?.guardBonus || 2) + player.stats.shieldBonus;
                    this.logEvent(room.id, `${player.name} takes a defensive stance.`, 'info');
                }
            },
            'briefRespite': () => {
                if (player.currentAp >= gameData.actionCosts.briefRespite) {
                    player.currentAp -= gameData.actionCosts.briefRespite;
                    this.applyEffect(room, { type: 'heal', dice: `${gameData.classes[player.class].healthDice}d4` }, player, player);
                    this.logEvent(room.id, `${player.name} takes a brief respite.`, 'info');
                }
            },
            'fullRest': () => {
                 if (player.currentAp >= gameData.actionCosts.fullRest) {
                     player.currentAp -= gameData.actionCosts.fullRest;
                     this.applyEffect(room, { type: 'heal', dice: `${gameData.classes[player.class].healthDice}d8` }, player, player);
                     this.logEvent(room.id, `${player.name} takes a full rest.`, 'info');
                 }
            },
            'useCard': () => {
                const cardIndex = player.hand.findIndex(c => c.id === cardId);
                if (cardIndex === -1) return;
                const card = player.hand[cardIndex];
                if (player.currentAp >= (card.apCost || 1)) {
                    player.currentAp -= (card.apCost || 1);
                    player.hand.splice(cardIndex, 1);
                    const target = room.players[targetId] || room.gameState.board.monsters.find(m => m.id === targetId);
                    this.applyEffect(room, card.effect, player, target);
                    this.logEvent(room.id, `${player.name} uses ${card.name}.`, 'action');
                }
            },
            'useAbility': () => {
                const ability = gameData.classes[player.class]?.ability;
                if (ability && player.currentAp >= ability.apCost) {
                    player.currentAp -= ability.apCost;
                    const target = room.players[targetId] || room.gameState.board.monsters.find(m => m.id === targetId);
                    this.applyEffect(room, {type: 'ability', abilityName: ability.name, ...ability}, player, target);
                    this.logEvent(room.id, `${player.name} uses ${ability.name}!`, 'action');
                }
            },
            'skillChallenge': () => this.resolveSkillChallenge(room, player, challengeId),
        };

        if (actionHandlers[action]) {
            actionHandlers[action]();
            this.emitGameState(room.id);
        }
    }
    
    async initiateAttack(room, { attackerId, targetId, weaponId, description, isMonster = false }) {
        const attacker = isMonster ? room.gameState.board.monsters.find(m => m.id === attackerId) : room.players[attackerId];
        const target = isMonster ? room.players[targetId] : room.gameState.board.monsters.find(m => m.id === targetId);
    
        if (!attacker || !target) return;
    
        const isUnarmed = weaponId === 'unarmed';
        const weapon = isUnarmed ? null : (isMonster ? null : attacker.equipment?.weapon);
        if (!isMonster && !isUnarmed && (!weapon || weapon.id !== weaponId)) return;
    
        const apCost = isUnarmed ? 1 : (weapon?.apCost || 2);
        if (!isMonster) {
            if (attacker.currentAp < apCost) return;
            attacker.currentAp -= apCost;
        }
    
        const weaponName = isMonster ? 'claws' : (isUnarmed ? 'Fists' : weapon.name);
        const narrative = description ? `<i>"${description}"</i>` : `attacks ${target.name} with ${weaponName}.`;
        this.logEvent(room.id, `${attacker.name} ${narrative}`, 'action');
        this.emitGameState(room.id);
        await new Promise(res => setTimeout(res, 500));
    
        const d20 = this.rollDice('1d20');
        const toHitBonus = isMonster ? attacker.attackBonus : (isUnarmed ? attacker.stats.str : (attacker.stats.damageBonus + (weapon.range === 'ranged' ? attacker.stats.dex : attacker.stats.str)));
        const targetAC = isMonster ? (target.stats.shieldBonus + 10) : target.requiredRollToHit;
        const isCrit = d20 === 20;
        const isMiss = d20 === 1;
        const hit = isCrit || (!isMiss && (d20 + toHitBonus) >= targetAC);
    
        this.emitToRoom(room.id, 'attackRollResult', {
            attacker: { id: attacker.id, name: attacker.name },
            target: { id: target.id, name: target.name },
            roll: d20,
            bonus: toHitBonus,
            total: d20 + toHitBonus,
            required: targetAC,
            result: isCrit ? 'CRITICAL HIT' : (hit ? 'HIT' : 'MISS')
        });
        await new Promise(res => setTimeout(res, 2500));
    
        if (hit) {
            const damageDice = isMonster ? attacker.effect.dice : (isUnarmed ? '1d4' : weapon.effect.dice);
            let damageRoll = this.rollDice(damageDice);
            const damageBonus = isMonster ? 0 : (isUnarmed ? attacker.stats.str : (attacker.stats.damageBonus + (weapon.range === 'ranged' ? 0 : attacker.stats.str)));
            let totalDamage = damageRoll + damageBonus;
            
            if (isCrit) {
                totalDamage *= 2;
                if (!isMonster && weapon?.effect?.critBonusDice) {
                    totalDamage += this.rollDice(weapon.effect.critBonusDice);
                }
            }
    
            this.emitToRoom(room.id, 'damageRollResult', {
                attacker: { id: attacker.id, name: attacker.name },
                target: { id: target.id, name: target.name },
                dice: damageDice,
                roll: damageRoll,
                bonus: damageBonus,
                total: totalDamage
            });
            await new Promise(res => setTimeout(res, 2500));
            
            this.applyEffect(room, { type: 'damage', value: totalDamage }, attacker, target, isCrit);
        } else {
            this.logEvent(room.id, `<span class="log-miss">MISS!</span>`, 'info');
        }
        this.emitGameState(room.id);
    }

    applyEffect(room, effect, source, target, isCrit = false) {
        if (!effect || !source) return;

        const logHitOrHeal = (value, type, targetName) => {
            const message = type === 'damage' 
                ? `<span class="log-hit">${isCrit ? 'CRITICAL HIT!' : 'HIT!'}</span> Deals <strong>${value}</strong> damage to ${targetName}.`
                : `Heals <strong>${value}</strong> HP for ${targetName}.`;
            this.logEvent(room.id, message, 'damage');
        };

        switch (effect.type) {
            case 'damage': {
                const damageValue = effect.value !== undefined ? effect.value : this.rollDice(effect.dice);
                logHitOrHeal(damageValue, 'damage', target.name);
                if (target.isNpc) { // Monster
                    target.currentHp -= damageValue;
                    if (target.currentHp <= 0) this._handleMonsterDefeat(room, target.id, target.name);
                } else { // Player
                    this._applyDamageToPlayer(target, damageValue);
                }
                break;
            }
            case 'heal': {
                const healValue = this.rollDice(effect.dice);
                target.stats.currentHp = Math.min(target.stats.maxHp, target.stats.currentHp + healValue);
                logHitOrHeal(healValue, 'heal', target.name);
                break;
            }
            case 'buff':
            case 'debuff':
            case 'stat_modifier': {
                target.statusEffects.push({
                    id: `eff-${Date.now()}`,
                    name: effect.name || 'Stat Change',
                    ...effect
                });
                target.stats = this.calculatePlayerStats(target);
                break;
            }
            case 'ability': {
                // Handle specific class abilities
                if (effect.abilityName === 'Mystic Recall') {
                    const card = this.drawCardFromDeck(room.id, 'spell');
                    if (card) source.hand.push(card);
                }
                // Other abilities can be added here
                break;
            }
        }
    }
    
    _handleMonsterDefeat(room, monsterId, monsterName) {
        this.logEvent(room.id, `${monsterName} has been defeated!`, 'info');
        room.gameState.board.monsters = room.gameState.board.monsters.filter(m => m.id !== monsterId);
        const lootChance = (room.gameState.customSettings.lootDropRate || 50) / 100;
        if (Math.random() < lootChance) {
            const loot = this.generateRandomLoot(room);
            if (loot) {
                room.gameState.lootPool.push(loot);
                this.logEvent(room.id, `The party discovered some loot: ${loot.name}!`, 'loot');
            }
        }
        
        if (room.gameState.board.monsters.length === 0) {
            if (Math.random() < 0.4) {
                this.dmTriggerSkillChallenge(room);
            }
        }
    }
    
    generateRandomLoot(room) {
        const { magicalAffixes, weaponCards, armorCards } = gameData;
        const baseCard = Math.random() < 0.5 ? deepClone(weaponCards[Math.floor(Math.random() * weaponCards.length)]) : deepClone(armorCards[Math.floor(Math.random() * armorCards.length)]);
    
        baseCard.id = this.generateUniqueCardId();
        baseCard.effect.bonuses = baseCard.effect.bonuses || {};
        let nameParts = [baseCard.name];
        
        const addAffix = (type) => {
            const affixes = magicalAffixes[type];
            if (affixes.length > 0) {
                const affix = affixes[Math.floor(Math.random() * affixes.length)];
                if(type === 'prefixes') nameParts.unshift(affix.name);
                else nameParts.push(affix.name);

                Object.keys(affix.bonuses).forEach(key => {
                    baseCard.effect.bonuses[key] = (baseCard.effect.bonuses[key] || 0) + affix.bonuses[key];
                });
            }
        };

        if (Math.random() < 0.6) addAffix('prefixes');
        if (Math.random() < 0.4) addAffix('suffixes');

        if(nameParts.length > 1) {
            baseCard.name = nameParts.join(' ');
            baseCard.effect.description += " Imbued with magical properties.";
        }
        
        return baseCard;
    }

    _applyDamageToPlayer(player, damage) {
        const shieldedDamage = Math.min(player.stats.shieldHp, damage);
        player.stats.shieldHp -= shieldedDamage;
        damage -= shieldedDamage;
        player.stats.currentHp -= damage;

        if (player.stats.currentHp <= 0) {
            player.stats.currentHp = 0;
            this.logEvent(this.findRoomBySocket({ id: player.id })?.id, `${player.name} has been defeated!`, 'death');
        }
    }

    // --- 3.8. Event & Challenge Handling ---
    dmPlayMonster(room) {
        const { turnCount } = room.gameState;
        const tierKey = turnCount <= 3 ? 'tier1' : (turnCount <= 6 ? 'tier2' : 'tier3');
        const monsterCard = this.drawCardFromDeck(room.id, `monster.${tierKey}`);
        if (monsterCard) {
            monsterCard.currentHp = monsterCard.maxHp;
            monsterCard.statusEffects = [];
            room.gameState.board.monsters.push(monsterCard);
            this.logEvent(room.id, `The Dungeon Master summons a ${monsterCard.name}!`, 'monster');
            this.emitGameState(room.id);
        } else {
            this.logEvent(room.id, `The DM tried to summon a monster, but the deck was empty.`, 'error');
        }
    }
    
    dmPlayWorldEvent(room) {
        const eventCard = this.drawCardFromDeck(room.id, 'worldEvent');
        if (eventCard) {
            room.gameState.worldEvents.currentEvent = eventCard;
            room.gameState.worldEvents.duration = 2; // Example duration
            this.logEvent(room.id, `A world event occurs: <strong>${eventCard.name}</strong>. ${eventCard.description}`, 'event');
            // Apply mechanical effects
            Object.values(room.players).forEach(p => this.applyEffect(room, eventCard.effect, null, p));
            this.emitGameState(room.id);
        }
    }

    handlePlayerEventTrigger(room, player) {
        if (Math.random() < 0.15) { // 15% chance for a player event
            const eventCard = this.drawCardFromDeck(room.id, 'playerEvent');
            if (eventCard) {
                this.logEvent(room.id, `An event befalls ${player.name}: <strong>${eventCard.name}</strong>. ${eventCard.outcome}`, 'event');
                this.applyEffect(room, eventCard.effect, null, player);
            }
        }
    }

    dmPlayPartyEvent(room) {
        const eventCard = this.drawCardFromDeck(room.id, 'partyEvent');
        if (eventCard) {
            room.gameState.currentPartyEvent = eventCard;
            this.logEvent(room.id, `A party event occurs: <strong>${eventCard.name}</strong>. ${eventCard.outcome}`, 'event');
            Object.values(room.players).filter(p => p.role === 'Explorer').forEach(p => {
                this.applyEffect(room, eventCard.effect, null, p);
            });
            this.emitGameState(room.id);
        }
    }

    dmTriggerSkillChallenge(room) {
        const challenge = gameData.skillChallenges[Math.floor(Math.random() * gameData.skillChallenges.length)];
        room.gameState.skillChallenge = { ...challenge, isActive: true };
        this.logEvent(room.id, `A challenge presents itself! <strong>${challenge.name}</strong>: ${challenge.description}`, 'event');
        this.emitGameState(room.id);
    }

    resolveSkillChallenge(room, player, challengeId) {
        const challenge = room.gameState.skillChallenge;
        if (!challenge || !challenge.isActive || challenge.id !== challengeId || player.currentAp < 1) return;
        player.currentAp -= 1;
        
        const d20 = this.rollDice('1d20');
        const statBonus = player.stats[challenge.skill] || 0;
        const total = d20 + statBonus;
        const success = total >= challenge.dc;

        this.logEvent(room.id, `${player.name} attempts to ${challenge.name}...`, 'action');
        this.emitToRoom(room.id, 'attackRollResult', {
            attacker: {id: player.id, name: player.name},
            target: {name: "Skill Challenge"},
            roll: d20,
            bonus: statBonus,
            total: total,
            required: challenge.dc,
            result: success ? 'SUCCESS' : 'FAILURE'
        });

        setTimeout(() => {
            room.gameState.skillChallenge = null;
            if(success) {
                this.logEvent(room.id, challenge.success.message, 'loot');
                 if(challenge.success.reward.type === 'loot') {
                    for(let i = 0; i < challenge.success.reward.count; i++) {
                        room.gameState.lootPool.push(this.drawCardFromDeck(room.id, 'treasure'));
                    }
                }
            } else {
                 this.logEvent(room.id, challenge.failure.message, 'damage');
                 if(challenge.failure.consequence.type === 'damage') {
                     const damage = this.rollDice(challenge.failure.consequence.dice);
                     this._applyDamageToPlayer(player, damage);
                 }
            }
            this.emitGameState(room.id);
        }, 2500);
    }
    
    // --- 3.9. Chat & Voice Chat Relaying ---
    handleChatMessage(socket, { channel, message }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player) return;
        
        const chatMessage = {
            senderId: player.id,
            senderName: player.name,
            channel,
            message,
            timestamp: new Date().toISOString()
        };
        
        room.chatLog.push(chatMessage);
        
        if (channel === 'party') {
            Object.values(room.players).forEach(p => {
                if (p.role === 'Explorer') {
                    io.to(p.id).emit('chatMessage', chatMessage);
                }
            });
        } else {
            this.emitToRoom(room.id, 'chatMessage', chatMessage);
        }
    }


    // --- 3.10. Disconnect Logic ---
    handleDisconnect(socket) {
        const roomId = this.socketToRoom[socket.id];
        const room = this.rooms[roomId];
        if (!room) return;
        
        this.logEvent(roomId, `${room.players[socket.id]?.name || 'A player'} has left the game.`);
        delete room.players[socket.id];
        delete this.socketToRoom[socket.id];

        if (Object.keys(room.players).length === 0 || room.hostId === socket.id) {
            delete this.rooms[roomId];
        } else {
            this.emitGameState(roomId);
        }
    }
}

// --- 4. SOCKET.IO CONNECTION HANDLING ---
const gameManager = new GameManager();

io.on('connection', (socket) => {
    socket.on('createRoom', (data) => gameManager.createRoom(socket, data));
    socket.on('joinRoom', (data) => gameManager.joinRoom(socket, data));
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