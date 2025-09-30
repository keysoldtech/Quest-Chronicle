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
    
    // REBUILT: Single point of emission for game state. This is the core of the new architecture.
    emitGameState(roomId) {
        if (this.rooms[roomId]) {
            io.to(roomId).emit('gameStateUpdate', this.rooms[roomId]);
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
            voiceChatPeers: [],
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
                skillChallenge: { isActive: false },
            },
            chatLog: []
        };
    
        newPlayer.role = 'Explorer';
        this.rooms[newRoomId] = newRoom;
        socket.join(newRoomId);
        this.socketToRoom[socket.id] = newRoomId;
    
        this.emitGameState(newRoomId);
    }
    
    joinRoom(socket, { roomId, playerName }) {
        const room = this.rooms[roomId];
        if (!room) return socket.emit('actionError', 'Room not found.');
        if (Object.values(room.players).some(p => !p.isNpc)) return socket.emit('actionError', 'This game already has a player.');

        const newPlayer = this.createPlayerObject(socket.id, playerName);
        newPlayer.role = 'Explorer';
        room.players[socket.id] = newPlayer;
        socket.join(roomId);
        this.socketToRoom[socket.id] = newRoomId;
        
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
        const deck = room.gameState.decks[deckName];
        if (!deck || deck.length === 0) return null;

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
        // Temporary stats until equipment is finalized
        player.stats = this.calculatePlayerStats(player);
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
        
        for (const effect of player.statusEffects) {
             if (effect.type === 'stat_modifier' && effect.bonuses) {
                Object.keys(effect.bonuses).forEach(key => {
                    newStats[key] = (newStats[key] || 0) + effect.bonuses[key];
                });
            }
        }
    
        // Ensure current HP doesn't exceed new max HP
        if (player.stats.currentHp) {
            newStats.currentHp = Math.min(player.stats.currentHp, newStats.maxHp);
        }
        
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

        // Unequip old item and put it back in hand
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
        if (!room) return;

        const player = room.players[room.gameState.turnOrder[room.gameState.currentPlayerIndex]];
        if (!player) return;

        player.stats = this.calculatePlayerStats(player);
        player.currentAp = player.stats.ap;
        
        if (player.isNpc && player.role === 'DM') {
            await this.handleDmTurn(room);
        } else {
             // For human and NPC explorers, just emit the state. The client/NPC logic will handle the turn.
            this.emitGameState(roomId);
            if(player.isNpc) {
                 await new Promise(res => setTimeout(res, 1000)); // Pause for effect
                 this.handleNpcExplorerTurn(room, player);
            }
        }
    }

    endTurn(socket) {
        const room = this.findRoomBySocket(socket);
        if (!room) return;
        const player = room.players[socket.id];
        if (!player || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== player.id) return;
        
        // Clear temporary turn-based stats
        player.stats.shieldHp = 0;
        
        room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
        if (room.gameState.currentPlayerIndex === 0) {
            room.gameState.turnCount++;
        }
        this.startTurn(room.id);
    }
    
    // --- 3.6. AI Logic (NPC Turns) ---
    async handleDmTurn(room) {
        // Simple logic for Turn 1
        if (room.gameState.turnCount === 1) {
             const playMonsterChance = 0.7; // 70% chance to play a monster
             if (Math.random() < playMonsterChance) {
                 this.dmPlayMonster(room);
             } else {
                 this.dmPlayWorldEvent(room);
             }
             this.emitGameState(room.id);
        } else {
             // Logic for subsequent turns (monster attacks)
            if (room.gameState.board.monsters.length > 0) {
                 for (const monster of [...room.gameState.board.monsters]) { // Iterate over a copy
                    if (monster.currentHp <= 0) continue; // Skip defeated monsters
                    await new Promise(res => setTimeout(res, 1000)); // Pause between monster attacks
                    const targetId = this._chooseMonsterTarget(room);
                    if (targetId) {
                        this._resolveMonsterAttack(room, monster.id, targetId);
                        this.emitGameState(room.id);
                    }
                }
            } else {
                // If board is clear, play another monster
                this.dmPlayMonster(room);
                this.emitGameState(room.id);
            }
        }
        
        // End DM turn after a delay
        await new Promise(res => setTimeout(res, 1500));
        
        room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
        this.startTurn(room.id);
    }
    
     handleNpcExplorerTurn(room, player) {
        // AI: 1. Attack weakest monster with best available weapon. 2. If can't attack, guard.
        const monsters = room.gameState.board.monsters.filter(m => m.currentHp > 0);
        let actionTaken = false;

        if (monsters.length > 0) {
            const weakestMonster = monsters.sort((a, b) => a.currentHp - b.currentHp)[0];
            const weapon = player.equipment.weapon;

            // Try to attack with equipped weapon
            if (weapon && player.currentAp >= (weapon.apCost || 2)) {
                 this._resolveAttack(room, { attackerId: player.id, targetId: weakestMonster.id, weaponId: weapon.id });
                 actionTaken = true;
            // Else, try to attack with fists
            } else if (player.currentAp >= 1) { 
                 this._resolveAttack(room, { attackerId: player.id, targetId: weakestMonster.id, weaponId: 'unarmed' });
                 actionTaken = true;
            }
        } 
        
        // If no attack was possible, guard if we have AP
        if (!actionTaken && player.currentAp >= 1) {
             player.currentAp -= 1;
             player.stats.shieldHp += player.equipment.armor?.guardBonus || 2;
             actionTaken = true;
        }

        // If any action was taken, update the clients
        if (actionTaken) {
            this.emitGameState(room.id);
        }

        // End turn and start the next one
        room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
        this.startTurn(room.id);
    }

    _chooseMonsterTarget(room) {
        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer' && p.stats.currentHp > 0);
        return explorers.length > 0 ? explorers[Math.floor(Math.random() * explorers.length)].id : null;
    }

    dmPlayMonster(room) {
        const { turnCount, decks } = room.gameState;
        const tier = turnCount <= 3 ? 'tier1' : (turnCount <= 6 ? 'tier2' : 'tier3');
        const monsterCard = this.drawCardFromDeck(room.id, `monster.${tier}`);
        if (monsterCard) {
            monsterCard.currentHp = monsterCard.maxHp;
            monsterCard.statusEffects = [];
            room.gameState.board.monsters.push(monsterCard);
        }
    }
    
    dmPlayWorldEvent(room) {
        const eventCard = this.drawCardFromDeck(room.id, 'worldEvent');
        if (eventCard) {
            room.gameState.worldEvents.currentEvent = eventCard;
            room.gameState.worldEvents.duration = 2; // Example duration
        }
    }
    
    // --- 3.7. Action Resolution ---
    handlePlayerAction(socket, data) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== player.id) return;

        const { action, cardId, targetId } = data;

        switch (action) {
            case 'attack':
                this._resolveAttack(room, { attackerId: player.id, targetId, weaponId: cardId });
                break;
            case 'guard':
                const guardCost = gameData.actionCosts.guard;
                if (player.currentAp >= guardCost) {
                    player.currentAp -= guardCost;
                    player.stats.shieldHp += player.equipment.armor?.guardBonus || 2;
                }
                break;
        }
        this.emitGameState(room.id);
    }
    
    _resolveAttack(room, { attackerId, targetId, weaponId }) {
        const attacker = room.players[attackerId];
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!attacker || !target) return;

        const isUnarmed = weaponId === 'unarmed';
        const weapon = isUnarmed ? null : attacker.equipment.weapon;
        if (!isUnarmed && (!weapon || weapon.id !== weaponId)) return;

        const apCost = isUnarmed ? 1 : (weapon.apCost || 2);
        if (attacker.currentAp < apCost) return;
        attacker.currentAp -= apCost;

        const d20 = this.rollDice('1d20');
        const toHitBonus = isUnarmed ? attacker.stats.str : attacker.stats.damageBonus;
        const hit = d20 === 20 || (d20 !== 1 && (d20 + toHitBonus) >= target.requiredRollToHit);

        if (hit) {
            let damage = isUnarmed ? (1 + attacker.stats.str) : (this.rollDice(weapon.effect.dice) + attacker.stats.damageBonus);
            if (d20 === 20) damage *= 2; // Simple crit rule
            target.currentHp -= damage;

            if (target.currentHp <= 0) {
                this._handleMonsterDefeat(room, target.id);
            }
        }
    }
    
    _resolveMonsterAttack(room, monsterId, targetId) {
        const monster = room.gameState.board.monsters.find(m => m.id === monsterId);
        const target = room.players[targetId];
        if (!monster || !target) return;
        
        const d20 = this.rollDice('1d20');
        const hit = d20 === 20 || (d20 !== 1 && (d20 + monster.attackBonus) >= (10 + target.stats.shieldBonus));
        
        if (hit) {
            let damage = this.rollDice(monster.effect.dice);
            if(d20 === 20) damage *= 2;
            this._applyDamageToPlayer(target, damage);
        }
    }

    _handleMonsterDefeat(room, monsterId) {
        room.gameState.board.monsters = room.gameState.board.monsters.filter(m => m.id !== monsterId);
        const lootChance = (room.gameState.customSettings.lootDropRate || 50) / 100;
        if (Math.random() < lootChance) {
            const loot = this.drawCardFromDeck(room.id, 'treasure');
            if (loot) room.gameState.lootPool.push(loot);
        }
    }

    _applyDamageToPlayer(player, damage) {
        const shieldedDamage = Math.min(player.stats.shieldHp, damage);
        player.stats.shieldHp -= shieldedDamage;
        damage -= shieldedDamage;
        player.stats.currentHp -= damage;

        if (player.stats.currentHp <= 0) {
            player.stats.currentHp = 0;
            // Handle player death logic here if needed
        }
    }

    // --- 3.10. Disconnect Logic ---
    handleDisconnect(socket) {
        const roomId = this.socketToRoom[socket.id];
        const room = this.rooms[roomId];
        if (!room) return;
        
        // In a single-player game, a disconnect effectively ends the game.
        // For simplicity, we just remove the room.
        delete this.rooms[roomId];
        delete this.socketToRoom[socket.id];
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
    
    socket.on('disconnect', () => gameManager.handleDisconnect(socket));
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});