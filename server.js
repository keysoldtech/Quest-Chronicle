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
//    - 3.9. Voice Chat Relaying
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
    
    emitGameState(roomId) {
        if (this.rooms[roomId]) {
            io.to(roomId).emit('gameStateUpdate', this.rooms[roomId]);
        }
    }

    emitPlayerListUpdate(roomId) {
        if (this.rooms[roomId]) {
            io.to(roomId).emit('playerListUpdate', this.rooms[roomId]);
        }
    }

    sendMessageToRoom(roomId, messageData) {
        if (this.rooms[roomId]) {
            this.rooms[roomId].chatLog.push(messageData);
            io.to(roomId).emit('chatMessage', messageData);
        }
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

    generateRoomId() {
        let roomId;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012456789';
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

    // --- 3.2. Room & Player Management ---
    createRoom(socket, { playerName, gameMode, customSettings }) {
        const newPlayer = this.createPlayerObject(socket.id, playerName);
        const newRoomId = this.generateRoomId();
        
        const newRoom = {
            id: newRoomId,
            hostId: socket.id,
            players: { [socket.id]: newPlayer },
            voiceChatPeers: [],
            gameState: {
                phase: 'class_selection', // MODIFIED: Go directly to class selection
                gameMode: gameMode,
                customSettings: customSettings,
                decks: { 
                    item: [], spell: [], monster: { tier1: [], tier2: [], tier3: [] }, weapon: [], armor: [], worldEvent: [],
                    playerEvent: [],
                    partyEvent: [],
                    treasure: [],
                },
                turnOrder: [],
                currentPlayerIndex: -1,
                board: { monsters: [] },
                lootPool: [],
                turnCount: 0,
                worldEvents: {
                    currentEvent: null,
                    duration: 0,
                    sourcePlayerId: null,
                },
                currentPartyEvent: null,
                skillChallenge: { isActive: false },
                classData: gameData.classes, 
            },
            chatLog: []
        };

        // MODIFIED: Immediately set up for single player
        const player = newRoom.players[socket.id];
        player.role = 'Explorer';
        const dmNpc = this.createPlayerObject('npc-dm', 'Dungeon Master');
        dmNpc.role = 'DM'; dmNpc.isNpc = true; newRoom.players[dmNpc.id] = dmNpc;
        const npcNames = ["Grok", "Lyra", "Finn"];
        for (const name of npcNames) {
            const npcId = `npc-${name.toLowerCase()}`;
            const npc = this.createPlayerObject(npcId, name);
            npc.isNpc = true; npc.role = 'Explorer'; newRoom.players[npc.id] = npc;
        }
        
        this.rooms[newRoomId] = newRoom;
        socket.join(newRoomId);
        this.socketToRoom[socket.id] = newRoomId;
        socket.emit('roomCreated', newRoom);
    }
    
    joinRoom(socket, { roomId, playerName }) {
        const room = this.rooms[roomId];
        if (!room) {
            socket.emit('actionError', 'Room not found.');
            return;
        }

        // --- LATE JOIN LOGIC ---
        if (room.gameState.phase !== 'lobby' && room.gameState.phase !== 'class_selection') {
            const humanPlayers = Object.values(room.players).filter(p => !p.isNpc);
            if (humanPlayers.length >= 5) {
                socket.emit('actionError', 'This room is full of human players.');
                return;
            }

            const npcToReplace = 
                Object.values(room.players).find(p => p.isNpc && p.role === 'Explorer') || 
                Object.values(room.players).find(p => p.isNpc && p.role === 'DM');

            if (!npcToReplace) {
                socket.emit('actionError', 'This room is full and cannot be joined.');
                return;
            }

            const newPlayer = this.createPlayerObject(socket.id, playerName);
            newPlayer.role = npcToReplace.role;
            
            this.sendMessageToRoom(roomId, {
                channel: 'game',
                type: 'system',
                message: `<b>${playerName}</b> has joined the game, taking over for the NPC <b>${npcToReplace.name}</b>!`
            });
            
            delete room.players[npcToReplace.id];
            room.players[socket.id] = newPlayer;

            const turnIndex = room.gameState.turnOrder.indexOf(npcToReplace.id);
            if (turnIndex > -1) {
                room.gameState.turnOrder[turnIndex] = socket.id;
            }
            
            socket.join(roomId);
            this.socketToRoom[socket.id] = roomId; // Map socket to room for efficiency
            
            socket.emit('joinSuccess', room);
            this.emitGameState(roomId);
            return;
        }
        
        // --- ORIGINAL LOBBY JOIN LOGIC ---
        const newPlayer = this.createPlayerObject(socket.id, playerName);
        room.players[socket.id] = newPlayer;
        socket.join(roomId);
        this.socketToRoom[socket.id] = roomId; // Map socket to room for efficiency
        
        socket.emit('joinSuccess', room);
        this.emitPlayerListUpdate(roomId);
    }
    
    createPlayerObject(id, name) {
        return {
            id,
            name,
            isNpc: false,
            role: 'Explorer', // Default role
            class: null,
            stats: { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, shieldHp: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
            currentAp: 0,
            lifeCount: 3,
            hand: [],
            equipment: { weapon: null, armor: null },
            statusEffects: [],
            pendingEventRoll: false,
            pendingEventChoice: null,
            pendingEquipmentChoice: null, 
            pendingItemSwap: null,
            pendingWorldEventSave: null,
            healthDice: { current: 0, max: 0 }
        };
    }

    // --- 3.3. Game Lifecycle (Create, Join, Start) ---
    
    // --- 3.4. Player Setup (Class, Stats, Cards) ---
    assignClassToPlayer(roomId, player, classId) {
        const classStats = gameData.classes[classId];
        if (!classStats || !player) return;

        player.class = classId;
        player.stats = this.calculatePlayerStats(player);
        player.stats.currentHp = player.stats.maxHp;
        
        player.healthDice.max = classStats.healthDice;
        player.healthDice.current = classStats.healthDice;
    }

    chooseClass(socket, { classId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || player.class || player.role !== 'Explorer') return;
    
        this.assignClassToPlayer(room.id, player, classId);
        
        const humanPlayers = Object.values(room.players).filter(p => !p.isNpc && p.role === 'Explorer');
        const allHumansReady = humanPlayers.every(p => p.class);

        if (allHumansReady) {
            this._completeSetupAndStartGame(room);
        } else {
            this.emitGameState(room.id); // Update for everyone else to see the class choice
        }
    }
    
    calculatePlayerStats(player) {
        if (!player.class) {
            return { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, shieldHp: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
        }
    
        const classStats = gameData.classes[player.class];
        const newStats = {
            maxHp: classStats.baseHp,
            damageBonus: classStats.baseDamageBonus,
            shieldBonus: classStats.baseShieldBonus,
            ap: classStats.baseAp,
            shieldHp: player.stats.shieldHp || 0,
            ...classStats.stats // Base attributes
        };
    
        for (const item of Object.values(player.equipment)) {
            if (item && item.effect && item.effect.bonuses) {
                newStats.damageBonus += item.effect.bonuses.damageBonus || 0;
                newStats.shieldBonus += item.effect.bonuses.shieldBonus || 0;
                newStats.ap += item.effect.bonuses.ap || 0;
                newStats.maxHp += item.effect.bonuses.hp || 0;
                newStats.str += item.effect.bonuses.str || 0;
                newStats.dex += item.effect.bonuses.dex || 0;
                newStats.con += item.effect.bonuses.con || 0;
                newStats.int += item.effect.bonuses.int || 0;
                newStats.wis += item.effect.bonuses.wis || 0;
                newStats.cha += item.effect.bonuses.cha || 0;
            }
        }
        
        if (player.statusEffects) {
            for (const effect of player.statusEffects) {
                if (effect.type === 'stat_modifier' && effect.bonuses) {
                    newStats.damageBonus += effect.bonuses.damageBonus || 0;
                    newStats.shieldBonus += effect.bonuses.shieldBonus || 0;
                    newStats.ap += effect.bonuses.ap || 0;
                    newStats.maxHp += effect.bonuses.hp || 0;
                }
            }
        }
    
        newStats.currentHp = Math.min(player.stats.currentHp, newStats.maxHp);
        
        return newStats;
    }

    _completeSetupAndStartGame(room) {
        // --- Part 1: Finalize turn order ---
        const explorerIds = Object.values(room.players).filter(p => p.role === 'Explorer').map(p => p.id);
        const dmId = Object.values(room.players).find(p => p.role === 'DM').id;
        shuffle(explorerIds);
        room.gameState.turnOrder = [dmId, ...explorerIds];
    
        // --- Part 2: Build and shuffle all decks ---
        const createDeck = (cardArray) => cardArray.map(c => ({...c, id: this.generateUniqueCardId() }));
        Object.keys(room.gameState.decks).forEach(key => {
            if(key === 'monster') {
                Object.keys(room.gameState.decks.monster).forEach(tier => {
                    room.gameState.decks.monster[tier] = createDeck(gameData.monsterTiers[tier]);
                    shuffle(room.gameState.decks.monster[tier]);
                });
            } else if (key !== 'treasure') {
                const sourceDataKey = `${key}Cards`; // e.g., 'itemCards'
                if(gameData[sourceDataKey]) {
                    room.gameState.decks[key] = createDeck(gameData[sourceDataKey]);
                    shuffle(room.gameState.decks[key]);
                }
            }
        });
        room.gameState.decks.treasure = [
            ...room.gameState.decks.item, ...room.gameState.decks.weapon, ...room.gameState.decks.armor
        ];
        shuffle(room.gameState.decks.treasure);
    
    
        // --- Part 3: Setup all players (human and NPC) ---
        Object.values(room.players).filter(p => p.role === 'Explorer').forEach(player => {
            if(player.isNpc && !player.class) {
                 const classKeys = Object.keys(gameData.classes);
                 const randomClassId = classKeys[Math.floor(Math.random() * classKeys.length)];
                 this.assignClassToPlayer(room.id, player, randomClassId);
            }
            this._setupPlayerHandAndGear(room, player);
        });
        
        // --- Part 4: Start the game ---
        room.gameState.phase = 'started';
        // CRITICAL FIX: Emit the specific 'gameStarted' event that the client is waiting for.
        // This unblocks the client from the "waiting/class selection" state into the main game.
        io.to(room.id).emit('gameStarted', room); 
        this.startFirstTurn(room.id);
    }

    _setupPlayerHandAndGear(room, player) {
        if (player.hand.length > 0 || player.equipment.weapon || player.equipment.armor) return;
        const gameMode = room.gameState.gameMode;
        const settings = room.gameState.customSettings;

        if (gameMode === 'Beginner') {
            this.dealCard(room.id, player.id, 'weapon', 1);
            this.dealCard(room.id, player.id, 'armor', 1);
        } else if (gameMode === 'Custom') {
            if (settings.startWithWeapon) this.dealCard(room.id, player.id, 'weapon', 1);
            if (settings.startWithArmor) this.dealCard(room.id, player.id, 'armor', 1);
        } else if (gameMode === 'Advanced') { // Simplified advanced mode, default to gear
            this.dealCard(room.id, player.id, 'weapon', 1);
            this.dealCard(room.id, player.id, 'armor', 1);
        }
        
        const weapon = player.hand.find(c => c.type === 'Weapon');
        if (weapon) this._internalEquipItem(room, player, weapon.id);
        const armor = player.hand.find(c => c.type === 'Armor');
        if (armor) this._internalEquipItem(room, player, armor.id);

        if (gameMode === 'Beginner') {
            this.dealCard(room.id, player.id, 'item', 2);
            this.dealCard(room.id, player.id, 'spell', 2);
        } else if (gameMode === 'Custom') {
            if (settings.startingItems > 0) this.dealCard(room.id, player.id, 'item', settings.startingItems);
            if (settings.startingSpells > 0) this.dealCard(room.id, player.id, 'spell', settings.startingSpells);
        } else if (gameMode === 'Advanced') { // Simplified advanced mode, default to resources
            this.dealCard(room.id, player.id, 'item', 2);
            this.dealCard(room.id, player.id, 'spell', 1);
        }
    }

    dealCard(roomId, playerId, deckName, count) {
        const room = this.rooms[roomId];
        const player = room?.players[playerId];
        if (!room || !player) return;
    
        const mainDeck = room.gameState.decks[deckName];
        if (!mainDeck) return;
    
        const cardsToDeal = [];
        const shouldFilter = player.class && (deckName === 'weapon' || deckName === 'armor' || deckName === 'spell');
    
        if (shouldFilter) {
            let suitableCards = mainDeck.filter(card => {
                if ((player.class === 'Barbarian' || player.class === 'Warrior') && card.type === 'Spell') {
                    return true;
                }
                return !card.class || card.class.includes("Any") || card.class.includes(player.class);
            });
    
            for (let i = 0; i < count; i++) {
                if (suitableCards.length > 0) {
                    const cardIndex = Math.floor(Math.random() * suitableCards.length);
                    const card = suitableCards.splice(cardIndex, 1)[0];
                    cardsToDeal.push(card);
                    
                    const mainDeckIndex = mainDeck.findIndex(c => c.id === card.id);
                    if (mainDeckIndex > -1) {
                        mainDeck.splice(mainDeckIndex, 1);
                    }
                } else {
                    break;
                }
            }
        } else {
            for (let i = 0; i < count; i++) {
                if (mainDeck.length > 0) {
                    cardsToDeal.push(mainDeck.pop());
                } else {
                    break;
                }
            }
        }
    
        if (cardsToDeal.length > 0) {
            for(const card of cardsToDeal) {
                this._addCardToPlayerHand(room, player, card);
            }
        }

        if (cardsToDeal.length < count && shouldFilter) {
            this.sendMessageToRoom(roomId, {
                channel: 'game', type: 'system',
                message: `<b>${player.name}</b> could not draw a full hand of ${deckName} cards. The deck may be out of cards suitable for their class.`
            });
        }
    }

    _addCardToPlayerHand(room, player, card) {
        if (player.hand.length >= room.gameState.customSettings.maxHandSize) {
            player.pendingItemSwap = { newCard: card };
            this.sendMessageToRoom(room.id, {
                channel: 'game', type: 'system',
                message: `<b>${player.name}</b>'s hand is full! They must swap an item to receive the new ${card.name}.`
            });
        } else {
            player.hand.push(card);
        }
    }

    _internalEquipItem(room, player, cardId) {
        if (!player) return false;
    
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return false;
        
        const cardToEquipFromHand = player.hand[cardIndex];

        if (cardToEquipFromHand.class && !cardToEquipFromHand.class.includes("Any") && !cardToEquipFromHand.class.includes(player.class)) {
            if (!player.isNpc) {
                 const socket = io.sockets.sockets.get(player.id);
                 if (socket) socket.emit('actionError', `Your class cannot equip ${cardToEquipFromHand.name}.`);
            }
            return false;
        }
        
        const cardToEquip = player.hand.splice(cardIndex, 1)[0];
        const itemType = cardToEquip.type.toLowerCase();
    
        if (player.equipment[itemType]) {
            const oldItem = player.equipment[itemType];
            player.hand.push(oldItem);
        }
        
        player.equipment[itemType] = cardToEquip;
        
        player.stats = this.calculatePlayerStats(player);
        return true;
    }

    equipItem(socket, { cardId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
    
        const success = this._internalEquipItem(room, player, cardId);
        
        if (!success && player) {
            return;
        }
        
        this.emitGameState(room.id);
    }
    
    // --- 3.5. Turn Management ---
    startFirstTurn(roomId) {
        const room = this.rooms[roomId];
        room.gameState.currentPlayerIndex = 0;
        room.gameState.turnCount = 1;
        this.sendMessageToRoom(roomId, {
            channel: 'game',
            type: 'system',
            message: `The game has begun!`
        });
        this.startTurn(roomId);
    }
    
    async startTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room) return;
        const player = room.players[room.gameState.turnOrder[room.gameState.currentPlayerIndex]];
        if (!player) return;

        if (player.statusEffects && player.statusEffects.length > 0) {
            player.statusEffects.forEach(effect => {
                if (effect.duration) effect.duration--;
            });

            const expiredEffects = player.statusEffects.filter(effect => effect.duration <= 0);
            if (expiredEffects.length > 0) {
                expiredEffects.forEach(effect => {
                     this.sendMessageToRoom(roomId, { 
                        channel: 'game', 
                        type: 'system', 
                        message: `The effect of '${effect.name}' has worn off for ${player.name}.` 
                    });
                });
                player.statusEffects = player.statusEffects.filter(effect => effect.duration > 0);
            }
        }
        
        if (player.isNpc && player.role === 'DM') {
            await this.handleDmTurn(room);
            setTimeout(() => this.endTurn(null, player.id), 1500);
            return;
        }

        if (player.isNpc && player.role === 'Explorer') {
            player.stats = this.calculatePlayerStats(player);
            player.currentAp = player.stats.ap;
            this.emitGameState(roomId);
            this.handleNpcExplorerTurn(room, player);
            return;
        }

        player.stats = this.calculatePlayerStats(player);
        player.currentAp = player.stats.ap;
        
        if (player.role === 'Explorer' && !player.isNpc) {
            player.pendingEventRoll = true;
        }

        this.emitGameState(roomId);
    }

    endTurn(socket, directPlayerId = null) {
        const room = directPlayerId ? this.rooms[Object.keys(this.rooms).find(r => this.rooms[r].players[directPlayerId])] : this.findRoomBySocket(socket);
        if (!room) return;

        const playerId = directPlayerId || socket.id;
        const player = room.players[playerId];
        if (!player || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== player.id) {
            return;
        }
    
        const isStunned = player.statusEffects && player.statusEffects.some(e => e.type === 'stun' || e.name === 'Stunned');
        if (isStunned) {
            this.sendMessageToRoom(room.id, {
                channel: 'game',
                type: 'system',
                message: `${player.name} is stunned and their turn ends!`
            });
        }
        
        player.stats.shieldHp = 0;
        
        room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
        if (room.gameState.currentPlayerIndex === 0) {
            room.gameState.turnCount++;
        }
        this.startTurn(room.id);
    }

    // --- 3.6. AI Logic (NPC Turns) ---
    _npcAutoEquip(room, player) {
        const getCardPower = (card) => {
            if (!card) return 0;
            if (card.type === 'Weapon') return this.rollDice(card.effect.dice) + (card.effect.bonuses?.damageBonus || 0);
            if (card.type === 'Armor') return (card.effect.bonuses?.shieldBonus || 0) + (card.effect.bonuses?.ap || 0);
            return 0;
        };

        const currentWeaponPower = getCardPower(player.equipment.weapon);
        const bestWeaponInHand = player.hand
            .filter(c => c.type === 'Weapon')
            .sort((a, b) => getCardPower(b) - getCardPower(a))[0];

        if (bestWeaponInHand && getCardPower(bestWeaponInHand) > currentWeaponPower) {
            this._internalEquipItem(room, player, bestWeaponInHand.id);
        }

        const currentArmorPower = getCardPower(player.equipment.armor);
        const bestArmorInHand = player.hand
            .filter(c => c.type === 'Armor')
            .sort((a, b) => getCardPower(b) - getCardPower(a))[0];

        if (bestArmorInHand && getCardPower(bestArmorInHand) > currentArmorPower) {
            this._internalEquipItem(room, player, bestArmorInHand.id);
        }
    }
    
    determine_ai_action(player, gameState, allPlayers) {
        const { board, skillChallenge } = gameState;
        const { currentAp, stats, hand, healthDice, equipment, class: playerClass } = player;
        const partyMembers = Object.values(allPlayers).filter(p => p.role === 'Explorer');
        
        let bestHealTarget = { utility: -1, target: null, card: null };
        hand.forEach(card => {
            const cardApCost = card.apCost || 1;
            if (currentAp >= cardApCost && card.effect && card.effect.type === 'heal') {
                partyMembers.forEach(ally => {
                    if (ally.stats.currentHp < ally.stats.maxHp * 0.5) {
                        const healthDeficit = 1 - (ally.stats.currentHp / ally.stats.maxHp);
                        if (healthDeficit > bestHealTarget.utility) {
                            bestHealTarget = { utility: healthDeficit, target: ally, card: card };
                        }
                    }
                });
            }
        });
        if (bestHealTarget.target) {
            return { action: 'useCard', cardId: bestHealTarget.card.id, targetId: bestHealTarget.target.id, apCost: bestHealTarget.card.apCost || 1 };
        }

        if (board.monsters.length > 0) {
            const weapon = equipment.weapon;
            if (weapon) {
                const apCost = weapon.apCost || 2; 
                if (currentAp >= apCost) {
                    let bestTarget = board.monsters.reduce((prev, curr) => (prev.currentHp < curr.currentHp) ? prev : curr);
                    if (bestTarget) {
                        return { action: 'attack', targetId: bestTarget.id, weaponId: weapon.id, apCost: apCost };
                    }
                }
            } else if (currentAp >= 1) { // Unarmed Strike as a fallback
                let bestTarget = board.monsters.reduce((prev, curr) => (prev.currentHp < curr.currentHp) ? prev : curr);
                 if (bestTarget) {
                    return { action: 'unarmedAttack', targetId: bestTarget.id, apCost: 1 };
                }
            }
        }
        
        const classAbility = gameData.classes[playerClass]?.ability;
        if (classAbility && currentAp >= classAbility.apCost) {
            let canUseAbility = true;
            if (classAbility.cost?.type === 'discard' && classAbility.cost?.cardType === 'Spell') {
                if (!hand.some(card => card.type === 'Spell')) {
                    canUseAbility = false;
                }
            }
            if (canUseAbility) {
                if (playerClass === 'Mage') return { action: 'useClassAbility', apCost: classAbility.apCost };
                if (playerClass === 'Cleric' && board.monsters.length > 0) return { action: 'useClassAbility', apCost: classAbility.apCost };
                if ((playerClass === 'Barbarian' || playerClass === 'Warrior') && board.monsters.length > 0) {
                    return { action: 'useClassAbility', apCost: classAbility.apCost };
                }
            }
        }
        
        if (board.monsters.length > 0) {
            for (const card of hand) {
                const cardApCost = card.apCost || 1;
                if (currentAp >= cardApCost && card.effect && (card.effect.type === 'utility' || card.effect.type === 'damage')) {
                    const target = board.monsters[0];
                    return { action: 'useCard', cardId: card.id, targetId: target.id, apCost: cardApCost };
                }
            }
        }
        
        if (skillChallenge.isActive && currentAp >= 1) {
            const challengeData = gameData.skillChallenges.find(c => c.id === skillChallenge.challengeId);
            const myStat = stats[challengeData.skill] || 0;
            if (myStat >= 0) {
                return { action: 'contributeToSkillChallenge', apCost: 1 };
            }
        }

        const guardApCost = gameData.actionCosts.guard;
        if (currentAp >= guardApCost && stats.currentHp < stats.maxHp * 0.75) {
            return { action: 'guard', apCost: guardApCost };
        }
        
        if (board.monsters.length === 0) {
            const fullRestApCost = gameData.actionCosts.fullRest;
            if (currentAp >= fullRestApCost && healthDice.current >= 2 && stats.currentHp < stats.maxHp) {
                return { action: 'fullRest', apCost: fullRestApCost };
            }
            const respiteApCost = gameData.actionCosts.briefRespite;
            if (currentAp >= respiteApCost && healthDice.current > 0 && stats.currentHp < stats.maxHp) {
                return { action: 'briefRespite', apCost: respiteApCost };
            }
        }

        return { action: 'wait', apCost: 0 };
    }

    async handleNpcExplorerTurn(room, player) {
        try {
            if (player.statusEffects && player.statusEffects.some(e => e.type === 'stun' || e.name === 'Stunned')) {
                this.sendMessageToRoom(room.id, { 
                    channel: 'game', 
                    type: 'system', 
                    message: `<b>${player.name}</b> is stunned and cannot act!` 
                });
                this.endTurn(null, player.id); //
                return;
            }

            await new Promise(res => setTimeout(res, 1500));

            this._npcAutoEquip(room, room.players[player.id]);
            this.emitGameState(room.id);
            await new Promise(res => setTimeout(res, 1000));

            while (true) {
                const currentPlayerState = room.players[player.id];
                if (!currentPlayerState || currentPlayerState.currentAp <= 0) {
                    break; 
                }

                const bestAction = this.determine_ai_action(currentPlayerState, room.gameState, room.players);

                if (!bestAction || bestAction.action === 'wait' || currentPlayerState.currentAp < bestAction.apCost) {
                    break;
                }
                
                const narrative = gameData.npcDialogue.explorer.attack[Math.floor(Math.random() * gameData.npcDialogue.explorer.attack.length)];

                switch (bestAction.action) {
                    case 'useClassAbility':
                        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>${player.name}</b> uses their ${player.class} ability!` });
                        this._resolveUseClassAbility(room, currentPlayerState, null);
                        break;
                    case 'attack':
                        this._resolveAttack(room, {
                            attackerId: player.id,
                            targetId: bestAction.targetId,
                            weaponId: bestAction.weaponId,
                            narrative: narrative
                        });
                        break;
                     case 'unarmedAttack':
                        this._resolveUnarmedAttack(room, {
                            attackerId: player.id,
                            targetId: bestAction.targetId,
                            narrative: narrative
                        });
                        break;
                    case 'guard':
                        currentPlayerState.currentAp -= bestAction.apCost;
                        const guardBonus = currentPlayerState.equipment.armor?.guardBonus || 2;
                        currentPlayerState.stats.shieldHp += guardBonus;
                        this.sendMessageToRoom(room.id, {
                            channel: 'game',
                            type: 'system',
                            message: `<b>${player.name}</b> used ${bestAction.apCost} AP to Guard, gaining ${guardBonus} Shield HP.`
                        });
                        break;
                    case 'briefRespite':
                        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>${player.name}</b> takes a brief respite to tend their wounds.` });
                        this._resolveBriefRespite(room, currentPlayerState);
                        break;
                    case 'fullRest':
                         this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>${player.name}</b> takes a moment to rest and recover fully.` });
                        this._resolveFullRest(room, currentPlayerState);
                        break;
                    case 'useCard':
                         this._resolveUseCard(room, currentPlayerState, { cardId: bestAction.cardId, targetId: bestAction.targetId }, "An NPC used a card.");
                         break;
                    case 'contributeToSkillChallenge':
                         this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>${player.name}</b> contributes to the skill challenge.` });
                        this._resolveContributeToSkillChallenge(room, currentPlayerState);
                        break;
                }

                this.emitGameState(room.id);
                await new Promise(res => setTimeout(res, 1500));
            }
        } catch (error) {
            console.error("Error during NPC turn:", error);
        } finally {
            this.endTurn(null, player.id);
        }
    }
    
    async handleDmTurn(room) {
        this.sendMessageToRoom(room.id, { 
            channel: 'game', 
            type: 'system', 
            message: `It is the Dungeon Master's turn.` 
        });
        
        if (room.gameState.board.monsters.length === 0) {
            this.dmPlayMonster(room);
        } else {
            for (const monster of room.gameState.board.monsters) {
                const targetId = this._chooseMonsterTarget(room);
                if (targetId) {
                    this._resolveMonsterAttack(room, monster.id, targetId);
                    await new Promise(res => setTimeout(res, 1000));
                }
            }
        }
        this.emitGameState(room.id);
    }
    
    _chooseMonsterTarget(room) {
        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer');
        if (explorers.length > 0) {
            return explorers[Math.floor(Math.random() * explorers.length)].id;
        }
        return null;
    }

    dmPlayMonster(room) {
        let deck;
        if (room.gameState.turnCount <= 3) {
            deck = room.gameState.decks.monster.tier1;
        } else if (room.gameState.turnCount <= 6) {
            deck = room.gameState.decks.monster.tier2;
        } else {
            deck = room.gameState.decks.monster.tier3;
        }

        if (deck.length > 0) {
            const monsterCard = deck.pop();
            monsterCard.currentHp = monsterCard.maxHp;
            monsterCard.statusEffects = [];
            room.gameState.board.monsters.push(monsterCard);
            this.sendMessageToRoom(room.id, {
                channel: 'game',
                type: 'system',
                message: `The Dungeon Master summons a <b>${monsterCard.name}</b>!`
            });
            this.emitGameState(room.id);
        }
    }

    // --- 3.7. Action Resolution ---
    handlePlayerAction(socket, data) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== player.id) {
            return;
        }

        const { action, cardId, targetId, narrative } = data;

        switch (action) {
            case 'attack':
                this._resolveAttack(room, { attackerId: player.id, targetId, weaponId: cardId, narrative });
                break;
            case 'useItem':
            case 'castSpell':
                this._resolveUseCard(room, player, { cardId, targetId }, narrative);
                break;
            case 'useClassAbility':
                 this._resolveUseClassAbility(room, player, narrative);
                break;
            case 'guard':
                if (player.currentAp >= gameData.actionCosts.guard) {
                    player.currentAp -= gameData.actionCosts.guard;
                    const bonus = player.equipment.armor?.guardBonus || 2;
                    player.stats.shieldHp += bonus;
                    this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>${player.name}</b> guards, gaining ${bonus} Shield HP.` });
                } else { socket.emit('actionError', `Not enough AP. Guard costs ${gameData.actionCosts.guard}.`); }
                break;
            case 'briefRespite':
                 this._resolveBriefRespite(room, player);
                break;
            case 'fullRest':
                 this._resolveFullRest(room, player);
                break;
            case 'contributeToSkillChallenge':
                this._resolveContributeToSkillChallenge(room, player, data.itemId);
                break;
        }
        this.emitGameState(room.id);
    }
    
    _resolveAttack(room, { attackerId, targetId, weaponId, narrative }) {
        const attacker = room.players[attackerId];
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        const weapon = attacker.equipment.weapon;

        if (!attacker || !target) return;
        if (weaponId !== 'unarmed' && (!weapon || weapon.id !== weaponId)) return;
        
        if (weaponId === 'unarmed') {
            return this._resolveUnarmedAttack(room, { attackerId, targetId, narrative });
        }
        
        const apCost = weapon.apCost || 2;
        if (attacker.currentAp < apCost) {
            io.sockets.sockets.get(attackerId)?.emit('actionError', `Not enough AP. This attack costs ${apCost}.`);
            return;
        }
        attacker.currentAp -= apCost;

        this.sendMessageToRoom(room.id, { channel: 'game', type: 'narrative', senderName: attacker.name, message: `attacks the ${target.name} with their ${weapon.name}! ${narrative}` });
        
        const d20Roll = this.rollDice('1d20');
        const isCrit = d20Roll === 20;
        const isFumble = d20Roll === 1;
        const totalRollToHit = d20Roll + attacker.stats.damageBonus;
        const hit = isCrit || (!isFumble && totalRollToHit >= target.requiredRollToHit);
        
        let totalDamage = 0;
        let rawDamageRoll = 0;

        if (hit) {
            rawDamageRoll = this.rollDice(weapon.effect.dice);
            totalDamage = rawDamageRoll + attacker.stats.damageBonus;
            if(isCrit) totalDamage += this.rollDice(weapon.effect.dice);
            
            target.currentHp -= totalDamage;
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>HIT!</b> ${attacker.name} dealt <b>${totalDamage}</b> damage to ${target.name}.` });
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<em>(Roll: ${d20Roll} + ${attacker.stats.damageBonus} = ${totalRollToHit} vs DC ${target.requiredRollToHit})</em>` });
        } else {
             this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>MISS!</b> ${attacker.name} failed to hit ${target.name}.` });
             this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<em>(Roll: ${d20Roll} + ${attacker.stats.damageBonus} = ${totalRollToHit} vs DC ${target.requiredRollToHit})</em>` });
        }
        
        io.to(room.id).emit('attackAnimation', {
            attackerId, targetId, d20Roll, isCrit, isFumble, totalRollToHit, requiredRoll: target.requiredRollToHit, hit, 
            damageDice: weapon.effect.dice, rawDamageRoll, damageBonus: attacker.stats.damageBonus, totalDamage
        });

        if (target.currentHp <= 0) {
            this._handleMonsterDefeat(room, target.id);
        }
    }

    _resolveUnarmedAttack(room, { attackerId, targetId, narrative }) {
        const attacker = room.players[attackerId];
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!attacker || !target) return;

        const apCost = 1;
        if (attacker.currentAp < apCost) {
            io.sockets.sockets.get(attackerId)?.emit('actionError', `Not enough AP for an Unarmed Strike.`);
            return;
        }
        attacker.currentAp -= apCost;
        
        this.sendMessageToRoom(room.id, { channel: 'game', type: 'narrative', senderName: attacker.name, message: `strikes the ${target.name} with their bare fists! ${narrative}` });
        
        const d20Roll = this.rollDice('1d20');
        const isCrit = d20Roll === 20;
        const isFumble = d20Roll === 1;
        const totalRollToHit = d20Roll + attacker.stats.str;
        const hit = isCrit || (!isFumble && totalRollToHit >= target.requiredRollToHit);
        
        let totalDamage = 0;
        if (hit) {
            totalDamage = 1 + attacker.stats.str;
            if (isCrit) totalDamage *= 2;
            target.currentHp -= totalDamage;
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>HIT!</b> ${attacker.name} dealt <b>${totalDamage}</b> damage to ${target.name} with their fists.` });
             this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<em>(Roll: ${d20Roll} + ${attacker.stats.str} = ${totalRollToHit} vs DC ${target.requiredRollToHit})</em>` });
        } else {
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>MISS!</b> ${attacker.name} failed to land a punch on ${target.name}.` });
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<em>(Roll: ${d20Roll} + ${attacker.stats.str} = ${totalRollToHit} vs DC ${target.requiredRollToHit})</em>` });
        }

        io.to(room.id).emit('attackAnimation', {
            attackerId, targetId, d20Roll, isCrit, isFumble, totalRollToHit, requiredRoll: target.requiredRollToHit, hit, 
            damageDice: 'unarmed', rawDamageRoll: 0, damageBonus: attacker.stats.str + 1, totalDamage
        });

        if (target.currentHp <= 0) {
            this._handleMonsterDefeat(room, target.id);
        }
    }
    
    _resolveMonsterAttack(room, monsterId, targetId) {
        const monster = room.gameState.board.monsters.find(m => m.id === monsterId);
        const target = room.players[targetId];
        if (!monster || !target) return;

        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `The <b>${monster.name}</b> attacks <b>${target.name}</b>!` });
        
        const d20Roll = this.rollDice('1d20');
        const isCrit = d20Roll === 20;
        const isFumble = d20Roll === 1;
        const totalRollToHit = d20Roll + monster.attackBonus;
        const requiredRoll = 10 + target.stats.shieldBonus;
        const hit = isCrit || (!isFumble && totalRollToHit >= requiredRoll);
        
        let totalDamage = 0;
        let rawDamageRoll = 0;

        if (hit) {
            rawDamageRoll = this.rollDice(monster.effect.dice);
            totalDamage = rawDamageRoll;
            if(isCrit) totalDamage += this.rollDice(monster.effect.dice);
            
            this._applyDamageToPlayer(room, target, totalDamage);
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>HIT!</b> The ${monster.name} dealt <b>${totalDamage}</b> damage to ${target.name}.` });
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<em>(Roll: ${d20Roll} + ${monster.attackBonus} = ${totalRollToHit} vs DC ${requiredRoll})</em>` });
        } else {
             this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>MISS!</b> The ${monster.name} failed to hit ${target.name}.` });
             this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<em>(Roll: ${d20Roll} + ${monster.attackBonus} = ${totalRollToHit} vs DC ${requiredRoll})</em>` });
        }
        
        io.to(room.id).emit('monsterAttackAnimation', {
            monsterId, targetId, d20Roll, isCrit, isFumble, totalRollToHit, requiredRoll, hit,
            damageDice: monster.effect.dice, rawDamageRoll, attackBonus: monster.attackBonus, totalDamage
        });
        
        if (target.stats.currentHp <= 0) {
            // Handle player defeat
        }
    }

    _handleMonsterDefeat(room, monsterId) {
        const monsterIndex = room.gameState.board.monsters.findIndex(m => m.id === monsterId);
        if (monsterIndex > -1) {
            const monster = room.gameState.board.monsters[monsterIndex];
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `The <b>${monster.name}</b> has been defeated!` });
            room.gameState.board.monsters.splice(monsterIndex, 1);

            if (Math.random() * 100 < room.gameState.customSettings.lootDropRate) {
                if (room.gameState.decks.treasure.length > 0) {
                    const lootCard = room.gameState.decks.treasure.pop();
                    room.gameState.lootPool.push(lootCard);
                     this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `The party discovered a <b>${lootCard.name}</b>!` });
                }
            }
        }
    }
    
    _applyDamageToPlayer(room, player, damage) {
        let remainingDamage = damage;
        
        if (player.stats.shieldHp > 0) {
            const shieldDamage = Math.min(player.stats.shieldHp, remainingDamage);
            player.stats.shieldHp -= shieldDamage;
            remainingDamage -= shieldDamage;
        }
        
        if (remainingDamage > 0) {
            player.stats.currentHp -= remainingDamage;
        }

        if (player.stats.currentHp <= 0) {
            player.stats.currentHp = 0;
            player.lifeCount -= 1;
            if (player.lifeCount > 0) {
                player.stats.currentHp = Math.floor(player.stats.maxHp / 2);
                this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>${player.name}</b> has fallen but gets back up! They have ${player.lifeCount} lives remaining.` });
            } else {
                 this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>${player.name}</b> has fallen and is out of the fight!` });
            }
        }
    }

    _resolveBriefRespite(room, player) {
        const apCost = gameData.actionCosts.briefRespite;
        if (player.currentAp >= apCost && player.healthDice.current > 0) {
            player.currentAp -= apCost;
            player.healthDice.current--;
            const healAmount = this.rollDice(`1d${player.healthDice.max}`);
            player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healAmount);
            // CRITICAL FIX: Corrected syntax error from incomplete object.
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>${player.name}</b> uses a Health Die and recovers <b>${healAmount}</b> HP.` });
        } else {
            const socket = io.sockets.sockets.get(player.id);
            if (socket) {
                socket.emit('actionError', `Not enough AP or Health Dice.`);
            }
        }
    }
    
    _resolveFullRest(room, player) {
        const apCost = gameData.actionCosts.fullRest;
        if (player.currentAp >= apCost && player.healthDice.current >= 2) {
            player.currentAp -= apCost;
            player.healthDice.current -= 2;
            const healAmount1 = this.rollDice(`1d${player.healthDice.max}`);
            const healAmount2 = this.rollDice(`1d${player.healthDice.max}`);
            const totalHeal = healAmount1 + healAmount2;
            player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + totalHeal);
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>${player.name}</b> takes a full rest and recovers <b>${totalHeal}</b> HP.` });
        } else {
            const socket = io.sockets.sockets.get(player.id);
            if (socket) {
                socket.emit('actionError', `Not enough AP or Health Dice.`);
            }
        }
    }

    _resolveUseCard(room, player, { cardId, targetId }, narrative) {
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;

        const card = player.hand[cardIndex];
        const apCost = card.apCost || 1;
        if (player.currentAp < apCost) {
            const socket = io.sockets.sockets.get(player.id);
            if (socket) socket.emit('actionError', `Not enough AP. This card costs ${apCost}.`);
            return;
        }
        player.currentAp -= apCost;
        
        const isConsumable = card.type === 'Consumable';

        this.sendMessageToRoom(room.id, { channel: 'game', type: 'narrative', senderName: player.name, message: `uses ${card.name}! ${narrative}` });

        const effect = card.effect;
        if (effect.type === 'heal') {
            const target = room.players[targetId || player.id];
            if (!target) return;
            const healAmount = this.rollDice(effect.dice);
            target.stats.currentHp = Math.min(target.stats.maxHp, target.stats.currentHp + healAmount);
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${card.name} heals <b>${target.name}</b> for <b>${healAmount}</b> HP.` });
        } else if (effect.type === 'damage') {
            const target = room.gameState.board.monsters.find(m => m.id === targetId);
            if (target) {
                const damageAmount = this.rollDice(effect.dice);
                target.currentHp -= damageAmount;
                this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${card.name} deals <b>${damageAmount}</b> damage to <b>${target.name}</b>.` });
                if (target.currentHp <= 0) {
                    this._handleMonsterDefeat(room, target.id);
                }
            }
        } else if (effect.type === 'buff') {
            const target = room.players[targetId || player.id];
            if(target) {
                const newEffect = { ...effect, name: card.name, source: card.id };
                target.statusEffects.push(newEffect);
                this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${target.name} is affected by ${card.name}!` });
            }
        }

        if (isConsumable) {
            player.hand.splice(cardIndex, 1);
        }
    }
    
    _resolveUseClassAbility(room, player, narrative) {
        const ability = gameData.classes[player.class]?.ability;
        if (!ability || player.currentAp < ability.apCost) return;
        
        // Handle ability costs
        if (ability.cost?.type === 'discard' && ability.cost.cardType === 'Spell') {
            const spellIndex = player.hand.findIndex(c => c.type === 'Spell');
            if (spellIndex === -1) {
                const socket = io.sockets.sockets.get(player.id);
                if (socket) socket.emit('actionError', 'You need a Spell card to discard.');
                return;
            }
            player.hand.splice(spellIndex, 1);
        }
        
        player.currentAp -= ability.apCost;
        this.sendMessageToRoom(room.id, { channel: 'game', type: 'narrative', senderName: player.name, message: `uses ${ability.name}! ${narrative || ''}`});

        switch (player.class) {
            case 'Mage':
                this.dealCard(room.id, player.id, 'spell', 1);
                this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${player.name} draws a new spell.`});
                break;
            // Other class abilities would be implemented here
        }
    }
    
    _resolveContributeToSkillChallenge(room, player, itemId = null) {
        // Basic implementation
        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${player.name} contributes to the skill challenge.`});
    }

    // --- 3.8. Event & Challenge Handling ---
    rollForEvent(socket) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || !player.pendingEventRoll) return;

        player.pendingEventRoll = false;
        const roll = this.rollDice('1d20');
        let outcome = { type: 'none', message: 'The path is quiet. You continue your journey.' };

        if (roll >= 15) {
            const treasureDeck = room.gameState.decks.treasure;
            if (treasureDeck.length > 0) {
                const card = treasureDeck.pop();
                outcome = { type: 'itemFound', message: `You stumble upon a hidden cache and find a ${card.name}!`, card };
                this._addCardToPlayerHand(room, player, card);
                socket.emit('eventItemFound', card);
            }
        } else if (roll >= 10) {
             const eventDeck = room.gameState.decks.playerEvent;
             if (eventDeck.length > 2) {
                 const options = [eventDeck.pop(), eventDeck.pop(), eventDeck.pop()];
                 outcome = { type: 'playerEvent', message: 'An event occurs that affects you personally. You must choose your path.', options };
                 player.pendingEventChoice = { options };
             }
        }
        
        socket.emit('eventRollResult', { roll, outcome });
        this.emitGameState(room.id);
    }
    
    // --- 3.9. Voice Chat Relaying ---
    handleVoiceJoin(socket) {
        const room = this.findRoomBySocket(socket);
        if (!room) return;
        socket.emit('voice-peers', room.voiceChatPeers);
        room.voiceChatPeers.push(socket.id);
        socket.to(room.id).emit('voice-peer-join', { peerId: socket.id });
    }
    
    handleVoiceLeave(socket) {
        const room = this.findRoomBySocket(socket);
        if (!room) return;
        room.voiceChatPeers = room.voiceChatPeers.filter(id => id !== socket.id);
        socket.to(room.id).emit('voice-peer-disconnect', { peerId: socket.id });
    }

    // --- 3.10. Disconnect Logic ---
    handleDisconnect(socket) {
        const roomId = this.socketToRoom[socket.id];
        const room = this.rooms[roomId];
        if (!room) return;

        this.handleVoiceLeave(socket); // Also handle leaving voice chat

        const player = room.players[socket.id];
        if (player) {
            this.sendMessageToRoom(roomId, {
                channel: 'game', type: 'system',
                message: `<b>${player.name}</b> has disconnected.`
            });

            // Replace with NPC
            const npc = this.createPlayerObject(socket.id, player.name); // Re-use ID for simplicity
            npc.isNpc = true;
            Object.assign(npc, player); // Copy state
            room.players[socket.id] = npc;

            this.emitGameState(roomId);
        }
        
        delete this.socketToRoom[socket.id];
        // Don't delete the room if the host leaves, just replace them with an NPC.
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
    socket.on('sendMessage', (data) => {
        const room = gameManager.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (room && player) {
            gameManager.sendMessageToRoom(room.id, { ...data, senderName: player.name });
        }
    });
    socket.on('rollForEvent', () => gameManager.rollForEvent(socket));
    
    // Voice Chat
    socket.on('join-voice', () => gameManager.handleVoiceJoin(socket));
    socket.on('leave-voice', () => gameManager.handleVoiceLeave(socket));
    socket.on('voice-offer', (data) => socket.to(data.toId).emit('voice-offer', { offer: data.offer, fromId: socket.id }));
    socket.on('voice-answer', (data) => socket.to(data.toId).emit('voice-answer', { answer: data.answer, fromId: socket.id }));
    socket.on('voice-ice-candidate', (data) => socket.to(data.toId).emit('voice-ice-candidate', { candidate: data.candidate, fromId: socket.id }));
    
    // Disconnect
    socket.on('disconnect', () => gameManager.handleDisconnect(socket));
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
