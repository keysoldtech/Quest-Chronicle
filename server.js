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
        return {
            id,
            name,
            isNpc: false,
            isDowned: false, // Player defeat state
            disconnected: false, // For reconnect logic
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
                winner: null, // To determine game over state
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
        if (Object.values(room.players).length > 0 && Object.values(room.players).some(p => !p.isNpc && !p.disconnected)) {
             return socket.emit('actionError', 'This game already has a player.');
        }

        const newPlayer = this.createPlayerObject(socket.id, playerName);
        newPlayer.role = 'Explorer';
        room.players[socket.id] = newPlayer;
        socket.join(roomId);
        this.socketToRoom[socket.id] = roomId;
        
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
        if (deckName.includes('.')) {
            const [parent, child] = deckName.split('.');
            deck = room.gameState.decks[parent]?.[child];
        } else {
            deck = room.gameState.decks[deckName];
        }

        if (!deck || deck.length === 0) return null;

        // FIXED: If looking for a class-specific card and none are found, return null instead of a random one.
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
            player.hand.push(player.equipment[itemType]);
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
        if (!room || room.gameState.turnOrder.length === 0 || room.gameState.phase !== 'started') return;
    
        const oldPlayerIndex = room.gameState.currentPlayerIndex;
        if (oldPlayerIndex > -1) {
            const oldPlayer = room.players[room.gameState.turnOrder[oldPlayerIndex]];
            if (oldPlayer && oldPlayer.role === 'Explorer') {
                oldPlayer.stats.shieldHp = 0;
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
        if (!player || player.isDowned || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== player.id) return;

        const { action, cardId, targetId, weaponId, narrative } = data;

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
            case 'guard':
                const guardCost = gameData.actionCosts.guard;
                if (player.currentAp >= guardCost) {
                    player.currentAp -= guardCost;
                    player.stats.shieldHp += player.equipment.armor?.guardBonus || 2;
                }
                this.emitGameState(room.id);
                break;
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

        const toHitBonus = isUnarmed ? player.stats.str : player.stats.damageBonus;
        
        socket.emit('promptAttackRoll', {
            action: 'attack',
            weaponId,
            targetId,
            dice: '1d20',
            bonus: toHitBonus,
            targetAC: target.requiredRollToHit,
            title: `Attack ${target.name}`
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
        
        const d20 = this.rollDice('1d20');
        const toHitBonus = isUnarmed ? attacker.stats.str : attacker.stats.damageBonus;
        const totalRoll = d20 + toHitBonus;
        const isCrit = d20 === 20;
        const isMiss = d20 === 1;
        const hit = !isMiss && (isCrit || totalRoll >= target.requiredRollToHit);

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
            weaponId, // Pass these through for the next step
            targetId,
        };
        
        if (!hit) {
            attacker.currentAp -= apCost;
            this.emitGameState(room.id);
        }

        io.to(room.id).emit('attackResult', result);
    }

    _resolveDamageRoll(room, attacker, { weaponId, targetId }) {
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!attacker || !target) return;

        const isUnarmed = weaponId === 'unarmed';
        const weapon = isUnarmed ? null : attacker.equipment.weapon;
        if (!isUnarmed && (!weapon || weapon.id !== weaponId)) return;
        
        const apCost = isUnarmed ? 1 : (weapon.apCost || 2);
        if (attacker.currentAp < apCost) return;
        attacker.currentAp -= apCost;

        const damageDice = isUnarmed ? '1d4' : weapon.effect.dice;
        let damageRoll = this.rollDice(damageDice);
        let damage = damageRoll + attacker.stats.damageBonus;

        const d20 = this.rollDice('1d20'); // Reroll for crit check, though this is not ideal. A better way would be to pass the hit result.
        if (d20 === 20) damage *= 2; 

        target.currentHp = Math.max(0, target.currentHp - damage);

        if (target.currentHp <= 0) {
            this._handleMonsterDefeat(room, target.id);
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

        this.emitGameState(room.id);
    }
    
    async _resolveFullPlayerAttack(room, attacker, { weaponId, targetId }) {
        const pause = ms => new Promise(res => setTimeout(res, ms));
        const target = room.gameState.board.monsters.find(m => m.id === targetId);
        if (!attacker || !target) return;

        const isUnarmed = weaponId === 'unarmed';
        const weapon = isUnarmed ? null : attacker.equipment.weapon;
        const apCost = isUnarmed ? 1 : (weapon.apCost || 2);
        
        // --- HIT ROLL ---
        const d20 = this.rollDice('1d20');
        const toHitBonus = isUnarmed ? attacker.stats.str : attacker.stats.damageBonus;
        const totalRoll = d20 + toHitBonus;
        const isCrit = d20 === 20;
        const isMiss = d20 === 1;
        const hit = !isMiss && (isCrit || totalRoll >= target.requiredRollToHit);

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
            if (isCrit) damage *= 2;

            target.currentHp = Math.max(0, target.currentHp - damage);
            
            io.to(room.id).emit('damageResult', {
                rollerId: attacker.id, rollerName: attacker.name, targetName: target.name,
                damage, damageRoll, damageDice, damageBonus: attacker.stats.damageBonus
            });
            
            if (target.currentHp <= 0) this._handleMonsterDefeat(room, target.id);

            await pause(1000);
        }

        attacker.currentAp -= apCost;
    }

    async _resolveFullMonsterAttack(room, monsterId, targetId) {
        const pause = ms => new Promise(res => setTimeout(res, ms));
        const monster = room.gameState.board.monsters.find(m => m.id === monsterId);
        const target = room.players[targetId];
        if (!monster || !target) return;
        
        // --- HIT ROLL ---
        const d20 = this.rollDice('1d20');
        const isCrit = d20 === 20;
        const isMiss = d20 === 1;
        const targetAC = 10 + target.stats.shieldBonus;
        const totalRoll = d20 + monster.attackBonus;
        const hit = !isMiss && (isCrit || totalRoll >= targetAC);

        io.to(room.id).emit('attackResult', {
            rollerId: monster.id, rollerName: monster.name, action: 'Attack', targetName: target.name,
            dice: '1d20', roll: d20, bonus: monster.attackBonus, total: totalRoll, targetAC,
            outcome: isCrit ? 'CRIT!' : (hit ? 'HIT' : 'MISS'),
        });
        
        await pause(1500);
        
        // --- DAMAGE ROLL (if hit) ---
        if (hit) {
            let damageRoll = this.rollDice(monster.effect.dice);
            let damage = damageRoll;
            if (isCrit) damage *= 2;
            
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
        room.gameState.board.monsters = room.gameState.board.monsters.filter(m => m.id !== monsterId);
        const lootChance = (room.gameState.customSettings.lootDropRate || 50) / 100;
        if (Math.random() < lootChance) {
            const loot = this.drawCardFromDeck(room.id, 'treasure');
            if (loot) room.gameState.lootPool.push(loot);
        }
    }

    _applyDamageToPlayer(room, player, damage) {
        const shieldedDamage = Math.min(player.stats.shieldHp, damage);
        player.stats.shieldHp -= shieldedDamage;
        damage -= shieldedDamage;
        player.stats.currentHp -= damage;

        if (player.stats.currentHp <= 0) {
            player.stats.currentHp = 0;
            player.isDowned = true;
            // If the human player is downed, the game is over.
            if (!player.isNpc) {
                room.gameState.phase = 'game_over';
                room.gameState.winner = 'Monsters';
            }
        }
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
    
    rejoinRoom(socket, { roomId, playerName }) {
        const room = this.rooms[roomId];
        if (!room) {
            socket.emit('actionError', 'Room to rejoin not found.');
            return;
        }

        const playerToReconnect = Object.values(room.players).find(p => p.name === playerName && !p.isNpc && p.disconnected);

        if (playerToReconnect) {
            const oldId = playerToReconnect.id;
            
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

            console.log(`Player ${playerName} reconnected to room ${roomId}`);
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
            // In a real-world scenario, you might add a timer here to clean up the room
            // if the player doesn't reconnect within a certain time frame.
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