// This file is the main Node.js server for the Quest & Chronicle application.
// It uses Express to serve the static frontend files (HTML, CSS, JS) from the 'public' directory
// and uses Socket.IO for real-time, event-based communication to manage the multiplayer game logic.

// Import required modules
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const gameData = require('./game-data'); // Import card and class data

// --- Server Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// --- Helper Functions ---
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// --- Game State Management ---
class GameManager {
    constructor() {
        this.rooms = {};
        this.cardIdCounter = 1000; // Start card IDs high to avoid collision with data file
    }

    findRoomBySocket(socket) {
        return Object.values(this.rooms).find(room => room.players[socket.id]);
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

    createRoom(socket, { playerName, customSettings }) {
        const newPlayer = this.createPlayerObject(socket.id, playerName);
        
        const newRoom = {
            id: this.generateRoomId(),
            hostId: socket.id,
            players: { [socket.id]: newPlayer },
            voiceChatPeers: [],
            gameState: {
                phase: 'lobby',
                gameMode: null,
                customSettings: customSettings, // Store the custom settings
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
                skillChallenge: { isActive: false },
            },
            chatLog: []
        };

        this.rooms[newRoom.id] = newRoom;
        socket.join(newRoom.id);
        socket.emit('roomCreated', newRoom);
    }
    
    joinRoom(socket, { roomId, playerName }) {
        const room = this.rooms[roomId];
        if (!room) {
            socket.emit('actionError', 'Room not found.');
            return;
        }

        // --- LATE JOIN LOGIC ---
        if (room.gameState.phase !== 'lobby') {
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
            socket.emit('joinSuccess', room);
            this.emitGameState(roomId);
            return;
        }
        
        // --- ORIGINAL LOBBY JOIN LOGIC ---
        const newPlayer = this.createPlayerObject(socket.id, playerName);
        room.players[socket.id] = newPlayer;
        socket.join(roomId);
        
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
            madeAdvancedChoice: false,
            pendingWorldEventSave: null,
            healthDice: { current: 0, max: 0 }
        };
    }

    startGame(socket, { gameMode }) {
        const room = this.findRoomBySocket(socket);
        if (!room || room.hostId !== socket.id || room.gameState.phase !== 'lobby') return;
    
        room.gameState.gameMode = gameMode;
        
        const players = Object.values(room.players).filter(p => !p.isNpc);

        if (players.length === 1) {
            // Single Player: The player is an Explorer, create an NPC DM and 3 NPC Explorers.
            const player = players[0];
            player.role = 'Explorer';

            const dmNpc = this.createPlayerObject('npc-dm', 'Dungeon Master');
            dmNpc.role = 'DM';
            dmNpc.isNpc = true;
            room.players[dmNpc.id] = dmNpc;
            
            const npcNames = ["Grok", "Lyra", "Finn"];
            const classKeys = Object.keys(gameData.classes);
            const explorerNpcs = [];

            for (const name of npcNames) {
                const npcId = `npc-${name.toLowerCase()}`;
                const npc = this.createPlayerObject(npcId, name);
                npc.isNpc = true;
                npc.role = 'Explorer';
                
                const randomClassId = classKeys[Math.floor(Math.random() * classKeys.length)];
                this.assignClassToPlayer(room.id, npc, randomClassId);
                
                this.dealCard(room.id, npc.id, 'weapon', 1);
                this.dealCard(room.id, npc.id, 'armor', 1);
                this.dealCard(room.id, npc.id, 'item', 2);
                this.dealCard(room.id, npc.id, 'spell', 2);
                
                this._npcAutoEquip(room, npc);
                
                room.players[npc.id] = npc;
                explorerNpcs.push(npc);
            }
            
            const explorerIds = [player.id, ...explorerNpcs.map(n => n.id)];
            shuffle(explorerIds);
            room.gameState.turnOrder = [dmNpc.id, ...explorerIds];

        } else {
            const dm = players[Math.floor(Math.random() * players.length)];
            dm.role = 'DM';
            players.forEach(p => {
                if (p.id !== dm.id) p.role = 'Explorer';
            });
            const explorerIds = players.filter(p => p.id !== dm.id).map(p => p.id);
            shuffle(explorerIds);
            room.gameState.turnOrder = [dm.id, ...explorerIds];
        }
        
        const createDeck = (cardArray) => cardArray.map(c => ({...c, id: this.generateUniqueCardId() }));
        room.gameState.decks.item = createDeck(gameData.itemCards);
        room.gameState.decks.spell = createDeck(gameData.spellCards);
        room.gameState.decks.weapon = createDeck(gameData.weaponCards);
        room.gameState.decks.armor = createDeck(gameData.armorCards);
        room.gameState.decks.worldEvent = createDeck(gameData.worldEventCards);
        room.gameState.decks.playerEvent = createDeck(gameData.playerEventCards);
        room.gameState.decks.partyEvent = createDeck(gameData.partyEventCards);
        
        room.gameState.decks.monster.tier1 = createDeck(gameData.monsterTiers.tier1);
        room.gameState.decks.monster.tier2 = createDeck(gameData.monsterTiers.tier2);
        room.gameState.decks.monster.tier3 = createDeck(gameData.monsterTiers.tier3);

        room.gameState.decks.treasure = [
            ...room.gameState.decks.item,
            ...room.gameState.decks.weapon,
            ...room.gameState.decks.armor
        ];
        
        Object.values(room.gameState.decks).forEach(deck => {
            if (Array.isArray(deck)) shuffle(deck);
        });
        shuffle(room.gameState.decks.monster.tier1);
        shuffle(room.gameState.decks.monster.tier2);
        shuffle(room.gameState.decks.monster.tier3);

        room.gameState.phase = 'class_selection';
        io.to(room.id).emit('gameStarted', room);
    }
    
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
        
        if (room.gameState.gameMode === 'Beginner') {
            this.dealCard(room.id, player.id, 'weapon', 1);
            this.dealCard(room.id, player.id, 'armor', 1);
            this.dealCard(room.id, player.id, 'item', 2);
            this.dealCard(room.id, player.id, 'spell', 2);
            
            const weapon = player.hand.find(c => c.type === 'Weapon');
            if (weapon) this._internalEquipItem(room, player, weapon.id);
            const armor = player.hand.find(c => c.type === 'Armor');
            if (armor) this._internalEquipItem(room, player, armor.id);
            
        } else {
            player.madeAdvancedChoice = false;
        }

        this.checkAllPlayersReady(room);
        this.emitGameState(room.id);
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

    checkAllPlayersReady(room) {
        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer' && !p.isNpc);
        const allReady = explorers.every(p => p.class);
        
        if (allReady && room.gameState.phase === 'class_selection') {
            if (room.gameState.gameMode === 'Advanced') {
                room.gameState.phase = 'advanced_setup_choice';
            } else {
                room.gameState.phase = 'started';
                this.startFirstTurn(room.id);
            }
        }
    }
    
    dealCard(roomId, playerId, deckName, count) {
        const room = this.rooms[roomId];
        const player = room?.players[playerId];
        if (!room || !player) return;
    
        const mainDeck = room.gameState.decks[deckName];
        if (!mainDeck) return;
    
        const cardsToDeal = [];
    
        const shouldFilter = player.class;
    
        if (shouldFilter) {
            let suitableCards = mainDeck.filter(card => 
                !card.class || card.class.includes("Any") || card.class.includes(player.class)
            );
    
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
                    console.log(`No more suitable ${deckName} cards for ${player.class}`);
                    break;
                }
            }
        } else {
            for (let i = 0; i < count; i++) {
                if (mainDeck.length > 0) {
                    cardsToDeal.push(mainDeck.pop());
                } else {
                    console.log(`Deck ${deckName} is empty.`);
                    break;
                }
            }
        }
    
        if (cardsToDeal.length > 0) {
            for(const card of cardsToDeal) {
                this._addCardToPlayerHand(room, player, card);
            }
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
        
        const cardToEquip = player.hand[cardIndex];

        if (cardToEquip.class && !cardToEquip.class.includes("Any") && !cardToEquip.class.includes(player.class)) {
            if (!player.isNpc) {
                 const socket = io.sockets.sockets.get(player.id);
                 if (socket) socket.emit('actionError', `Your class cannot equip ${cardToEquip.name}.`);
            }
            return false;
        }

        const itemType = cardToEquip.type.toLowerCase();
    
        if (player.equipment[itemType]) {
            this._addCardToPlayerHand(room, player, player.equipment[itemType]);
        }
        
        player.equipment[itemType] = cardToEquip;
        player.hand.splice(cardIndex, 1);
        
        player.stats = this.calculatePlayerStats(player);
        return true;
    }

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

    equipItem(socket, { cardId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
    
        const success = this._internalEquipItem(room, player, cardId);
        
        if (!success && player) {
            return;
        }
        
        this.emitGameState(room.id);
    }
    
    startFirstTurn(roomId) {
        const room = this.rooms[roomId];
        room.gameState.currentPlayerIndex = 0;
        room.gameState.turnCount = 1;
        this.startTurn(roomId);
    }

    determine_ai_action(player, gameState, allPlayers) {
        const { board, skillChallenge } = gameState;
        const { currentAp, stats, hand, healthDice, equipment, class: playerClass } = player;
        const partyMembers = Object.values(allPlayers).filter(p => p.role === 'Explorer');
        
        // --- PRIORITY 1: HEALING ---
        let bestHealTarget = { utility: -1, target: null, card: null };
        hand.forEach(card => {
            const cardApCost = card.apCost || 1;
            if (currentAp >= cardApCost && card.effect && card.effect.type === 'heal') {
                partyMembers.forEach(ally => {
                    // Heal allies below 50% health
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

        // --- PRIORITY 2: COMBAT (ATTACKING) ---
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
        
        // --- PRIORITY 3: USE CLASS ABILITY ---
        const classAbility = gameData.classes[playerClass]?.ability;
        if (classAbility && currentAp >= classAbility.apCost) {
            if (playerClass === 'Mage') return { action: 'useClassAbility', apCost: classAbility.apCost }; // Always good to draw a spell
            if (playerClass === 'Cleric' && board.monsters.length > 0) return { action: 'useClassAbility', apCost: classAbility.apCost }; // Buff next attack
        }
        
        // --- PRIORITY 4: USE UTILITY/DAMAGE CARDS ---
        if (board.monsters.length > 0) {
            for (const card of hand) {
                const cardApCost = card.apCost || 1;
                if (currentAp >= cardApCost && card.effect && (card.effect.type === 'utility' || card.effect.type === 'damage')) {
                    const target = board.monsters[0]; // Simple logic: use first available utility card on first monster
                    return { action: 'useCard', cardId: card.id, targetId: target.id, apCost: cardApCost };
                }
            }
        }
        
        // --- PRIORITY 5: CONTRIBUTE TO CHALLENGE ---
        if (skillChallenge.isActive && currentAp >= 1) {
            const challengeData = gameData.skillChallenges.find(c => c.id === skillChallenge.challengeId);
            const myStat = stats[challengeData.skill] || 0;
            // Only contribute if they have a non-negative stat for it
            if (myStat >= 0) {
                return { action: 'contributeToSkillChallenge', apCost: 1 };
            }
        }

        // --- PRIORITY 6: DEFENSIVE/RECOVERY ---
        const guardApCost = gameData.actionCosts.guard;
        if (currentAp >= guardApCost && stats.currentHp < stats.maxHp * 0.75) {
            return { action: 'guard', apCost: guardApCost };
        }
        
        // Only rest if there are no monsters
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

        // --- LAST RESORT: WAIT ---
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

                currentPlayerState.currentAp -= bestAction.apCost;
                
                const narrative = gameData.npcDialogue.explorer.attack[Math.floor(Math.random() * gameData.npcDialogue.explorer.attack.length)];

                switch (bestAction.action) {
                    case 'useClassAbility':
                        this._resolveUseClassAbility(room, currentPlayerState, null);
                        break;
                    case 'attack':
                    case 'unarmedAttack': {
                        if (room.gameState.board.monsters.length === 0) {
                            this.sendMessageToRoom(room.id, {
                                channel: 'game', type: 'system',
                                message: `<b>${player.name}</b> prepares to strike, but there are no enemies.`
                            });
                            currentPlayerState.currentAp += bestAction.apCost; // Refund AP
                            break;
                        }

                        if (bestAction.action === 'attack') {
                             this.sendMessageToRoom(room.id, {
                                channel: 'game',
                                type: 'system',
                                message: `<b>${player.name}</b> used ${bestAction.apCost} AP to Attack.`
                            });
                            const d20Roll = Math.floor(Math.random() * 20) + 1;
                            this._resolveAttack(room, {
                                attackerId: player.id,
                                targetId: bestAction.targetId,
                                weaponId: bestAction.weaponId,
                                narrative: narrative
                            }, d20Roll);
                        } else { // Unarmed Attack
                            this.sendMessageToRoom(room.id, {
                                channel: 'game',
                                type: 'system',
                                message: `<b>${player.name}</b> used ${bestAction.apCost} AP for an Unarmed Strike.`
                            });
                            const unarmedD20Roll = Math.floor(Math.random() * 20) + 1;
                            this._resolveUnarmedAttack(room, {
                                attackerId: player.id,
                                targetId: bestAction.targetId,
                                narrative: `${player.name} lashes out with their bare fists!`
                            }, unarmedD20Roll);
                        }
                        break;
                    }
                    case 'guard':
                        const guardBonus = currentPlayerState.equipment.armor?.guardBonus || 2;
                        currentPlayerState.stats.shieldHp += guardBonus;
                        this.sendMessageToRoom(room.id, { 
                            channel: 'game', 
                            type: 'system', 
                            message: `<b>${player.name}</b> used ${bestAction.apCost} AP to Guard, gaining ${guardBonus} Shield HP.` 
                        });
                        break;
                    case 'briefRespite': {
                        currentPlayerState.healthDice.current -= 1;
                        const healAmount = this.rollDice('1d8');
                        currentPlayerState.stats.currentHp = Math.min(currentPlayerState.stats.maxHp, currentPlayerState.stats.currentHp + healAmount);
                        const message = `<b>${player.name}</b> used ${bestAction.apCost} AP for a Brief Respite, healing for ${healAmount} HP.`;
                        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message });
                        io.to(room.id).emit('simpleRollAnimation', {
                            dieType: 'd8', roll: healAmount, title: `${player.name}'s Respite`,
                            resultHTML: `<p class="result-line hit">+${healAmount} HP</p>`
                        });
                        break;
                    }
                    case 'fullRest': {
                        currentPlayerState.healthDice.current -= 2;
                        const totalHeal = this.rollDice('2d8');
                        currentPlayerState.stats.currentHp = Math.min(currentPlayerState.stats.maxHp, currentPlayerState.stats.currentHp + totalHeal);
                        const message = `<b>${player.name}</b> used ${bestAction.apCost} AP for a Full Rest, healing for ${totalHeal} HP.`;
                        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message });
                        io.to(room.id).emit('simpleRollAnimation', {
                            dieType: 'd8', roll: totalHeal, title: `${player.name}'s Rest`,
                            resultHTML: `<p class="result-line hit">+${totalHeal} HP</p>`
                        });
                        break;
                    }
                    case 'useCard': {
                        const cardIndex = currentPlayerState.hand.findIndex(c => c.id === bestAction.cardId);
                        if (cardIndex > -1) {
                            const card = currentPlayerState.hand[cardIndex];
                            const effect = card.effect;
                            
                            if ((effect.type === 'utility' || effect.type === 'damage') && room.gameState.board.monsters.length === 0) {
                                this.sendMessageToRoom(room.id, {
                                    channel: 'game', type: 'system',
                                    message: `<b>${player.name}</b> tries to use ${card.name}, but has no valid targets.`
                                });
                                currentPlayerState.currentAp += bestAction.apCost; // Refund AP
                                break;
                            }

                            currentPlayerState.hand.splice(cardIndex, 1);
                            let message = `<b>${player.name}</b> used ${bestAction.apCost} AP to use ${card.name}`;

                            if (effect.type === 'heal') {
                                const healTarget = room.players[bestAction.targetId];
                                if (healTarget) {
                                    const healAmountCard = this.rollDice(effect.dice);
                                    healTarget.stats.currentHp = Math.min(healTarget.stats.maxHp, healTarget.stats.currentHp + healAmountCard);
                                    message += ` on ${healTarget.name}, healing for ${healAmountCard} HP.`;
                                    
                                    const dieType = `d${effect.dice.split('d')[1]}`;
                                    io.to(room.id).emit('simpleRollAnimation', {
                                        dieType: dieType, roll: healAmountCard, title: `${card.name}`,
                                        resultHTML: `<p class="result-line hit">+${healAmountCard} HP to ${healTarget.name}</p>`
                                    });
                                }
                            } else if (effect.type === 'utility' || effect.type === 'damage') {
                                const monsterTarget = room.gameState.board.monsters.find(m => m.id === bestAction.targetId);
                                if (monsterTarget) {
                                     message += `, targeting the ${monsterTarget.name}.`;
                                     // Here you would resolve the damage/utility effect similar to an attack
                                }
                            }
                            
                            this.sendMessageToRoom(room.id, {
                                channel: 'game',
                                type: 'system',
                                message: message
                            });
                        }
                        break;
                    }
                    case 'contributeToSkillChallenge': {
                        this._resolveNpcSkillChallenge(room, currentPlayerState);
                        break;
                    }
                }
                
                currentPlayerState.stats = this.calculatePlayerStats(currentPlayerState);
                this.emitGameState(room.id);
                await new Promise(res => setTimeout(res, 2000));
            }

            this.sendMessageToRoom(room.id, { 
                channel: 'game', 
                type: 'system', 
                message: `<b>${player.name}</b> finishes their turn.` 
            });

        } catch (error) {
            console.error(`Error during NPC turn for ${player.name}:`, error);
        } finally {
            room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
            if (room.gameState.currentPlayerIndex === 0) {
                room.gameState.turnCount++;
            }
            this.startTurn(room.id);
        }
    }

    _resolveNpcSkillChallenge(room, player) {
        const challenge = room.gameState.skillChallenge;
        if (!challenge || !challenge.isActive) return;

        const d20Roll = Math.floor(Math.random() * 20) + 1;
        const playerStat = player.class ? (gameData.classes[player.class].stats[challenge.skill] || 0) : 0;
        const totalRoll = d20Roll + playerStat;

        const success = totalRoll >= challenge.dc;
        let logText = `<b>${player.name}</b> attempts to help... They roll a ${d20Roll} + ${playerStat}(stat) = <b>${totalRoll}</b> vs DC ${challenge.dc}. `;
        
        let resultHTML;
        if (success) {
            challenge.successes++;
            logText += "<span style='color: var(--color-success)'>Success!</span>";
            resultHTML = `<p class="result-line hit">SUCCESS!</p>`;
        } else {
            challenge.failures++;
            logText += "<span style='color: var(--color-danger)'>Failure!</span>";
            resultHTML = `<p class="result-line miss">FAILURE!</p>`;
        }
        resultHTML += `<p class="roll-details">Roll: ${d20Roll} + ${playerStat}(stat) = <strong>${totalRoll}</strong> vs DC ${challenge.dc}</p>`;

        challenge.log.push(logText);
        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: logText });
        
        io.to(room.id).emit('simpleRollAnimation', {
            dieType: 'd20', roll: d20Roll, title: `${player.name}'s Challenge`,
            resultHTML: resultHTML
        });

        this._checkSkillChallengeCompletion(room, player);
    }

    async handleMonsterTurns(room) {
        if (!room.gameState.board.monsters || room.gameState.board.monsters.length === 0) {
            return;
        }

        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer' && p.stats.currentHp > 0);
        if (explorers.length === 0) return; // No valid targets

        this.sendMessageToRoom(room.id, {
            channel: 'game', type: 'system',
            message: `The monsters lash out!`,
        });

        for (const monster of room.gameState.board.monsters) {
            await new Promise(res => setTimeout(res, 1500)); // Delay between monster attacks

            if (monster.statusEffects && monster.statusEffects.some(e => e.name === 'Stunned')) {
                this.sendMessageToRoom(room.id, {
                    channel: 'game', type: 'system',
                    message: `The ${monster.name} is stunned and cannot act!`,
                });
                continue;
            }

            explorers.sort((a, b) => a.stats.currentHp - b.stats.currentHp);
            const target = explorers[0];
            if (!target) continue;
            
            this._resolveMonsterAttack(room, monster, target);
        }
    }

    _resolveMonsterAttack(room, monster, target) {
        const requiredRollToHit = 10 + target.stats.shieldBonus;
        const d20Roll = Math.floor(Math.random() * 20) + 1;

        const isCrit = d20Roll === 20;
        const isFumble = d20Roll === 1;

        const totalRollToHit = d20Roll + monster.attackBonus;
        const hit = isCrit || (!isFumble && totalRollToHit >= requiredRollToHit);
        
        let totalDamage = 0;
        let rawDamageRoll = 0;

        if (hit) {
            rawDamageRoll = this.rollDice(monster.effect.dice);
            if (isCrit) {
                rawDamageRoll += this.rollDice(monster.effect.dice); 
            }
            totalDamage = rawDamageRoll; 
            
            let damageToShield = 0;
            if (target.stats.shieldHp > 0) {
                damageToShield = Math.min(totalDamage, target.stats.shieldHp);
                target.stats.shieldHp -= damageToShield;
                totalDamage -= damageToShield;
            }
            
            if (totalDamage > 0) {
                 target.stats.currentHp -= totalDamage;
            }
            totalDamage += damageToShield; 
        }
        
        let logMessageText = `The <b>${monster.name}</b> attacks ${target.name}! Roll: ${d20Roll} + ${monster.attackBonus} = <b>${totalRollToHit}</b> vs DC ${requiredRollToHit}. `;
        if (isCrit) logMessageText = `<b>CRITICAL HIT!</b> ` + logMessageText;
        else if (isFumble) logMessageText = `<b>FUMBLE!</b> ` + logMessageText;
        
        if (hit) {
            logMessageText += `<span style='color: var(--color-success)'>HIT!</span> Dealing <b>${totalDamage}</b> damage.`;
        } else {
            logMessageText += `<span style='color: var(--color-danger)'>MISS!</span>`;
        }
        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: logMessageText });

        io.to(room.id).emit('monsterAttackAnimation', {
            attackerId: monster.id,
            targetId: target.id,
            d20Roll,
            isCrit,
            isFumble,
            totalRollToHit,
            requiredRoll: requiredRollToHit,
            hit,
            damageDice: monster.effect.dice,
            rawDamageRoll,
            attackBonus: monster.attackBonus,
            totalDamage,
        });

        if (target.stats.currentHp <= 0) {
            target.lifeCount -= 1;
            this.sendMessageToRoom(room.id, {
                channel: 'game', type: 'system',
                message: `<b>${target.name}</b> has fallen in battle!`,
            });
            if(target.lifeCount > 0) {
                target.stats.currentHp = Math.floor(target.stats.maxHp / 2);
                 this.sendMessageToRoom(room.id, {
                    channel: 'game', type: 'system',
                    message: `${target.name} gets back up, but looks weakened. (${target.lifeCount} lives remaining)`,
                });
            } else {
                 this.sendMessageToRoom(room.id, {
                    channel: 'game', type: 'system',
                    message: `${target.name} has been defeated permanently!`,
                });
            }
        }
        
        this.emitGameState(room.id);
    }

    scaleMonsterStats(monster, room) {
        const { customSettings, turnCount } = room.gameState;
        const scaledMonster = JSON.parse(JSON.stringify(monster)); 

        const scalingFactor = customSettings.scalingRate / 50; // Normalize slider from 0-100 to 0-2
        const hpBonus = Math.floor(turnCount / 4) * 5 * scalingFactor;
        const attackBonus = Math.floor(turnCount / 5) * scalingFactor;
        const defenseBonus = Math.floor(turnCount / 6) * scalingFactor;

        scaledMonster.maxHp = Math.round(scaledMonster.maxHp + hpBonus);
        scaledMonster.currentHp = scaledMonster.maxHp;
        scaledMonster.attackBonus = Math.round(scaledMonster.attackBonus + attackBonus);
        scaledMonster.requiredRollToHit = Math.round(scaledMonster.requiredRollToHit + defenseBonus);
        
        if (hpBonus > 0 || attackBonus > 0 || defenseBonus > 0) {
            scaledMonster.name = `Empowered ${scaledMonster.name}`;
        }

        return scaledMonster;
    }

    playMonster(room) {
        const { turnCount } = room.gameState;
        
        let tier;
        if (turnCount < 10) tier = 'tier1';
        else if (turnCount < 20) tier = 'tier2';
        else tier = 'tier3';

        let monsterDeck = room.gameState.decks.monster[tier];
        if (!monsterDeck || monsterDeck.length === 0) {
            if (tier === 'tier3' && room.gameState.decks.monster.tier2.length > 0) monsterDeck = room.gameState.decks.monster.tier2;
            else if (room.gameState.decks.monster.tier1.length > 0) monsterDeck = room.gameState.decks.monster.tier1;
            else return;
        }

        let monsterCard = monsterDeck.pop();
        if (!monsterCard) return;

        if (room.gameState.customSettings.enemyScaling) {
            monsterCard = this.scaleMonsterStats(monsterCard, room);
        }

        monsterCard.currentHp = monsterCard.maxHp;
        room.gameState.board.monsters.push(monsterCard);
        this.sendMessageToRoom(room.id, {
            channel: 'game', senderName: 'Dungeon Master',
            message: gameData.npcDialogue.dm.playMonster[Math.floor(Math.random() * gameData.npcDialogue.dm.playMonster.length)],
            isNarrative: true
        });
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
            if (room.gameState.board.monsters && room.gameState.board.monsters.length > 0) {
                room.gameState.board.monsters.forEach(monster => {
                    if (monster.statusEffects && monster.statusEffects.length > 0) {
                        monster.statusEffects.forEach(effect => {
                            if (effect.duration) effect.duration--;
                        });
                        const expiredEffects = monster.statusEffects.filter(effect => effect.duration <= 0);
                        if (expiredEffects.length > 0) {
                            expiredEffects.forEach(effect => {
                                 this.sendMessageToRoom(roomId, { 
                                    channel: 'game', 
                                    type: 'system', 
                                    message: `The effect of '${effect.name}' has worn off for the ${monster.name}.` 
                                });
                            });
                            monster.statusEffects = monster.statusEffects.filter(effect => effect.duration > 0);
                        }
                    }
                });
            }
            
            await this.handleMonsterTurns(room);
            await new Promise(res => setTimeout(res, 1500));

            if (room.gameState.board.monsters.length === 0 && !room.gameState.skillChallenge.isActive) {
                const roll = Math.random();
                if (roll < 0.25 && room.gameState.decks.worldEvent.length > 0) {
                    const worldEventCard = room.gameState.decks.worldEvent.pop();
                    if (worldEventCard) {
                        room.gameState.worldEvents.currentEvent = worldEventCard;
                        this.sendMessageToRoom(room.id, {
                            channel: 'game', senderName: 'Dungeon Master',
                            message: gameData.npcDialogue.dm.worldEvent[Math.floor(Math.random() * gameData.npcDialogue.dm.worldEvent.length)],
                            isNarrative: true
                        });
                        Object.values(room.players).filter(p => p.role === 'Explorer' && !p.isNpc).forEach(p => {
                            p.pendingWorldEventSave = { ...worldEventCard.saveInfo, eventName: worldEventCard.name };
                        });
                    }
                } else if (roll >= 0.25 && roll < 0.5 && gameData.skillChallenges.length > 0) {
                     const challenge = gameData.skillChallenges[Math.floor(Math.random() * gameData.skillChallenges.length)];
                    room.gameState.skillChallenge = {
                        isActive: true, challengeId: challenge.id, name: challenge.name,
                        description: challenge.description, skill: challenge.skill, dc: challenge.dc,
                        successes: 0, failures: 0, successThreshold: challenge.successThreshold,
                        failureThreshold: challenge.failureThreshold, log: [],
                    };
                    this.sendMessageToRoom(room.id, {
                        channel: 'game', type: 'system',
                        message: `A new challenge begins: <b>${challenge.name}</b>! Explorers can contribute on their turn.`
                    });
                } else {
                    this.playMonster(room);
                }
            }
            
            const escalationChance = room.gameState.customSettings.dungeonPressure / 100;
            if (Math.random() < escalationChance) {
                this.sendMessageToRoom(room.id, {
                    channel: 'game', type: 'system',
                    message: 'The dungeon grows restless... another threat appears!'
                });
                 await new Promise(res => setTimeout(res, 1000));
                
                if (Math.random() < 0.75) {
                    this.playMonster(room);
                } else if (room.gameState.decks.worldEvent.length > 0) {
                    const worldEventCard = room.gameState.decks.worldEvent.pop();
                    if (worldEventCard) {
                        room.gameState.worldEvents.currentEvent = worldEventCard;
                        this.sendMessageToRoom(room.id, {
                            channel: 'game', senderName: 'Dungeon Master',
                            message: gameData.npcDialogue.dm.worldEvent[Math.floor(Math.random() * gameData.npcDialogue.dm.worldEvent.length)],
                            isNarrative: true
                        });
                        Object.values(room.players).filter(p => p.role === 'Explorer' && !p.isNpc).forEach(p => {
                            p.pendingWorldEventSave = { ...worldEventCard.saveInfo, eventName: worldEventCard.name };
                        });
                    }
                }
            }

            this.emitGameState(roomId);
            
            setTimeout(() => {
                room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
                this.startTurn(roomId);
            }, 1500);
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
    
    endTurn(socket) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== player.id) {
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

    handleAttack(socket, data) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player) return;
        
        const target = room.gameState.board.monsters.find(m => m.id === data.targetId);
        const weapon = player.equipment.weapon;

        if (!target || !weapon || weapon.id !== data.cardId) {
            return socket.emit('actionError', 'Invalid attack parameters.');
        }
        
        const apCost = weapon.apCost || 2; 
        if (player.currentAp < apCost) {
            return socket.emit('actionError', 'Not enough Action Points.');
        }
        player.currentAp -= apCost;

        const d20Roll = Math.floor(Math.random() * 20) + 1;
        this._resolveAttack(room, {
            attackerId: player.id,
            targetId: target.id,
            weaponId: weapon.id,
            narrative: data.narrative
        }, d20Roll);
    }

    _resolveUnarmedAttack(room, attackData, d20Roll) {
        const player = room.players[attackData.attackerId];
        const target = room.gameState.board.monsters.find(m => m.id === attackData.targetId);
        if (!player || !target) {
             console.error("Could not resolve unarmed attack, missing data.");
             this.emitGameState(room.id);
             return;
        }

        this.sendMessageToRoom(room.id, {
            channel: 'game', senderName: player.name,
            message: attackData.narrative, isNarrative: true
        });

        const isCrit = d20Roll === 20;
        const isFumble = d20Roll === 1;
        const totalRollToHit = d20Roll + player.stats.damageBonus;
        const hit = isCrit || (!isFumble && totalRollToHit >= target.requiredRollToHit);

        let totalDamage = 0;
        if (hit) {
            // Damage formula: Ceiling(STR/2)
            totalDamage = Math.ceil(player.stats.str / 2);
            if (isCrit) totalDamage *= 2;
            target.currentHp -= totalDamage;
        }

        let logMessageText = `<b>${player.name}</b> strikes ${target.name}! Roll: ${d20Roll} + ${player.stats.damageBonus} = <b>${totalRollToHit}</b> vs DC ${target.requiredRollToHit}. `;
        if (isCrit) logMessageText = `<b>CRITICAL HIT!</b> ` + logMessageText;
        else if (isFumble) logMessageText = `<b>FUMBLE!</b> ` + logMessageText;

        if (hit) {
            logMessageText += `<span style='color: var(--color-success)'>HIT!</span> Dealing <b>${totalDamage}</b> damage.`;
        } else {
            logMessageText += `<span style='color: var(--color-danger)'>MISS!</span>`;
        }
        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: logMessageText });

        io.to(room.id).emit('attackAnimation', {
            attackerId: player.id,
            targetId: target.id,
            d20Roll, isCrit, isFumble, totalRollToHit,
            requiredRoll: target.requiredRollToHit,
            hit,
            damageDice: 'unarmed',
            rawDamageRoll: totalDamage,
            damageBonus: 0,
            totalDamage,
        });

        if (target.currentHp <= 0) {
            this._handleMonsterDefeated(room, player, target);
        }

        this.emitGameState(room.id);
    }

    _resolveAttack(room, attackData, d20Roll) {
        const player = room.players[attackData.attackerId];
        const target = room.gameState.board.monsters.find(m => m.id === attackData.targetId);
        const weapon = player.equipment.weapon;
    
        if (!player || !target || !weapon) {
             console.error("Could not resolve attack, missing data.");
             this.emitGameState(room.id);
             return;
        }
        
        this.sendMessageToRoom(room.id, {
            channel: 'game', senderName: player.name,
            message: attackData.narrative, isNarrative: true
        });
    
        const isCrit = d20Roll === 20;
        const isFumble = d20Roll === 1;
        
        // Handle Divine Aid
        let divineAidBonus = 0;
        const divineAidIndex = player.statusEffects.findIndex(e => e.name === 'Divine Aid');
        if (divineAidIndex > -1) {
            divineAidBonus = this.rollDice('1d4');
            player.statusEffects.splice(divineAidIndex, 1);
        }
    
        const totalRollToHit = d20Roll + player.stats.damageBonus + divineAidBonus;
        const hit = isCrit || (!isFumble && totalRollToHit >= target.requiredRollToHit);
        
        let totalDamage = 0;
        let rawDamageRoll = 0;
    
        if (hit) {
            rawDamageRoll = this.rollDice(weapon.effect.dice);
            if (isCrit) {
                rawDamageRoll += this.rollDice(weapon.effect.dice); 
                if (weapon.effect.critBonusDice) {
                    rawDamageRoll += this.rollDice(weapon.effect.critBonusDice);
                }
            }
            totalDamage = rawDamageRoll + player.stats.damageBonus;

            // Handle ability-based damage bonuses
            const assaultIndex = player.statusEffects.findIndex(e => e.name === 'Unchecked Assault');
            if (assaultIndex > -1) {
                totalDamage += 6;
                player.statusEffects.splice(assaultIndex, 1);
            }
            const surgeIndex = player.statusEffects.findIndex(e => e.name === 'Weapon Surge');
            if (surgeIndex > -1) {
                totalDamage += 4;
                player.statusEffects.splice(surgeIndex, 1);
            }

            target.currentHp -= totalDamage;
        }
        
        let logMessageText = `<b>${player.name}</b> attacks ${target.name}! Roll: ${d20Roll} ${divineAidBonus > 0 ? `+ ${divineAidBonus}(DA)` : ''} + ${player.stats.damageBonus} = <b>${totalRollToHit}</b> vs DC ${target.requiredRollToHit}. `;
        if (isCrit) logMessageText = `<b>CRITICAL HIT!</b> ` + logMessageText;
        else if (isFumble) logMessageText = `<b>FUMBLE!</b> ` + logMessageText;
        
        if (hit) {
            logMessageText += `<span style='color: var(--color-success)'>HIT!</span> Dealing <b>${totalDamage}</b> damage.`;
        } else {
            logMessageText += `<span style='color: var(--color-danger)'>MISS!</span>`;
        }
        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: logMessageText });
    
        io.to(room.id).emit('attackAnimation', {
            attackerId: player.id,
            targetId: target.id,
            d20Roll,
            isCrit,
            isFumble,
            totalRollToHit,
            requiredRoll: target.requiredRollToHit,
            hit,
            damageDice: weapon.effect.dice,
            rawDamageRoll,
            damageBonus: player.stats.damageBonus,
            totalDamage,
        });
    
        if (target.currentHp <= 0) {
            this._handleMonsterDefeated(room, player, target);
        }
    
        this.emitGameState(room.id);
    }
    
    _handleMonsterDefeated(room, player, target) {
        room.gameState.board.monsters = room.gameState.board.monsters.filter(m => m.id !== target.id);
        const dialogue = gameData.npcDialogue.dm.monsterDefeated;
        this.sendMessageToRoom(room.id, {
            channel: 'game', type: 'system',
            message: `${player.name} defeated the ${target.name}!`,
        });
        this.sendMessageToRoom(room.id, {
            channel: 'game', senderName: 'Dungeon Master',
            message: dialogue[Math.floor(Math.random() * dialogue.length)], isNarrative: true
        });

        const { customSettings } = room.gameState;
        const lootChance = customSettings.lootDropRate / 100;

        if (Math.random() < lootChance) {
            const suitableTreasure = room.gameState.decks.treasure.filter(card =>
                !card.class || card.class.includes("Any") || card.class.includes(player.class)
            );

            if (suitableTreasure.length > 0) {
                const cardIndex = Math.floor(Math.random() * suitableTreasure.length);
                let card = suitableTreasure[cardIndex];

                const mainDeckIndex = room.gameState.decks.treasure.findIndex(c => c.id === card.id);
                if (mainDeckIndex > -1) {
                    room.gameState.decks.treasure.splice(mainDeckIndex, 1);
                }

                if (card.type === 'Weapon' || card.type === 'Armor') {
                    card = this.generateMagicalEquipment(card, room);
                }

                this._addCardToPlayerHand(room, player, card);
                this.sendMessageToRoom(room.id, {
                    channel: 'game', type: 'system',
                    message: `The ${target.name} dropped a <b>${card.name}</b>!`
                });
            }
        }
    }

    generateMagicalEquipment(card, room) {
        const { customSettings, turnCount } = room.gameState;
        const newCard = JSON.parse(JSON.stringify(card)); // Deep copy
        
        const magicChance = Math.min(customSettings.magicalItemChance / 100, 1.0);
        if (Math.random() > magicChance) return newCard;
        
        let availablePrefixes = gameData.magicalAffixes.prefixes.filter(p => p.types.includes(newCard.type.toLowerCase()));
        let availableSuffixes = gameData.magicalAffixes.suffixes.filter(s => s.types.includes(newCard.type.toLowerCase()));
    
        const powerLevel = Math.floor(turnCount / 10) + 1;
        if (powerLevel < 2) { 
            availablePrefixes = availablePrefixes.filter(p => p.tier === 1);
            availableSuffixes = availableSuffixes.filter(s => s.tier === 1);
        } else if (powerLevel < 4) { 
            availablePrefixes = availablePrefixes.filter(p => p.tier <= 2);
            availableSuffixes = availableSuffixes.filter(s => s.tier <= 2);
        }
        
        if (availablePrefixes.length === 0 && availableSuffixes.length === 0) return newCard;
        
        const hasPrefix = Math.random() < 0.7 && availablePrefixes.length > 0;
        const hasSuffix = Math.random() < 0.7 && availableSuffixes.length > 0;
        
        if (!hasPrefix && !hasSuffix) return newCard;
        
        let newName = newCard.name;
        if (!newCard.effect.bonuses) newCard.effect.bonuses = {};
        
        if (hasPrefix) {
            const prefix = availablePrefixes[Math.floor(Math.random() * availablePrefixes.length)];
            newName = `${prefix.name} ${newName}`;
            for (const [key, value] of Object.entries(prefix.bonuses)) {
                newCard.effect.bonuses[key] = (newCard.effect.bonuses[key] || 0) + value;
            }
        }
        
        if (hasSuffix) {
            const suffix = availableSuffixes[Math.floor(Math.random() * availableSuffixes.length)];
            newName = `${newName} ${suffix.name}`;
            for (const [key, value] of Object.entries(suffix.bonuses)) {
                newCard.effect.bonuses[key] = (newCard.effect.bonuses[key] || 0) + value;
            }
        }
    
        newCard.name = newName;
        newCard.isMagical = true;
        
        return newCard;
    }

    rollForEvent(socket) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || !player.pendingEventRoll) return;

        player.pendingEventRoll = false;
        const roll = Math.floor(Math.random() * 20) + 1;
        let outcome = { type: 'none', card: null, options: [] };

        if (roll > 10) {
            const eventTypeRoll = Math.random();
            const suitableTreasure = room.gameState.decks.treasure.filter(card => 
                !card.class || card.class.includes("Any") || card.class.includes(player.class)
            );

            if (eventTypeRoll < 0.20 && suitableTreasure.length > 0) { 
                outcome.type = 'equipmentDraw';
                
                const cardIndex = Math.floor(Math.random() * suitableTreasure.length);
                let card = suitableTreasure[cardIndex];
                const mainDeckIndex = room.gameState.decks.treasure.findIndex(c => c.id === card.id);
                if (mainDeckIndex > -1) room.gameState.decks.treasure.splice(mainDeckIndex, 1);
                
                if (card.type === 'Weapon' || card.type === 'Armor') {
                    card = this.generateMagicalEquipment(card, room);
                }

                outcome.card = card;
                const cardType = card.type.toLowerCase();
                this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${player.name} found a ${card.name}!` });

                if ((cardType === 'weapon' || cardType === 'armor') && player.equipment[cardType]) {
                    player.pendingEquipmentChoice = { newCard: card, type: cardType };
                } else if (cardType === 'weapon' || cardType === 'armor') {
                    player.equipment[cardType] = card;
                    player.stats = this.calculatePlayerStats(player);
                    this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `It has been automatically equipped.` });
                } else {
                    this._addCardToPlayerHand(room, player, card);
                }
            } else if (eventTypeRoll < 0.60 && room.gameState.decks.playerEvent.length >= 2) { 
                outcome.type = 'playerEvent';
                const deck = room.gameState.decks.playerEvent;
                outcome.options = [deck.pop(), deck.pop()];
                player.pendingEventChoice = { outcome: 'playerEvent', options: outcome.options };
            } else if (room.gameState.decks.partyEvent.length > 0) { 
                outcome.type = 'partyEvent';
                const eventCard = room.gameState.decks.partyEvent.pop();
                outcome.card = eventCard;
                this.resolvePartyEvent(room, eventCard);
                room.gameState.decks.partyEvent.unshift(eventCard); 
            }
        }
        
        let logMessage = `<b>${player.name}</b> rolled a <b>${roll}</b> for their turn event. `;
        if(outcome.type === 'none') logMessage += "Nothing happened."
        else logMessage += `A ${outcome.type} occurred!`;
        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: logMessage });

        socket.emit('eventRollResult', { roll, outcome });
        
        if (outcome.type === 'equipmentDraw' && outcome.card) {
            const playerSocket = io.sockets.sockets.get(player.id);
            if (playerSocket) playerSocket.emit('eventItemFound', outcome.card);
        }

        this.emitGameState(room.id);
    }
    
    resolvePartyEvent(room, card) {
        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `A party event occurs: <b>${card.name}</b>! ${card.outcome}`});
        const effect = card.effect;
        if (!effect) return;

        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer');
        
        switch(effect.type) {
            case 'heal':
                explorers.forEach(p => {
                    const healAmount = this.rollDice(effect.dice);
                    p.stats.currentHp = Math.min(p.stats.maxHp, p.stats.currentHp + healAmount);
                });
                 this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `The whole party feels revitalized.`});
                break;
            case 'stat_change':
                explorers.forEach(p => {
                    if (effect.stat === 'currentAp') {
                        p.currentAp = Math.max(0, p.currentAp + effect.value);
                    }
                });
                 this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `The party feels a shift in momentum.`});
                break;
        }
    }
    
    resolveEquipmentChoice(socket, { choice, newCardId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || !player.pendingEquipmentChoice || player.pendingEquipmentChoice.newCard.id !== newCardId) {
            return socket.emit('actionError', 'Invalid equipment choice.');
        }

        const { newCard, type } = player.pendingEquipmentChoice;
        const currentItem = player.equipment[type];

        if (choice === 'swap') {
            this._addCardToPlayerHand(room, player, currentItem);
            player.equipment[type] = newCard;
            player.stats = this.calculatePlayerStats(player);
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${player.name} equipped the new ${newCard.name} and moved ${currentItem.name} to their hand.` });
        } else { // 'keep'
            this._addCardToPlayerHand(room, player, newCard); 
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${player.name} kept their ${currentItem.name} and stored the ${newCard.name}.` });
        }

        player.pendingEquipmentChoice = null;
        this.emitGameState(room.id);
    }


    selectEventCard(socket, { cardId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || !player.pendingEventChoice) return;

        const choice = player.pendingEventChoice;
        const selectedCard = choice.options.find(c => c.id === cardId);
        if (!selectedCard) return;

        if (choice.outcome === 'playerEvent') {
            if (selectedCard.effect) {
                const effectCopy = JSON.parse(JSON.stringify(selectedCard.effect));
                player.statusEffects.push(effectCopy);
            }
            this.sendMessageToRoom(room.id, {
                channel: 'game', type: 'system',
                message: `${player.name} experienced the event: '${selectedCard.name}'`
            });
        }
        
        const otherCard = choice.options.find(c => c.id !== cardId);
        if (otherCard) room.gameState.decks.playerEvent.unshift(otherCard);

        player.pendingEventChoice = null;
        this.emitGameState(room.id);
    }

    rollForWorldEventSave(socket) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || !player.pendingWorldEventSave) return;
    
        const { dc, save, eventName } = player.pendingWorldEventSave;
        const d20Roll = Math.floor(Math.random() * 20) + 1;
        const bonus = player.class ? (gameData.classes[player.class].stats[save.toLowerCase()] || 0) : 0;
        const totalRoll = d20Roll + bonus;
        const success = totalRoll >= dc;
    
        let logMessage = `<b>${player.name}</b> makes a ${save} save for ${eventName}. Roll: ${d20Roll} + ${bonus} = <b>${totalRoll}</b> vs DC ${dc}. `;

        if (success) {
            logMessage += `<span style='color: var(--color-success)'>Success!</span>`;
        } else {
            logMessage += `<span style='color: var(--color-danger)'>Failure!</span>`;
            if (eventName === 'Echoes of the Past') {
                player.statusEffects.push({ name: 'Stunned', type: 'stun', duration: 2 });
                logMessage += ` ${player.name} is stunned!`;
            }
        }
        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: logMessage });
    
        player.pendingWorldEventSave = null;
        socket.emit('worldEventSaveResult', { d20Roll, bonus, totalRoll, dc, success });
        this.emitGameState(room.id);
    }

    _checkSkillChallengeCompletion(room, player) {
        const challenge = room.gameState.skillChallenge;
        const challengeData = gameData.skillChallenges.find(c => c.id === challenge.challengeId);

        if (challenge.successes >= challenge.successThreshold) {
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>Challenge Succeeded!</b> ${challengeData.success.message}` });
            if (challengeData.success.reward && challengeData.success.reward.type === 'loot') {
                for (let i = 0; i < challengeData.success.reward.count; i++) {
                    const card = room.gameState.decks.treasure.pop();
                    if (card) room.gameState.lootPool.push(card);
                }
                this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `The party found ${challengeData.success.reward.count} new treasure cards!` });
            }
            room.gameState.skillChallenge = { isActive: false };
        } else if (challenge.failures >= challenge.failureThreshold) {
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>Challenge Failed!</b> ${challengeData.failure.message}` });
            if (challengeData.failure.consequence && challengeData.failure.consequence.type === 'damage') {
                const damage = this.rollDice(challengeData.failure.consequence.dice);
                const targetParty = challengeData.failure.consequence.target === 'party';
                Object.values(room.players).forEach(p => {
                    if (p.role === 'Explorer' && (targetParty || p.id === player.id)) {
                        p.stats.currentHp = Math.max(0, p.stats.currentHp - damage);
                        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${p.name} takes ${damage} damage!` });
                    }
                });
            }
            room.gameState.skillChallenge = { isActive: false };
        }
    }

    _resolveUseClassAbility(room, player, data) {
        const ability = gameData.classes[player.class]?.ability;
        if (!ability) return;
    
        let message = `<b>${player.name}</b> uses their <b>${ability.name}</b> ability!`;
    
        switch(player.class) {
            case 'Barbarian':
            case 'Warrior': {
                const spellIndex = player.hand.findIndex(c => c.type === 'Spell');
                if (spellIndex === -1) {
                    if (!player.isNpc) {
                         const socket = io.sockets.sockets.get(player.id);
                         if (socket) socket.emit('actionError', 'You need a Spell card to discard.');
                    }
                    player.currentAp += ability.apCost; // Refund AP
                    return;
                }
                const spellCard = player.hand.splice(spellIndex, 1)[0];
                const effectName = player.class === 'Barbarian' ? 'Unchecked Assault' : 'Weapon Surge';
                player.statusEffects.push({ name: effectName, type: 'damage_boost', duration: 2 });
                message += ` They discard ${spellCard.name} to empower their next attack.`;
                break;
            }
            case 'Cleric':
                player.statusEffects.push({ name: 'Divine Aid', type: 'roll_boost', duration: 2 });
                message += ` Their next roll will be blessed.`;
                break;
            case 'Mage':
                this.dealCard(room.id, player.id, 'spell', 1);
                message += ` They draw a new spell from the ether.`;
                break;
            // Other classes can be added here
        }
    
        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message });
    }
    

    handlePlayerAction(socket, data) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== player.id) {
            return socket.emit('actionError', "It's not your turn.");
        }
        
        if (player.statusEffects && player.statusEffects.some(e => e.type === 'stun' || e.name === 'Stunned')) {
            return socket.emit('actionError', "You are stunned and cannot act!");
        }

        switch(data.action) {
            case 'useClassAbility': {
                const ability = gameData.classes[player.class]?.ability;
                if (!ability) return socket.emit('actionError', 'No ability found for your class.');
                if (player.currentAp < ability.apCost) return socket.emit('actionError', 'Not enough AP.');
                
                player.currentAp -= ability.apCost;
                this._resolveUseClassAbility(room, player, data);
                this.emitGameState(room.id);
                break;
            }
            case 'attack':
                if (data.cardId === 'unarmed') {
                    const apCost = 1; 
                    if (player.currentAp < apCost) {
                        return socket.emit('actionError', 'Not enough Action Points.');
                    }
                    if (player.equipment.weapon) {
                        return socket.emit('actionError', 'You cannot make an unarmed strike while wielding a weapon.');
                    }
                    player.currentAp -= apCost;
                    const d20Roll = Math.floor(Math.random() * 20) + 1;
                    this._resolveUnarmedAttack(room, {
                        attackerId: player.id,
                        targetId: data.targetId,
                        narrative: data.narrative
                    }, d20Roll);
                } else {
                    this.handleAttack(socket, data);
                }
                break;
            case 'guard':
                if (player.currentAp >= gameData.actionCosts.guard) {
                    player.currentAp -= gameData.actionCosts.guard;
                    const guardBonus = player.equipment.armor?.guardBonus || 2;
                    player.stats.shieldHp += guardBonus;
                    this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${player.name} takes a guard stance, gaining ${guardBonus} Shield HP.` });
                    this.emitGameState(room.id);
                } else {
                    socket.emit('actionError', 'Not enough AP to Guard.');
                }
                break;
            case 'briefRespite':
                 if (player.currentAp >= gameData.actionCosts.briefRespite) {
                    if (player.healthDice.current > 0) {
                        player.currentAp -= gameData.actionCosts.briefRespite;
                        player.healthDice.current -= 1;
                        const healAmount = this.rollDice('1d8');
                        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healAmount);
                        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${player.name} takes a brief respite, healing for ${healAmount} HP.` });
                        this.emitGameState(room.id);
                    } else {
                        socket.emit('actionError', 'No Health Dice remaining.');
                    }
                } else {
                    socket.emit('actionError', 'Not enough AP for a Brief Respite.');
                }
                break;
            case 'fullRest':
                 if (player.currentAp >= gameData.actionCosts.fullRest) {
                    if (player.healthDice.current >= 2) {
                        player.currentAp -= gameData.actionCosts.fullRest;
                        player.healthDice.current -= 2;
                        const totalHeal = this.rollDice('2d8');
                        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + totalHeal);
                        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${player.name} takes a full rest, healing for ${totalHeal} HP.` });
                        this.emitGameState(room.id);
                    } else {
                        socket.emit('actionError', 'Not enough Health Dice for a Full Rest.');
                    }
                } else {
                    socket.emit('actionError', 'Not enough AP for a Full Rest.');
                }
                break;
            case 'contributeToSkillChallenge':
                const challenge = room.gameState.skillChallenge;
                if (!challenge || !challenge.isActive) {
                    return socket.emit('actionError', 'There is no active skill challenge.');
                }
                if (player.currentAp < 1) { 
                    return socket.emit('actionError', 'Not enough AP to contribute.');
                }
                player.currentAp -= 1;
    
                const item = player.hand.find(c => c.id === data.itemId) || Object.values(player.equipment).find(c => c && c.id === data.itemId);
                const challengeData = gameData.skillChallenges.find(c => c.id === challenge.challengeId);
                let rollModifier = 0;
                let itemUsedName = '';
                if (item && challengeData.itemBonus && challengeData.itemBonus[item.name]) {
                    rollModifier = challengeData.itemBonus[item.name].rollModifier;
                    itemUsedName = ` with ${item.name}`;
                }
    
                const d20Roll = Math.floor(Math.random() * 20) + 1;
                const playerStat = player.class ? (gameData.classes[player.class].stats[challenge.skill] || 0) : 0;
                const totalRoll = d20Roll + playerStat + rollModifier;
    
                const success = totalRoll >= challenge.dc;
                let logText = `<b>${player.name}</b> attempts to help${itemUsedName}... They roll a ${d20Roll} + ${playerStat}(stat) ${rollModifier > 0 ? `+ ${rollModifier}(item)` : ''} = <b>${totalRoll}</b> vs DC ${challenge.dc}. `;
                
                if (success) {
                    challenge.successes++;
                    logText += "<span style='color: var(--color-success)'>Success!</span>";
                } else {
                    challenge.failures++;
                    logText += "<span style='color: var(--color-danger)'>Failure!</span>";
                }
                challenge.log.push(logText);
                this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: logText });

                socket.emit('skillChallengeRollResult', { 
                    d20Roll, 
                    bonus: playerStat, 
                    itemBonus: rollModifier, 
                    totalRoll, 
                    dc: challenge.dc, 
                    success 
                });
    
                this._checkSkillChallengeCompletion(room, player);
    
                this.emitGameState(room.id);
                break;
            default:
                 console.log(`Action '${data.action}' received but not handled yet.`);
        }
    }
    
    handleDmAction(socket, data) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!room || !player || player.role !== 'DM' || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== player.id) {
            return socket.emit('actionError', "It's not your turn or you are not the DM.");
        }
    
        if (data.action === 'playMonster') {
            this.playMonster(room);
            this.emitGameState(room.id);
        }
    }
    
    resolveItemSwap(socket, { cardToDiscardId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || !player.pendingItemSwap) return;
    
        const { newCard } = player.pendingItemSwap;
    
        if (cardToDiscardId) { 
            const cardIndex = player.hand.findIndex(c => c.id === cardToDiscardId);
            if (cardIndex > -1) {
                const discardedCard = player.hand[cardIndex];
                player.hand.splice(cardIndex, 1, newCard);
                this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>${player.name}</b> discarded ${discardedCard.name} to make room for ${newCard.name}.` });
            }
        } else { 
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>${player.name}</b> chose to discard the new ${newCard.name}.` });
        }
    
        player.pendingItemSwap = null;
        this.emitGameState(room.id);
    }

    handleJoinVoice(socket) {
        const room = this.findRoomBySocket(socket);
        if (!room) return;
        const otherPeers = room.voiceChatPeers.filter(id => id !== socket.id);
        otherPeers.forEach(peerId => io.to(peerId).emit('voice-peer-join', { peerId: socket.id }));
        socket.emit('voice-peers', otherPeers);
        if (!room.voiceChatPeers.includes(socket.id)) room.voiceChatPeers.push(socket.id);
    }
    
    handleLeaveVoice(socket) {
        const room = this.findRoomBySocket(socket);
        if (!room) return;
    
        const peerIndex = room.voiceChatPeers.indexOf(socket.id);
        if (peerIndex > -1) {
            room.voiceChatPeers.splice(peerIndex, 1);
            room.voiceChatPeers.forEach(peerId => io.to(peerId).emit('voice-peer-disconnect', { peerId: socket.id }));
        }
    }

    relayVoice(socket, eventName, data) {
        const room = this.findRoomBySocket(socket);
        if (room && room.players[data.toId]) {
            io.to(data.toId).emit(eventName, { ...data, fromId: socket.id });
        }
    }

    handleDisconnect(socket) {
        console.log(`User disconnected: ${socket.id}`);
        const room = this.findRoomBySocket(socket);
        if (!room) return;
    
        const player = room.players[socket.id];
        if (!player) return;
    
        this.handleLeaveVoice(socket);

        if (room.gameState.phase === 'lobby') {
            delete room.players[socket.id];
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>${player.name}</b> has left the lobby.` });
            this.emitPlayerListUpdate(room.id);
            return;
        }
    
        const wasCurrentTurn = room.gameState.turnOrder[room.gameState.currentPlayerIndex] === socket.id;
        
        this.sendMessageToRoom(room.id, {
            channel: 'game',
            type: 'system',
            message: `<b>${player.name}</b> has disconnected. An NPC will now control their character.`
        });
    
        const newNpcId = `npc-replaced-${player.name.replace(/\s/g, '')}-${Math.floor(Math.random() * 1000)}`;
        const npcVersion = {
            id: newNpcId,
            name: player.name,
            isNpc: true,
            role: player.role,
            class: player.class,
            stats: { ...player.stats },
            currentAp: 0,
            lifeCount: player.lifeCount,
            hand: [...player.hand],
            equipment: JSON.parse(JSON.stringify(player.equipment)),
            statusEffects: JSON.parse(JSON.stringify(player.statusEffects)),
            pendingEventRoll: false,
            pendingEventChoice: null,
            pendingEquipmentChoice: null,
            pendingItemSwap: null,
            madeAdvancedChoice: player.madeAdvancedChoice,
            pendingWorldEventSave: null,
            healthDice: { ...player.healthDice }
        };
        
        delete room.players[socket.id];
        room.players[newNpcId] = npcVersion;
        
        const turnIndex = room.gameState.turnOrder.indexOf(socket.id);
        if (turnIndex > -1) {
            room.gameState.turnOrder[turnIndex] = newNpcId;
        }
    
        if (wasCurrentTurn) {
            this.startTurn(room.id);
        } else {
            this.emitGameState(room.id);
        }
    }
}

const gameManager = new GameManager();

io.on('connection', (socket) => {
    socket.on('createRoom', (data) => gameManager.createRoom(socket, data));
    socket.on('joinRoom', (data) => gameManager.joinRoom(socket, data));
    socket.on('startGame', (data) => gameManager.startGame(socket, data));
    socket.on('chooseClass', (data) => gameManager.chooseClass(socket, data));
    socket.on('equipItem', (data) => gameManager.equipItem(socket, data));
    socket.on('endTurn', () => gameManager.endTurn(socket));
    socket.on('rollForEvent', () => gameManager.rollForEvent(socket));
    socket.on('selectEventCard', (data) => gameManager.selectEventCard(socket, data));
    socket.on('resolveEquipmentChoice', (data) => gameManager.resolveEquipmentChoice(socket, data));
    socket.on('resolveItemSwap', (data) => gameManager.resolveItemSwap(socket, data));
    socket.on('rollForWorldEventSave', () => gameManager.rollForWorldEventSave(socket));
    socket.on('dmAction', (data) => gameManager.handleDmAction(socket, data));
    socket.on('playerAction', (data) => gameManager.handlePlayerAction(socket, data));
    
    socket.on('sendMessage', (data) => {
        const room = gameManager.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (room && player) {
            gameManager.sendMessageToRoom(room.id, {
                senderName: player.name,
                channel: data.channel,
                message: data.message,
            });
        }
    });

    socket.on('join-voice', () => gameManager.handleJoinVoice(socket));
    socket.on('leave-voice', () => gameManager.handleLeaveVoice(socket));
    socket.on('voice-offer', (data) => gameManager.relayVoice(socket, 'voice-offer', data));
    socket.on('voice-answer', (data) => gameManager.relayVoice(socket, 'voice-answer', data));
    socket.on('voice-ice-candidate', (data) => gameManager.relayVoice(socket, 'voice-ice-candidate', data));

    socket.on('disconnect', () => gameManager.handleDisconnect(socket));
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});