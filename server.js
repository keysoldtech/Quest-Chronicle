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

    createRoom(socket, playerName) {
        const newPlayer = this.createPlayerObject(socket.id, playerName);
        
        const newRoom = {
            id: this.generateRoomId(),
            hostId: socket.id,
            players: { [socket.id]: newPlayer },
            voiceChatPeers: [],
            gameState: {
                phase: 'lobby',
                gameMode: null,
                decks: { 
                    item: [], spell: [], monster: [], weapon: [], armor: [], worldEvent: [],
                    playerEvent: [...gameData.playerEventCards],
                    discovery: [...gameData.discoveryCards],
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
        if (room.gameState.phase !== 'lobby') {
             socket.emit('actionError', 'Game has already started.');
            return;
        }

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
            stats: { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, shieldHp: 0 },
            currentAp: 0,
            lifeCount: 3,
            hand: [],
            equipment: { weapon: null, armor: null },
            statusEffects: [],
            pendingEventRoll: false,
            pendingEventChoice: null,
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
                npc.class = randomClassId;
                const classStats = gameData.classes[randomClassId];
                npc.stats = this.calculatePlayerStats(npc);
                npc.stats.currentHp = npc.stats.maxHp;
                npc.healthDice.max = classStats.healthDice;
                npc.healthDice.current = classStats.healthDice;

                this.dealCard(room.id, npc.id, 'weapon', 1);
                this.dealCard(room.id, npc.id, 'armor', 1);
                this.dealCard(room.id, npc.id, 'item', 2);
                this.dealCard(room.id, npc.id, 'spell', 2);
                
                const weapon = npc.hand.find(c => c.type === 'Weapon');
                if (weapon) this._internalEquipItem(room, npc, weapon.id);
                const armor = npc.hand.find(c => c.type === 'Armor');
                if (armor) this._internalEquipItem(room, npc, armor.id);
                
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
        room.gameState.decks.monster = createDeck(gameData.monsterCards);
        room.gameState.decks.weapon = createDeck(gameData.weaponCards);
        room.gameState.decks.armor = createDeck(gameData.armorCards);
        room.gameState.decks.worldEvent = createDeck(gameData.worldEventCards);
        
        Object.values(room.gameState.decks).forEach(deck => shuffle(deck));

        room.gameState.phase = 'class_selection';
        io.to(room.id).emit('gameStarted', room);
    }
    
    chooseClass(socket, { classId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || player.class || player.role === 'DM') return;

        const classStats = gameData.classes[classId];
        if (!classStats) {
            socket.emit('actionError', 'Invalid class selected.');
            return;
        }

        player.class = classId;
        player.stats = this.calculatePlayerStats(player);
        player.stats.currentHp = player.stats.maxHp;
        
        player.healthDice.max = classStats.healthDice;
        player.healthDice.current = classStats.healthDice;
        
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
            return { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, shieldHp: 0 };
        }

        const classStats = gameData.classes[player.class];
        const newStats = {
            maxHp: classStats.baseHp,
            damageBonus: classStats.baseDamageBonus,
            shieldBonus: classStats.baseShieldBonus,
            ap: classStats.baseAp,
            shieldHp: player.stats.shieldHp || 0,
        };

        for (const item of Object.values(player.equipment)) {
            if (item && item.effect && item.effect.bonuses) {
                newStats.damageBonus += item.effect.bonuses.damageBonus || 0;
                newStats.shieldBonus += item.effect.bonuses.shieldBonus || 0;
                newStats.ap += item.effect.bonuses.ap || 0;
                newStats.maxHp += item.effect.bonuses.hp || 0; 
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
        
        if (allReady) {
            if (room.gameState.gameMode === 'Advanced') {
                room.gameState.phase = 'advanced_setup_choice';
            } else {
                room.gameState.phase = 'started';
                this.startFirstTurn(room.id);
            }
        }
    }
    
    dealCard(roomId, playerId, deck, count) {
        const room = this.rooms[roomId];
        const player = room?.players[playerId];
        if (!room || !player) return;

        for (let i = 0; i < count; i++) {
            const card = room.gameState.decks[deck].pop();
            if (card) {
                player.hand.push(card);
            }
        }
    }

    _internalEquipItem(room, player, cardId) {
        if (!player) return false;
    
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return false;
        
        const cardToEquip = player.hand[cardIndex];
        const itemType = cardToEquip.type.toLowerCase();
    
        if (player.equipment[itemType]) {
            player.hand.push(player.equipment[itemType]);
        }
        
        player.equipment[itemType] = cardToEquip;
        player.hand.splice(cardIndex, 1);
        
        player.stats = this.calculatePlayerStats(player);
        return true;
    }

    equipItem(socket, { cardId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
    
        const success = this._internalEquipItem(room, player, cardId);
        
        if (!success) {
            socket.emit('actionError', 'Card not in hand.');
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

    handleNpcExplorerTurn(room, player) {
        setTimeout(() => {
            try {
                let actionTaken = false;
        
                const target = room.gameState.board.monsters[0];
                const weapon = player.equipment.weapon;
        
                // Stun check for NPC
                if (player.statusEffects && player.statusEffects.some(e => e.type === 'stun' || e.name === 'Stunned')) {
                    this.sendMessageToRoom(room.id, { 
                        channel: 'game', 
                        type: 'system', 
                        message: `${player.name} is stunned and cannot act!` 
                    });
                } else {
                     // Action Priority: Attack -> Guard -> Rest
                    if (target && weapon && player.currentAp >= (weapon.apCost || 1)) {
                        // ATTACK
                        const narrative = gameData.npcDialogue.explorer.attack[Math.floor(Math.random() * gameData.npcDialogue.explorer.attack.length)];
                        const d20Roll = Math.floor(Math.random() * 20) + 1;
                        this._resolveAttack(room, {
                            attackerId: player.id,
                            targetId: target.id,
                            weaponId: weapon.id,
                            narrative: narrative
                        }, d20Roll);
                        actionTaken = true;
                    } else if (player.stats.currentHp < player.stats.maxHp / 2 && player.currentAp >= gameData.actionCosts.guard) {
                        // GUARD
                        player.currentAp -= gameData.actionCosts.guard;
                        const guardBonus = player.equipment.armor?.guardBonus || 2;
                        player.stats.shieldHp += guardBonus;
                        this.sendMessageToRoom(room.id, { 
                            channel: 'game', 
                            type: 'system', 
                            message: `${player.name} is wounded and takes a defensive stance, gaining ${guardBonus} Shield HP.` 
                        });
                        this.emitGameState(room.id);
                        actionTaken = true;
                    } else if (player.stats.currentHp < player.stats.maxHp && player.healthDice.current > 0 && player.currentAp >= gameData.actionCosts.briefRespite) {
                        // REST (HEAL)
                        player.currentAp -= gameData.actionCosts.briefRespite;
                        player.healthDice.current -= 1;
                        const healAmount = this.rollDice('1d8');
                        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healAmount);
                        this.sendMessageToRoom(room.id, { 
                            channel: 'game', 
                            type: 'system', 
                            message: `${player.name} takes a moment to tend their wounds, healing for ${healAmount} HP.` 
                        });
                        this.emitGameState(room.id);
                        actionTaken = true;
                    }
                }
        
                if (!actionTaken && !(player.statusEffects && player.statusEffects.some(e => e.type === 'stun' || e.name === 'Stunned'))) {
                    let reason = "considers their options and prepares for the next move.";
                    if (!target) {
                        reason = "sees no enemies and decides to wait.";
                    } else if (weapon && player.currentAp < (weapon.apCost || 1)) {
                        reason = "lacks the action points for a major action.";
                    } else if (player.stats.currentHp >= (player.stats.maxHp / 2) && player.currentAp < gameData.actionCosts.briefRespite) {
                        reason = "is healthy and preserves their energy.";
                    }
    
                     this.sendMessageToRoom(room.id, { 
                        channel: 'game', 
                        type: 'system', 
                        message: `${player.name} ${reason}` 
                    });
                }
            } catch (error) {
                console.error(`Error during NPC turn for ${player.name}:`, error);
                this.sendMessageToRoom(room.id, { 
                    channel: 'game', 
                    type: 'system', 
                    message: `${player.name} seems confused and ends their turn.` 
                });
            } finally {
                // End turn - this must always run to prevent the game from freezing
                room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
                if (room.gameState.currentPlayerIndex === 0) {
                    room.gameState.turnCount++;
                }
                this.startTurn(room.id);
            }
        }, 2000);
    }

    startTurn(roomId) {
        const room = this.rooms[roomId];
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
            if (room.gameState.board.monsters.length === 0) {
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
                } else {
                    const monsterCard = room.gameState.decks.monster.pop();
                    if (monsterCard) {
                        monsterCard.currentHp = monsterCard.maxHp;
                        room.gameState.board.monsters.push(monsterCard);
                        this.sendMessageToRoom(room.id, {
                            channel: 'game', senderName: 'Dungeon Master',
                            message: gameData.npcDialogue.dm.playMonster[Math.floor(Math.random() * gameData.npcDialogue.dm.playMonster.length)],
                            isNarrative: true
                        });
                    }
                }
            } else {
                this.sendMessageToRoom(room.id, {
                    channel: 'game', senderName: 'Dungeon Master',
                    message: `The monsters continue their assault!`, isNarrative: true
                });
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
        
        const apCost = weapon.apCost || 1;
        if (player.currentAp < apCost) {
            return socket.emit('actionError', 'Not enough Action Points.');
        }
        player.currentAp -= apCost;

        // Resolve attack automatically by rolling a d20
        const d20Roll = Math.floor(Math.random() * 20) + 1;
        this._resolveAttack(room, {
            attackerId: player.id,
            targetId: target.id,
            weaponId: weapon.id,
            narrative: data.narrative
        }, d20Roll);
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

        const totalRollToHit = d20Roll + player.stats.damageBonus;
        const hit = totalRollToHit >= target.requiredRollToHit;
        let totalDamage = 0;
        let rawDamageRoll = 0;

        if (hit) {
            rawDamageRoll = this.rollDice(weapon.effect.dice);
            totalDamage = rawDamageRoll + player.stats.damageBonus;
            target.currentHp -= totalDamage;
        }
        
        io.to(room.id).emit('attackAnimation', {
            attackerName: player.name,
            d20Roll,
            totalRollToHit,
            requiredRoll: target.requiredRollToHit,
            hit,
            rawDamageRoll,
            damageBonus: player.stats.damageBonus,
            totalDamage,
        });

        if (target.currentHp <= 0) {
            room.gameState.board.monsters = room.gameState.board.monsters.filter(m => m.id !== target.id);
            const dialogue = gameData.npcDialogue.dm.monsterDefeated;
            this.sendMessageToRoom(room.id, {
                channel: 'game', type: 'system',
                message: `${player.name} defeated ${target.name}!`,
            });
             this.sendMessageToRoom(room.id, {
                channel: 'game', senderName: 'Dungeon Master',
                message: dialogue[Math.floor(Math.random() * dialogue.length)], isNarrative: true
            });
        }

        this.emitGameState(room.id);
    }

    rollForEvent(socket) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || !player.pendingEventRoll) return;

        player.pendingEventRoll = false;

        const roll = Math.floor(Math.random() * 20) + 1;
        let outcome = 'none';
        let cardOptions = [];

        if (roll > 10) { 
            outcome = Math.random() > 0.5 ? 'discovery' : 'playerEvent';
            const deckName = outcome === 'discovery' ? 'discovery' : 'playerEvent';
            const deck = room.gameState.decks[deckName];
            
            if (deck.length >= 2) {
                cardOptions = [deck.pop(), deck.pop()];
                player.pendingEventChoice = { outcome: deckName, options: cardOptions };
            } else {
                outcome = 'none';
            }
        }

        socket.emit('eventRollResult', { roll, outcome, cardOptions });
        this.emitGameState(room.id);
    }

    selectEventCard(socket, { cardId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || !player.pendingEventChoice) return;

        const choice = player.pendingEventChoice;
        const selectedCard = choice.options.find(c => c.id === cardId);
        if (!selectedCard) return;

        if (choice.outcome === 'discovery') {
            room.gameState.lootPool.push(selectedCard);
        } else if (choice.outcome === 'playerEvent') {
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
        if (otherCard) room.gameState.decks[choice.outcome].unshift(otherCard);

        player.pendingEventChoice = null;
        this.emitGameState(room.id);
    }

    rollForWorldEventSave(socket) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || !player.pendingWorldEventSave) return;
    
        const { dc, save, eventName } = player.pendingWorldEventSave;
        const d20Roll = Math.floor(Math.random() * 20) + 1;
        const bonus = 2; // Placeholder bonus
        const totalRoll = d20Roll + bonus;
        const success = totalRoll >= dc;
    
        if (!success) {
            if (eventName === 'Echoes of the Past') {
                player.statusEffects.push({ name: 'Stunned', type: 'stun', duration: 2 });
                this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${player.name} failed their save and is stunned!` });
            }
        }
    
        player.pendingWorldEventSave = null;
        socket.emit('worldEventSaveResult', { d20Roll, bonus, totalRoll, dc, success });
        this.emitGameState(room.id);
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
            case 'attack':
                this.handleAttack(socket, data);
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
            const monsterCard = room.gameState.decks.monster.pop();
            if (monsterCard) {
                monsterCard.currentHp = monsterCard.maxHp;
                room.gameState.board.monsters.push(monsterCard);
                this.sendMessageToRoom(room.id, {
                    channel: 'game', senderName: 'Dungeon Master',
                    message: gameData.npcDialogue.dm.playMonster[Math.floor(Math.random() * gameData.npcDialogue.dm.playMonster.length)],
                    isNarrative: true
                });
                this.emitGameState(room.id);
            }
        }
    }

    handleJoinVoice(socket) {
        const room = this.findRoomBySocket(socket);
        if (!room) return;
        const otherPeers = room.voiceChatPeers.filter(id => id !== socket.id);
        otherPeers.forEach(peerId => io.to(peerId).emit('voice-peer-join', { peerId: socket.id }));
        socket.emit('voice-peers', otherPeers);
        if (!room.voiceChatPeers.includes(socket.id)) room.voiceChatPeers.push(socket.id);
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
        if (room) {
            const player = room.players[socket.id];
            if (player) {
                delete room.players[socket.id];
                io.to(room.id).emit('playerLeft', { playerName: player.name });
                this.emitPlayerListUpdate(room.id);
            }
            const peerIndex = room.voiceChatPeers.indexOf(socket.id);
            if (peerIndex > -1) {
                room.voiceChatPeers.splice(peerIndex, 1);
                room.voiceChatPeers.forEach(peerId => io.to(peerId).emit('voice-peer-disconnect', { peerId: socket.id }));
            }
        }
    }
}

const gameManager = new GameManager();

io.on('connection', (socket) => {
    socket.on('createRoom', (playerName) => gameManager.createRoom(socket, playerName));
    socket.on('joinRoom', (data) => gameManager.joinRoom(socket, data));
    socket.on('startGame', (data) => gameManager.startGame(socket, data));
    socket.on('chooseClass', (data) => gameManager.chooseClass(socket, data));
    socket.on('equipItem', (data) => gameManager.equipItem(socket, data));
    socket.on('endTurn', () => gameManager.endTurn(socket));
    socket.on('rollForEvent', () => gameManager.rollForEvent(socket));
    socket.on('selectEventCard', (data) => gameManager.selectEventCard(socket, data));
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

    // Voice Chat
    socket.on('join-voice', () => gameManager.handleJoinVoice(socket));
    socket.on('voice-offer', (data) => gameManager.relayVoice(socket, 'voice-offer', data));
    socket.on('voice-answer', (data) => gameManager.relayVoice(socket, 'voice-answer', data));
    socket.on('voice-ice-candidate', (data) => gameManager.relayVoice(socket, 'voice-ice-candidate', data));

    socket.on('disconnect', () => gameManager.handleDisconnect(socket));
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});