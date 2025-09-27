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

    determine_ai_action(player, gameState, allPlayers) {
        const { board } = gameState;
        const { currentAp, stats, hand, healthDice } = player;

        // Priority 1: Healing (Cards)
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

        // Priority 2: Attack
        const weapon = player.equipment.weapon;
        if (weapon && board.monsters.length > 0) {
            const apCost = weapon.apCost || 2;
            if (currentAp >= apCost) {
                let bestTarget = board.monsters.reduce((prev, curr) => (prev.currentHp < curr.currentHp) ? prev : curr);
                if (bestTarget) {
                    return { action: 'attack', targetId: bestTarget.id, weaponId: weapon.id, apCost: apCost };
                }
            }
        }
        
        // Priority 3: Guard
        const guardApCost = gameData.actionCosts.guard;
        if (currentAp >= guardApCost && stats.currentHp < stats.maxHp * 0.75) {
            return { action: 'guard', apCost: guardApCost };
        }
        
        // Priority 4: Rest (Out of Combat)
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

        // Default: Wait
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

            while (player.currentAp > 0) {
                const currentPlayerState = room.players[player.id];
                if (!currentPlayerState) break;

                const bestAction = this.determine_ai_action(currentPlayerState, room.gameState, room.players);

                if (!bestAction || bestAction.action === 'wait' || currentPlayerState.currentAp < bestAction.apCost) {
                    break;
                }

                currentPlayerState.currentAp -= bestAction.apCost;
                
                const narrative = gameData.npcDialogue.explorer.attack[Math.floor(Math.random() * gameData.npcDialogue.explorer.attack.length)];

                switch (bestAction.action) {
                    case 'attack':
                        this.sendMessageToRoom(room.id, {
                            channel: 'game',
                            type: 'system',
                            message: `<b>${player.name}</b> used ${bestAction.apCost} AP to Attack, targeting the weakest foe.`
                        });
                        const d20Roll = Math.floor(Math.random() * 20) + 1;
                        this._resolveAttack(room, {
                            attackerId: player.id,
                            targetId: bestAction.targetId,
                            weaponId: bestAction.weaponId,
                            narrative: narrative
                        }, d20Roll);
                        break;
                    case 'guard':
                        const guardBonus = player.equipment.armor?.guardBonus || 2;
                        player.stats.shieldHp += guardBonus;
                        this.sendMessageToRoom(room.id, { 
                            channel: 'game', 
                            type: 'system', 
                            message: `<b>${player.name}</b> used ${bestAction.apCost} AP to Guard, gaining ${guardBonus} Shield HP.` 
                        });
                        break;
                    case 'briefRespite':
                        player.healthDice.current -= 1;
                        const healAmount = this.rollDice('1d8');
                        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healAmount);
                        this.sendMessageToRoom(room.id, { 
                            channel: 'game', 
                            type: 'system', 
                            message: `<b>${player.name}</b> used ${bestAction.apCost} AP for a Brief Respite, healing for ${healAmount} HP.` 
                        });
                        break;
                    case 'fullRest':
                        player.healthDice.current -= 2;
                        const totalHeal = this.rollDice('2d8');
                        player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + totalHeal);
                        this.sendMessageToRoom(room.id, { 
                            channel: 'game', 
                            type: 'system', 
                            message: `<b>${player.name}</b> used ${bestAction.apCost} AP for a Full Rest, healing for ${totalHeal} HP.` 
                        });
                        break;
                    case 'useCard':
                        const cardIndex = player.hand.findIndex(c => c.id === bestAction.cardId);
                        if (cardIndex > -1) {
                            const card = player.hand[cardIndex];
                            const target = room.players[bestAction.targetId];
                            if (target && card.effect.type === 'heal') {
                                const healAmountCard = this.rollDice(card.effect.dice);
                                target.stats.currentHp = Math.min(target.stats.maxHp, target.stats.currentHp + healAmountCard);
                                player.hand.splice(cardIndex, 1);
                                this.sendMessageToRoom(room.id, {
                                    channel: 'game',
                                    type: 'system',
                                    message: `<b>${player.name}</b> used ${bestAction.apCost} AP to use ${card.name} on ${target.name}, healing for ${healAmountCard} HP.`
                                });
                            }
                        }
                        break;
                }
                
                player.stats = this.calculatePlayerStats(player);
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

            // Target lowest HP explorer
            explorers.sort((a, b) => a.stats.currentHp - b.stats.currentHp);
            const target = explorers[0];
            if (!target) continue;
            
            this._resolveMonsterAttack(room, monster, target);
        }
    }

    _resolveMonsterAttack(room, monster, target) {
        const requiredRollToHit = 10 + target.stats.shieldBonus;
        const d20Roll = Math.floor(Math.random() * 20) + 1;
        const totalRollToHit = d20Roll + monster.attackBonus;
        const hit = totalRollToHit >= requiredRollToHit;
        
        let totalDamage = 0;
        let rawDamageRoll = 0;

        if (hit) {
            rawDamageRoll = this.rollDice(monster.effect.dice);
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
            totalDamage += damageToShield; // For logging purposes, show total damage dealt
        }
        
        io.to(room.id).emit('monsterAttackAnimation', {
            attackerName: monster.name,
            targetName: target.name,
            d20Roll,
            totalRollToHit,
            requiredRoll: requiredRollToHit,
            hit,
            rawDamageRoll,
            damageBonus: 0,
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
            await this.handleMonsterTurns(room);
            await new Promise(res => setTimeout(res, 1500)); // Pause after monster attacks

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
                        isActive: true,
                        challengeId: challenge.id,
                        name: challenge.name,
                        description: challenge.description,
                        skill: challenge.skill,
                        dc: challenge.dc,
                        successes: 0,
                        failures: 0,
                        successThreshold: challenge.successThreshold,
                        failureThreshold: challenge.failureThreshold,
                        log: [],
                    };
                    this.sendMessageToRoom(room.id, {
                        channel: 'game', type: 'system',
                        message: `A new challenge begins: <b>${challenge.name}</b>! Explorers can contribute on their turn.`
                    });
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
            case 'contributeToSkillChallenge':
                const challenge = room.gameState.skillChallenge;
                if (!challenge || !challenge.isActive) {
                    return socket.emit('actionError', 'There is no active skill challenge.');
                }
                if (player.currentAp < 1) { // Cost 1 AP
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
    
                if (challenge.successes >= challenge.successThreshold) {
                    this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `<b>Challenge Succeeded!</b> ${challengeData.success.message}` });
                    if (challengeData.success.reward && challengeData.success.reward.type === 'loot') {
                        for (let i = 0; i < challengeData.success.reward.count; i++) {
                            const card = room.gameState.decks.discovery.pop();
                            if (card) room.gameState.lootPool.push(card);
                        }
                        this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `The party found ${challengeData.success.reward.count} new discovery cards!` });
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
        if (!room) return;
    
        const player = room.players[socket.id];
        if (!player) return;
    
        const wasCurrentTurn = room.gameState.turnOrder[room.gameState.currentPlayerIndex] === socket.id;
    
        // Remove player from players object
        delete room.players[socket.id];
    
        // Remove player from turn order
        const turnIndex = room.gameState.turnOrder.indexOf(socket.id);
        if (turnIndex > -1) {
            room.gameState.turnOrder.splice(turnIndex, 1);
            // Adjust index of current player if the disconnected player was before them
            if (turnIndex < room.gameState.currentPlayerIndex) {
                room.gameState.currentPlayerIndex--;
            }
        }
    
        // Announce departure
        io.to(room.id).emit('playerLeft', { playerName: player.name });
        this.emitPlayerListUpdate(room.id);
    
        // If it was the disconnected player's turn, advance the turn
        if (wasCurrentTurn) {
            // Ensure index is not out of bounds after splice
            if (room.gameState.currentPlayerIndex >= room.gameState.turnOrder.length) {
                room.gameState.currentPlayerIndex = 0;
                if(room.gameState.turnOrder.length > 0 && room.gameState.phase !== 'lobby') room.gameState.turnCount++;
            }
            this.startTurn(room.id);
        } else {
            // Otherwise, just send a regular update
            this.emitGameState(room.id);
        }
    
        // Voice chat cleanup
        const peerIndex = room.voiceChatPeers.indexOf(socket.id);
        if (peerIndex > -1) {
            room.voiceChatPeers.splice(peerIndex, 1);
            room.voiceChatPeers.forEach(peerId => io.to(peerId).emit('voice-peer-disconnect', { peerId: socket.id }));
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