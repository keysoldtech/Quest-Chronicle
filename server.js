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
        [array[i], array[j]] = [array[j], array[i]]; // Corrected shuffle logic
    }
}

// --- Game State Management ---
class GameManager {
    constructor() {
        this.rooms = {};
        this.cardIdCounter = 1000; // Start card IDs high to avoid collision with data file
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
        const newPlayer = this.createPlayerObject(socket.id, playerName); // Role will be assigned at game start
        
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
                
                // Assign random class
                const randomClassId = classKeys[Math.floor(Math.random() * classKeys.length)];
                npc.class = randomClassId;
                const classStats = gameData.classes[randomClassId];
                npc.stats = this.calculatePlayerStats(npc);
                npc.stats.currentHp = npc.stats.maxHp;
                npc.healthDice.max = classStats.healthDice;
                npc.healthDice.current = classStats.healthDice;

                // Deal starting equipment
                this.dealCard(room.id, npc.id, 'weapon', 1);
                this.dealCard(room.id, npc.id, 'armor', 1);
                this.dealCard(room.id, npc.id, 'item', 2);
                this.dealCard(room.id, npc.id, 'spell', 2);
                
                // Auto-equip
                const weapon = npc.hand.find(c => c.type === 'Weapon');
                if (weapon) this._internalEquipItem(room, npc, weapon.id);
                const armor = npc.hand.find(c => c.type === 'Armor');
                if (armor) this._internalEquipItem(room, npc, armor.id);
                
                room.players[npc.id] = npc;
                explorerNpcs.push(npc);
            }
            
            const explorerIds = [player.id, ...explorerNpcs.map(n => n.id)];
            shuffle(explorerIds); // Shuffle all explorers
            room.gameState.turnOrder = [dmNpc.id, ...explorerIds];

        } else {
            // Multiplayer: Assign one human player as DM.
            const dm = players[Math.floor(Math.random() * players.length)];
            dm.role = 'DM';
            players.forEach(p => {
                if (p.id !== dm.id) p.role = 'Explorer';
            });
            // Setup turn order (DM first, then explorers)
            const explorerIds = players.filter(p => p.id !== dm.id).map(p => p.id);
            shuffle(explorerIds);
            room.gameState.turnOrder = [dm.id, ...explorerIds];
        }
        
        // Prepare Decks
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
        
        // Beginner mode: Deal starting equipment
        if (room.gameState.gameMode === 'Beginner') {
            this.dealCard(room.id, player.id, 'weapon', 1);
            this.dealCard(room.id, player.id, 'armor', 1);
            this.dealCard(room.id, player.id, 'item', 2);
            this.dealCard(room.id, player.id, 'spell', 2);
            
            // Auto-equip first weapon/armor
            const weapon = player.hand.find(c => c.type === 'Weapon');
            if (weapon) this._internalEquipItem(room, player, weapon.id);
            const armor = player.hand.find(c => c.type === 'Armor');
            if (armor) this._internalEquipItem(room, player, armor.id);
            
        } else { // Advanced Mode
            player.madeAdvancedChoice = false;
        }

        this.checkAllPlayersReady(room);
        this.emitGameState(room.id);
    }
    
    // --- STAT CALCULATION ---
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
            shieldHp: player.stats.shieldHp || 0, // Preserve current shield HP
        };

        // Add bonuses from equipped items
        for (const item of Object.values(player.equipment)) {
            if (item && item.effect && item.effect.bonuses) {
                newStats.damageBonus += item.effect.bonuses.damage || 0;
                newStats.shieldBonus += item.effect.bonuses.shield || 0;
                newStats.ap += item.effect.bonuses.ap || 0;
                newStats.maxHp += item.effect.bonuses.hp || 0; 
            }
        }
        
        // Preserve current HP, but cap it at the new maxHP.
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

    _internalEquipItem(room, player, cardId) {
        if (!player) return false;
    
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return false;
        
        const cardToEquip = player.hand[cardIndex];
        const itemType = cardToEquip.type.toLowerCase(); // 'weapon' or 'armor'
    
        if (player.equipment[itemType]) {
            player.hand.push(player.equipment[itemType]); // Move old item to hand
        }
        
        player.equipment[itemType] = cardToEquip;
        player.hand.splice(cardIndex, 1);
        
        player.stats = this.calculatePlayerStats(player);
        return true;
    }

    equipItem(socket, { cardId }, isAutoEquip = false) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
    
        const success = this._internalEquipItem(room, player, cardId);
        
        if (!success && !isAutoEquip) {
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
            let actionTaken = false;
    
            // Action Priority 1: Attack
            const target = room.gameState.board.monsters[0];
            const weapon = player.equipment.weapon;
            if (target && weapon && player.currentAp >= (weapon.apCost || 1)) {
                const narrative = gameData.npcDialogue.explorer.attack[Math.floor(Math.random() * gameData.npcDialogue.explorer.attack.length)];
                this.handleAttack(room, player, {
                    targetId: target.id,
                    narrative: narrative
                });
                actionTaken = true;
            } 
            // Action Priority 2: Guard if low on health
            else if (player.stats.currentHp < player.stats.maxHp / 2 && player.currentAp >= gameData.actionCosts.guard) {
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
            }
    
            // If no action was taken, log a message
            if (!actionTaken) {
                 this.sendMessageToRoom(room.id, { 
                    channel: 'game', 
                    type: 'system', 
                    message: `${player.name} considers their options and prepares for the next move.` 
                });
            }
    
            // Always end the turn after the action (or inaction)
            room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
            if (room.gameState.currentPlayerIndex === 0) {
                room.gameState.turnCount++;
            }
            this.startTurn(room.id);
    
        }, 2000); // 2-second delay to simulate "thinking"
    }

    startTurn(roomId) {
        const room = this.rooms[roomId];
        const player = room.players[room.gameState.turnOrder[room.gameState.currentPlayerIndex]];
        if (!player) return;

        // If it's an automated DM's turn (in single player), take action and pass turn.
        if (player.isNpc && player.role === 'DM') {
            // If there are no monsters on the board, the DM acts.
            if (room.gameState.board.monsters.length === 0) {
                // 25% chance to play a World Event if the deck has cards.
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
                        this.sendMessageToRoom(room.id, {
                            channel: 'game', type: 'system',
                            message: `A new World Event is active: ${worldEventCard.name}.`
                        });
                    }
                } else {
                    // Otherwise, play a monster.
                    const monsterCard = room.gameState.decks.monster.pop();
                    if (monsterCard) {
                        monsterCard.currentHp = monsterCard.maxHp;
                        room.gameState.board.monsters.push(monsterCard);
                        this.sendMessageToRoom(room.id, {
                            channel: 'game',
                            senderName: 'Dungeon Master',
                            message: gameData.npcDialogue.dm.playMonster[Math.floor(Math.random() * gameData.npcDialogue.dm.playMonster.length)],
                            isNarrative: true
                        });
                    }
                }
            } else {
                 // If there are monsters, the DM's "action" is just narrative for now.
                this.sendMessageToRoom(room.id, {
                    channel: 'game',
                    senderName: 'Dungeon Master',
                    message: `The monsters continue their assault!`,
                    isNarrative: true
                });
            }

            this.emitGameState(roomId); // Show the new state
            
            // Pass the turn after a short delay to simulate a real turn
            setTimeout(() => {
                room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
                this.startTurn(roomId);
            }, 1500);
            return; // Halt further execution for the NPC DM turn
        }

        // Handle NPC Explorer turn
        if (player.isNpc && player.role === 'Explorer') {
            player.stats = this.calculatePlayerStats(player);
            player.currentAp = player.stats.ap;
            this.emitGameState(roomId); // Update state before AI acts
            this.handleNpcExplorerTurn(room, player);
            return; // AI will handle ending the turn
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

        // Move to the next player
        room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
        
        // If we've looped back to the start (DM), increment turn count
        if (room.gameState.currentPlayerIndex === 0) {
            room.gameState.turnCount++;
        }

        this.startTurn(room.id);
    }

    handlePlayerAction(socket, data) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        const isMyTurn = room?.gameState.turnOrder[room.gameState.currentPlayerIndex] === player?.id;

        if (!player || !isMyTurn) return;

        switch (data.action) {
            case 'attack':
                this.handleAttack(room, player, data);
                break;
            case 'guard':
                if (player.currentAp >= gameData.actionCosts.guard) {
                    player.currentAp -= gameData.actionCosts.guard;
                    const guardBonus = player.equipment.armor?.guardBonus || 2;
                    player.stats.shieldHp += guardBonus;
                    this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${player.name} uses Guard, gaining ${guardBonus} Shield HP.` });
                }
                break;
            case 'briefRespite':
                if (player.currentAp >= gameData.actionCosts.briefRespite && player.healthDice.current > 0) {
                    player.currentAp -= gameData.actionCosts.briefRespite;
                    player.healthDice.current--;
                    const healAmount = Math.floor(Math.random() * 8) + 1; // 1d8
                    const oldHp = player.stats.currentHp;
                    player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healAmount);
                    const actualHeal = player.stats.currentHp - oldHp;
                    this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${player.name} uses Brief Respite, rolling 1d8 for ${healAmount} and healing for ${actualHeal} HP.` });
                }
                break;
            case 'fullRest':
                 if (player.currentAp >= gameData.actionCosts.fullRest && player.healthDice.current >= 2) {
                    player.currentAp -= gameData.actionCosts.fullRest;
                    player.healthDice.current -= 2;
                    const healRoll1 = Math.floor(Math.random() * 8) + 1;
                    const healRoll2 = Math.floor(Math.random() * 8) + 1;
                    const healAmount = healRoll1 + healRoll2;
                    const oldHp = player.stats.currentHp;
                    player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healAmount);
                    const actualHeal = player.stats.currentHp - oldHp;
                    this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `${player.name} uses Full Rest, rolling 2d8 for ${healAmount} (${healRoll1}+${healRoll2}) and healing for ${actualHeal} HP.` });
                }
                break;
        }
        
        if (data.narrative && data.action !== 'attack') {
            this.sendMessage(socket, { channel: 'game', message: data.narrative, isNarrative: true });
        }
        
        this.emitGameState(room.id);
    }

    handleAttack(room, player, data) {
        const weapon = player.equipment.weapon;
        const target = room.gameState.board.monsters.find(m => m.id === data.targetId);

        if (!weapon || !target || player.currentAp < (weapon.apCost || 1)) return;

        player.currentAp -= (weapon.apCost || 1);
        
        this.sendMessageToRoom(room.id, {
            senderName: player.name,
            channel: 'game',
            message: data.narrative,
            isNarrative: true
        });

        const d20Roll = Math.floor(Math.random() * 20) + 1;
        const totalRollToHit = d20Roll + player.stats.damageBonus; // Assuming damageBonus also applies to hit
        const hit = totalRollToHit >= target.requiredRollToHit;
        
        this.sendMessageToRoom(room.id, {
            channel: 'game', type: 'system',
            message: `${player.name} attacks ${target.name} with ${weapon.name}! Rolls a ${d20Roll} + ${player.stats.damageBonus} bonus = ${totalRollToHit} (vs DC ${target.requiredRollToHit})`
        });
        
        let totalDamage = 0;
        let rawDamageRoll = 0;
        
        if (hit) {
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `It's a HIT!` });
            const damageDice = weapon.effect.dice;
            const [numDice, diceType] = damageDice.split('d').map(Number);
            for (let i = 0; i < numDice; i++) {
                rawDamageRoll += Math.floor(Math.random() * diceType) + 1;
            }
            totalDamage = rawDamageRoll + player.stats.damageBonus;
            target.currentHp -= totalDamage;
            this.sendMessageToRoom(room.id, {
                channel: 'game', type: 'system',
                message: `${player.name} deals ${rawDamageRoll} (dice) + ${player.stats.damageBonus} (bonus) = ${totalDamage} damage to ${target.name}.`
            });
        } else {
            this.sendMessageToRoom(room.id, { channel: 'game', type: 'system', message: `It's a MISS!` });
        }
        
        io.to(room.id).emit('attackAnimation', {
            attackerName: player.name,
            targetName: target.name,
            weaponName: weapon.name,
            hit,
            d20Roll,
            totalRollToHit,
            requiredRoll: target.requiredRollToHit,
            rawDamageRoll,
            damageBonus: player.stats.damageBonus,
            totalDamage
        });
        
        // Check for monster defeat
        if (target.currentHp <= 0) {
            this.handleMonsterDefeat(room, target.id);
        }
    }
    
    handleMonsterDefeat(room, monsterId) {
        const monsterIndex = room.gameState.board.monsters.findIndex(m => m.id === monsterId);
        if (monsterIndex > -1) {
            const monsterName = room.gameState.board.monsters[monsterIndex].name;
            room.gameState.board.monsters.splice(monsterIndex, 1);
            this.sendMessageToRoom(room.id, { channel: 'game', message: `${monsterName} has been defeated!`, type: 'system' });
        }
    }

    handleDmAction(socket, data) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        const isMyTurn = room?.gameState.turnOrder[room.gameState.currentPlayerIndex] === player?.id;

        if (!player || player.role !== 'DM' || !isMyTurn) return;
        
        if (data.action === 'playMonster') {
            const monsterCard = room.gameState.decks.monster.pop();
            if (monsterCard) {
                monsterCard.currentHp = monsterCard.maxHp;
                room.gameState.board.monsters.push(monsterCard);
                 this.sendMessageToRoom(room.id, {
                    channel: 'game',
                    senderName: 'Dungeon Master',
                    message: gameData.npcDialogue.dm.playMonster[Math.floor(Math.random() * gameData.npcDialogue.dm.playMonster.length)],
                    isNarrative: true
                });
            }
        }
        
        this.emitGameState(room.id);
    }
    
    dealCard(roomId, playerId, deck, count) {
        const room = this.rooms[roomId];
        const player = room?.players[playerId];
        if (!room || !player) return;

        for (let i = 0; i < count; i++) {
            if (room.gameState.decks[deck].length > 0) {
                const card = room.gameState.decks[deck].pop();
                player.hand.push(card);
            }
        }
    }

    sendMessage(socket, data) {
        const room = this.findRoomBySocket(socket);
        const sender = room?.players[socket.id];
        if (!room || !sender) return;

        const messageData = {
            senderName: sender.name,
            channel: data.channel,
            message: data.message,
            isNarrative: data.isNarrative || false
        };

        if (data.channel === 'party') {
            Object.values(room.players).forEach(p => {
                io.to(p.id).emit('chatMessage', messageData);
            });
        } else {
            io.to(room.id).emit('chatMessage', messageData);
        }
    }
    
    sendMessageToRoom(roomId, data) {
         const messageData = {
            senderName: data.senderName || 'System',
            channel: data.channel,
            message: data.message,
            isNarrative: data.isNarrative || false,
            type: data.type || 'system' // Pass through the type
        };
        io.to(roomId).emit('chatMessage', messageData);
    }


    findRoomBySocket(socket) {
        return Object.values(this.rooms).find(r => r.players[socket.id]);
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

    disconnect(socket) {
        const room = this.findRoomBySocket(socket);
        if (!room) return;

        const player = room.players[socket.id];
        if (!player) return;
        
        if (room.gameState.phase === 'lobby') {
            delete room.players[socket.id];
        } else {
            // In-game, mark as NPC
            player.isNpc = true;
        }

        // Handle voice chat disconnect
        room.voiceChatPeers = room.voiceChatPeers.filter(id => id !== socket.id);
        socket.to(room.id).emit('voice-peer-disconnect', { peerId: socket.id });

        this.emitPlayerListUpdate(room.id);
        io.to(room.id).emit('playerLeft', { playerName: player.name });
    }
    
    // --- EVENT HANDLING ---
    rollForEvent(socket) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || !player.pendingEventRoll) return;

        player.pendingEventRoll = false;
        const roll = Math.floor(Math.random() * 20) + 1;
        let outcome = 'none';
        let cardOptions = [];

        if (roll <= 8) { // Nothing
            outcome = 'none';
        } else if (roll <= 12) { // Player Event
            outcome = 'player_event';
            if (room.gameState.decks.playerEvent.length >= 2) {
                cardOptions = [room.gameState.decks.playerEvent.pop(), room.gameState.decks.playerEvent.pop()];
            }
        } else if (roll <= 16) { // Discovery
            outcome = 'discovery';
            if (room.gameState.decks.discovery.length >= 2) {
                cardOptions = [room.gameState.decks.discovery.pop(), room.gameState.decks.discovery.pop()];
            }
        } else { // World Event
            outcome = 'world_event';
            const worldEventCard = room.gameState.decks.worldEvent.pop();
            if (worldEventCard) {
                room.gameState.worldEvents.currentEvent = worldEventCard;
                cardOptions.push(worldEventCard);
                if (worldEventCard.saveInfo) {
                    Object.values(room.players).forEach(p => {
                        if (p.role === 'Explorer') {
                            p.pendingWorldEventSave = {
                                eventName: worldEventCard.name,
                                ...worldEventCard.saveInfo
                            };
                        }
                    });
                }
            }
        }
        
        let outcomeText = "Nothing happens.";
        if (outcome === 'player_event') outcomeText = 'A Player Event occurs!';
        if (outcome === 'discovery') outcomeText = 'A Discovery is made!';
        if (outcome === 'world_event') outcomeText = 'A World Event is triggered!';
        
        this.sendMessageToRoom(room.id, {
            channel: 'game', type: 'system',
            message: `${player.name} rolls for an event: ${roll}. Outcome: ${outcomeText}`
        });

        if (outcome === 'player_event' || outcome === 'discovery') {
            player.pendingEventChoice = { outcome, cardOptions };
        }

        socket.emit('eventRollResult', { roll, outcome, cardOptions });
        this.emitGameState(room.id);
    }

    selectEventCard(socket, { cardId }) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || !player.pendingEventChoice) return;

        const { outcome, cardOptions } = player.pendingEventChoice;
        const choice = cardOptions.find(c => c.id === cardId);
        if (!choice) return;

        if (outcome === 'player_event') {
            player.hand.push(choice);
            this.sendMessageToRoom(room.id, { channel: 'game', message: `${player.name} drew a Player Event card: ${choice.name}.` });
        } else if (outcome === 'discovery') {
            room.gameState.lootPool.push(choice);
            this.sendMessageToRoom(room.id, { channel: 'game', message: `The party made a Discovery: ${choice.name}!` });
        }
        
        player.pendingEventChoice = null;
        this.emitGameState(room.id);
    }
    
    rollForWorldEventSave(socket) {
        const room = this.findRoomBySocket(socket);
        const player = room?.players[socket.id];
        if (!player || !player.pendingWorldEventSave) return;

        const { dc, save } = player.pendingWorldEventSave;
        const playerClassStats = gameData.classes[player.class]?.stats;
        
        const d20Roll = Math.floor(Math.random() * 20) + 1;
        const bonus = playerClassStats ? (playerClassStats[save.toLowerCase()] || 0) : 0;
        const totalRoll = d20Roll + bonus;
        const success = totalRoll >= dc;
        
        const outcomeText = success ? 'SUCCESS' : 'FAILURE';
        this.sendMessageToRoom(room.id, {
            channel: 'game', type: 'system',
            message: `${player.name} rolls a save for ${player.pendingWorldEventSave.eventName}: ${d20Roll} + ${bonus} bonus = ${totalRoll} (vs DC ${dc}) - ${outcomeText}!`
        });

        player.pendingWorldEventSave = null;
        socket.emit('worldEventSaveResult', { d20Roll, bonus, totalRoll, dc, success });
        this.emitGameState(room.id);
    }

    // Voice Chat Handlers
    handleVoiceJoin(socket) {
        const room = this.findRoomBySocket(socket);
        if (!room) return;
        socket.emit('voice-peers', room.voiceChatPeers);
        socket.to(room.id).emit('voice-peer-join', { peerId: socket.id });
        room.voiceChatPeers.push(socket.id);
    }
    handleVoiceOffer(socket, data) {
        socket.to(data.toId).emit('voice-offer', { offer: data.offer, fromId: socket.id });
    }
    handleVoiceAnswer(socket, data) {
        socket.to(data.toId).emit('voice-answer', { answer: data.answer, fromId: socket.id });
    }
    handleVoiceIceCandidate(socket, data) {
        socket.to(data.toId).emit('voice-ice-candidate', { candidate: data.candidate, fromId: socket.id });
    }
}


// --- Socket.IO Connection Handling ---
const gameManager = new GameManager();

io.on('connection', (socket) => {
    socket.on('createRoom', (playerName) => gameManager.createRoom(socket, playerName));
    socket.on('joinRoom', (data) => gameManager.joinRoom(socket, data));
    socket.on('startGame', (data) => gameManager.startGame(socket, data));
    socket.on('chooseClass', (data) => gameManager.chooseClass(socket, data));
    socket.on('equipItem', (data) => gameManager.equipItem(socket, data));
    socket.on('sendMessage', (data) => gameManager.sendMessage(socket, data));
    socket.on('endTurn', () => gameManager.endTurn(socket));
    socket.on('playerAction', (data) => gameManager.handlePlayerAction(socket, data));
    socket.on('dmAction', (data) => gameManager.handleDmAction(socket, data));
    
    // Event Handlers
    socket.on('rollForEvent', () => gameManager.rollForEvent(socket));
    socket.on('selectEventCard', (data) => gameManager.selectEventCard(socket, data));
    socket.on('rollForWorldEventSave', () => gameManager.rollForWorldEventSave(socket));
    
    // Voice Chat
    socket.on('join-voice', () => gameManager.handleVoiceJoin(socket));
    socket.on('voice-offer', (data) => gameManager.handleVoiceOffer(socket, data));
    socket.on('voice-answer', (data) => gameManager.handleVoiceAnswer(socket, data));
    socket.on('voice-ice-candidate', (data) => gameManager.handleVoiceIceCandidate(socket, data));

    socket.on('disconnect', () => gameManager.disconnect(socket));
});


// --- Server Start ---
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});