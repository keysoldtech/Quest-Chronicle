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

    createRoom(socket, playerName) {
        const roomId = this.generateRoomId();
        const newPlayer = this.createPlayerObject(socket.id, playerName, 'DM');
        
        const newRoom = {
            id: roomId,
            players: { [socket.id]: newPlayer },
            voiceChatPeers: [],
            gameState: {
                phase: 'lobby',
                gameMode: null,
                decks: { item: [], spell: [], monster: [], weapon: [], armor: [], worldEvent: [] },
                turnOrder: [],
                currentPlayerIndex: -1,
                board: { monsters: [] },
                worldEvents: { currentSequence: [], sequenceActive: false },
                monstersDefeatedSinceLastTurn: false,
                advancedChoicesPending: [],
                combatState: {
                    isActive: false,
                    turnOrder: [],
                    currentTurnIndex: -1,
                    participants: {},
                }
            }
        };
        this.rooms[roomId] = newRoom;
        console.log(`[GameManager] Room ${roomId} created by ${playerName} (${socket.id}).`);
        return newRoom;
    }
    
    createPlayerObject(id, name, role = 'Player', isNpc = false) {
        return {
            id, name, role, isNpc,
            class: null,
            hand: [],
            equipment: { weapon: null, armor: null },
            stats: { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0 },
            lifeCount: 3,
            statusEffects: [],
            currentAp: 0,
        };
    }

    joinRoom(socket, roomId, playerName) {
        const room = this.rooms[roomId];
        if (room && Object.keys(room.players).length < 5) {
            room.players[socket.id] = this.createPlayerObject(socket.id, playerName);
            console.log(`[GameManager] ${playerName} (${socket.id}) joined room ${roomId}.`);
            return room;
        }
        return null;
    }
    
    // --- UTILITY METHODS ---
    rollDice(diceNotation) {
        const regex = /(\d+)d(\d+)([+-]\d+)?/;
        const match = diceNotation.match(regex);
        if (!match) return 0;
        const numDice = parseInt(match[1], 10);
        const numSides = parseInt(match[2], 10);
        const modifier = match[3] ? parseInt(match[3], 10) : 0;

        let total = 0;
        for (let i = 0; i < numDice; i++) {
            total += Math.floor(Math.random() * numSides) + 1;
        }
        return total + modifier;
    }
    
    calculatePlayerStats(playerId, room) {
        const player = room.players[playerId];
        if (!player || !player.class) {
            player.stats = { maxHp: 20, currentHp: 20, damageBonus: 0, shieldBonus: 0, ap: 2 };
            return;
        }

        const classData = gameData.classes[player.class];
        if (!classData) return;

        let stats = {
            damageBonus: classData.baseDamageBonus,
            shieldBonus: classData.baseShieldBonus,
            ap: classData.baseAp,
        };

        for (const slot in player.equipment) {
            const item = player.equipment[slot];
            if (item && item.bonuses) {
                stats.shieldBonus += item.bonuses.shield || 0;
                stats.ap += item.bonuses.ap || 0;
            }
        }
        
        // Per rulebook: Total HP = Base HP + Shield Bonus
        stats.maxHp = classData.baseHp + stats.shieldBonus;
        
        const oldMaxHp = player.stats.maxHp;
        player.stats = { ...player.stats, ...stats };
        
        if (player.stats.maxHp !== oldMaxHp) {
            const hpDiff = player.stats.maxHp - oldMaxHp;
            player.stats.currentHp = Math.max(0, player.stats.currentHp + hpDiff);
            if(oldMaxHp === 0) player.stats.currentHp = player.stats.maxHp;
        }
    }

    getPlayer(socketId) {
        for (const roomId in this.rooms) {
            if (this.rooms[roomId].players[socketId]) {
                return { player: this.rooms[roomId].players[socketId], room: this.rooms[roomId] };
            }
        }
        return null;
    }
    
    chooseClass(socketId, classId) {
        const result = this.getPlayer(socketId);
        if (result && result.player && gameData.classes[classId]) {
            result.player.class = classId;
            this.calculatePlayerStats(socketId, result.room);
            return result.room;
        }
        return null;
    }

    equipItem(socketId, cardId) {
        const result = this.getPlayer(socketId);
        if (!result) return null;
        const { player, room } = result;

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return null;

        const itemToEquip = player.hand[cardIndex];
        const itemType = itemToEquip.type.toLowerCase();

        if (itemType === 'weapon' || itemType === 'armor') {
            if (player.equipment[itemType]) {
                player.hand.push(player.equipment[itemType]);
            }
            player.equipment[itemType] = player.hand.splice(cardIndex, 1)[0];
            this.calculatePlayerStats(socketId, room);
            return room;
        }
        return null;
    }
    
    handleAdvancedCardChoice(roomId, playerId, cardType) {
        const room = this.rooms[roomId];
        const player = room.players[playerId];
        if (!room || !player || room.gameState.phase !== 'advanced_setup_choice') return null;
        
        const deckName = cardType.toLowerCase();
        if (room.gameState.decks[deckName] && room.gameState.decks[deckName].length > 0) {
            player.hand.push(room.gameState.decks[deckName].pop());
            const choiceIndex = room.gameState.advancedChoicesPending.indexOf(playerId);
            if (choiceIndex > -1) {
                room.gameState.advancedChoicesPending.splice(choiceIndex, 1);
            }
            if (room.gameState.advancedChoicesPending.length === 0) {
                this.transitionToWorldEventSetup(room);
            }
            return room;
        }
        return null;
    }

    transitionToWorldEventSetup(room) {
        room.gameState.phase = 'world_event_setup';
        const dm = Object.values(room.players).find(p => p.role === 'DM');
        if (dm && dm.isNpc) {
            setTimeout(() => this.executeNpcTurn(room.id, dm.id), 1500);
        }
    }

    removePlayer(socket) {
        for (const roomId in this.rooms) {
            const room = this.rooms[roomId];
            if (room.players[socket.id]) {
                const playerName = room.players[socket.id].name;
                delete room.players[socket.id];
                console.log(`[GameManager] ${playerName} (${socket.id}) removed from room ${roomId}.`);
                // Also remove from combat if active
                if(room.gameState.combatState.isActive) {
                    room.gameState.combatState.turnOrder = room.gameState.combatState.turnOrder.filter(id => id !== socket.id);
                    delete room.gameState.combatState.participants[socket.id];
                }

                if (Object.keys(room.players).filter(id => !room.players[id].isNpc).length === 0) {
                    delete this.rooms[roomId];
                    console.log(`[GameManager] Room ${roomId} is empty and has been deleted.`);
                }
                return { roomId, playerName, remainingPlayers: room.players };
            }
        }
        return null;
    }
    
    startGame(roomId, gameMode) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.phase !== 'lobby') return false;
        
        room.gameState.gameMode = gameMode;
        
        const humanPlayerIds = Object.keys(room.players).filter(id => !room.players[id].isNpc);
        if (humanPlayerIds.length === 5) {
            shuffle(humanPlayerIds);
            room.players[humanPlayerIds[0]].role = 'DM';
            for(let i = 1; i < humanPlayerIds.length; i++) room.players[humanPlayerIds[i]].role = 'Explorer';
        } else {
            const npcDmId = 'npc-dm';
            room.players[npcDmId] = this.createPlayerObject(npcDmId, 'NPC Dungeon Master', 'DM', true);
            humanPlayerIds.forEach(id => room.players[id].role = 'Explorer');
            const explorersToCreate = 4 - humanPlayerIds.length;
            for (let i = 0; i < explorersToCreate; i++) {
                const npcExplorerId = `npc-explorer-${i+1}`;
                room.players[npcExplorerId] = this.createPlayerObject(npcExplorerId, `NPC Explorer #${i+1}`, 'Explorer', true);
            }
        }

        const classIds = Object.keys(gameData.classes);
        Object.values(room.players).forEach(player => {
            if(player.role === 'Explorer' && !player.class) {
                player.class = classIds[Math.floor(Math.random() * classIds.length)];
            }
            this.calculatePlayerStats(player.id, room);
        });

        room.gameState.decks = {
            item: [...gameData.itemCards], spell: [...gameData.spellCards], monster: [...gameData.monsterCards],
            weapon: [...gameData.weaponCards], armor: [...gameData.armorCards], worldEvent: [...gameData.worldEventCards]
        };
        Object.values(room.gameState.decks).forEach(deck => shuffle(deck));
        
        const dmId = Object.keys(room.players).find(id => room.players[id].role === 'DM');

        if (gameMode === 'Beginner') {
             Object.values(room.players).filter(p => p.role === 'Explorer').forEach(p => {
                const weapon = room.gameState.decks.weapon.pop();
                const armor = room.gameState.decks.armor.pop();
                if(weapon) this.equipItem(p.id, weapon.id, true); // Equip directly
                if(armor) this.equipItem(p.id, armor.id, true); // Equip directly
                if(room.gameState.decks.spell.length > 0) p.hand.push(room.gameState.decks.spell.pop());
            });
            this.transitionToWorldEventSetup(room);
        } else if (gameMode === 'Advanced') {
            room.gameState.phase = 'advanced_setup_choice';
            const explorerIds = Object.keys(room.players).filter(id => room.players[id].role === 'Explorer');
            room.gameState.advancedChoicesPending = explorerIds.filter(id => !room.players[id].isNpc);
            if (room.gameState.advancedChoicesPending.length === 0) { // All explorers are NPCs
                 explorerIds.forEach(id => {
                     if(room.gameState.decks.item.length > 0) room.players[id].hand.push(room.gameState.decks.item.pop());
                 });
                 this.transitionToWorldEventSetup(room);
            }
        }
        
        for (let i = 0; i < 5; i++) {
            if (room.gameState.decks.monster.length > 0) room.players[dmId].hand.push(room.gameState.decks.monster.pop());
        }

        Object.keys(room.players).forEach(id => this.calculatePlayerStats(id, room));
        return room;
    }
    
    // --- COMBAT LOGIC ---

    initializeCombat(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.combatState.isActive) return;

        io.to(roomId).emit('chatMessage', { senderName: 'System', message: 'Combat has begun! Rolling for initiative...', channel: 'game' });

        const combatants = [];
        Object.values(room.players).filter(p => p.role === 'Explorer' && p.stats.currentHp > 0).forEach(p => {
            combatants.push({ id: p.id, isPlayer: true, initiative: this.rollDice('1d20') });
        });
        room.gameState.board.monsters.forEach(m => {
            combatants.push({ id: m.id, isPlayer: false, initiative: this.rollDice('1d20') });
        });
        
        combatants.sort((a, b) => b.initiative - a.initiative);

        room.gameState.combatState = {
            isActive: true,
            turnOrder: combatants.map(c => c.id),
            currentTurnIndex: 0,
            participants: combatants.reduce((acc, c) => { acc[c.id] = c; return acc; }, {})
        };
        
        this.startTurn(roomId);
    }
    
    startTurn(roomId) {
        const room = this.rooms[roomId];
        const combatState = room.gameState.combatState;
        if (!combatState.isActive) return;

        const currentId = combatState.turnOrder[combatState.currentTurnIndex];
        const isPlayer = combatState.participants[currentId]?.isPlayer;
        
        let combatant;
        let name;

        if (isPlayer) {
            combatant = room.players[currentId];
            name = combatant.name;
            combatant.currentAp = combatant.stats.ap;
        } else {
            combatant = room.gameState.board.monsters.find(m => m.id === currentId);
            name = combatant.name;
            combatant.currentAp = combatant.ap;
        }
        
        io.to(roomId).emit('chatMessage', { senderName: 'System', message: `It's ${name}'s turn!`, channel: 'game' });
        io.to(roomId).emit('gameStateUpdate', room);

        if (!isPlayer) {
            setTimeout(() => this.executeNpcTurn(roomId, currentId), 2000);
        }
    }
    
    nextTurn(roomId) {
        const room = this.rooms[roomId];
        const combatState = room.gameState.combatState;
        if (!combatState.isActive) return;

        // Check for combat end conditions
        const explorersAlive = Object.values(room.players).some(p => p.role === 'Explorer' && p.stats.currentHp > 0);
        const monstersAlive = room.gameState.board.monsters.length > 0;
        
        if (!explorersAlive || !monstersAlive) {
            this.endCombat(roomId, explorersAlive);
            return;
        }

        combatState.currentTurnIndex = (combatState.currentTurnIndex + 1) % combatState.turnOrder.length;
        this.startTurn(roomId);
    }
    
    endCombat(roomId, explorersWon) {
        const room = this.rooms[roomId];
        room.gameState.combatState.isActive = false;
        const message = explorersWon ? "The monsters have been defeated! You are victorious!" : "The party has fallen. The darkness prevails.";
        io.to(roomId).emit('chatMessage', { senderName: 'System', message, channel: 'game' });
        io.to(roomId).emit('gameStateUpdate', room);
    }

    resolveAttack(roomId, attackerId, targetId, card) {
        const room = this.rooms[roomId];
        const isAttackerPlayer = room.gameState.combatState.participants[attackerId]?.isPlayer;
        const isTargetPlayer = room.gameState.combatState.participants[targetId]?.isPlayer;

        const attacker = isAttackerPlayer ? room.players[attackerId] : room.gameState.board.monsters.find(m => m.id === attackerId);
        const target = isTargetPlayer ? room.players[targetId] : room.gameState.board.monsters.find(m => m.id === targetId);

        if (!attacker || !target) return;

        const roll = this.rollDice('1d20');
        let message = '';
        
        if (roll === 1) {
            message = `${attacker.name} attacks ${target.name}... It's a critical miss! The attack fails spectacularly.`;
            io.to(roomId).emit('chatMessage', { senderName: 'Combat', message, channel: 'game' });
            return;
        }
        
        const attackBonus = isAttackerPlayer ? attacker.stats.damageBonus : attacker.attackBonus;
        const totalRoll = roll + attackBonus;
        const requiredRoll = isTargetPlayer ? 10 + target.stats.shieldBonus : target.requiredRollToHit;

        if (totalRoll >= requiredRoll || roll === 20) {
            let damageDice = card?.damageDice || attacker.damageDice || '1d4';
            let damage = this.rollDice(damageDice);
            if (roll === 20) {
                damage += this.rollDice(damageDice); // Roll damage dice again for crit
                message = `${attacker.name} lands a CRITICAL HIT on ${target.name} for ${damage} damage!`;
            } else {
                message = `${attacker.name} hits ${target.name} for ${damage} damage.`;
            }
            this.applyDamage(roomId, targetId, damage);
        } else {
            message = `${attacker.name}'s attack misses ${target.name}.`;
        }
        io.to(roomId).emit('chatMessage', { senderName: 'Combat', message, channel: 'game' });
    }

    applyDamage(roomId, targetId, damageAmount) {
        const room = this.rooms[roomId];
        const isPlayer = room.gameState.combatState.participants[targetId]?.isPlayer;
        
        if (isPlayer) {
            const player = room.players[targetId];
            const wasDown = player.stats.currentHp <= 0;
            player.stats.currentHp -= damageAmount;

            if (player.stats.currentHp <= 0) {
                if (wasDown) {
                    player.lifeCount--;
                    io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${player.name} suffers a grievous wound while downed and loses a life! ${player.lifeCount} lives remaining.`, channel: 'game' });
                } else {
                     io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${player.name} has been downed!`, channel: 'game' });
                }
                if (player.lifeCount <= 0) {
                     io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${player.name} has fallen in battle!`, channel: 'game' });
                }
            }
        } else {
            const monster = room.gameState.board.monsters.find(m => m.id === targetId);
            monster.currentHp -= damageAmount;
            if (monster.currentHp <= 0) {
                room.gameState.board.monsters = room.gameState.board.monsters.filter(m => m.id !== targetId);
                room.gameState.combatState.turnOrder = room.gameState.combatState.turnOrder.filter(id => id !== targetId);
                io.to(roomId).emit('chatMessage', { senderName: 'Combat', message: `${monster.name} has been defeated!`, channel: 'game' });
            }
        }
    }
    
    handlePlayerAction(roomId, playerId, { action, targetId, cardId }) {
        const room = this.rooms[roomId];
        const player = room.players[playerId];
        const combatState = room.gameState.combatState;

        if (!combatState.isActive || combatState.turnOrder[combatState.currentTurnIndex] !== playerId) {
            return { error: "It's not your turn!" };
        }

        let apCost = 1; // Default AP cost
        let card = cardId ? player.hand.find(c => c.id === cardId) : null;
        if(card && card.apCost) apCost = card.apCost;

        if (player.currentAp < apCost) return { error: "Not enough Action Points!" };
        
        player.currentAp -= apCost;
        
        switch(action) {
            case 'attack':
                const weapon = player.equipment.weapon;
                if (!weapon) return { error: "You have no weapon equipped!" };
                this.resolveAttack(roomId, playerId, targetId, weapon);
                break;
            case 'castSpell':
                if (!card) return { error: "Spell card not found in hand." };
                this.resolveAttack(roomId, playerId, targetId, card); // Spells use attack resolution logic
                // Remove card from hand after casting
                player.hand = player.hand.filter(c => c.id !== cardId);
                break;
            case 'guard':
                 io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${player.name} takes a defensive stance.`, channel: 'game' });
                 break; // Stub
            case 'useItem':
                if (!card) return { error: "Item not found in hand."};
                // Example: healing potion
                if (card.healDice) {
                    const healing = this.rollDice(card.healDice);
                    const targetPlayer = room.players[targetId];
                    if (targetPlayer) {
                        targetPlayer.stats.currentHp = Math.min(targetPlayer.stats.maxHp, targetPlayer.stats.currentHp + healing);
                        io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${player.name} uses ${card.name} on ${targetPlayer.name}, healing for ${healing} HP!`, channel: 'game' });
                    }
                }
                player.hand = player.hand.filter(c => c.id !== cardId);
                break;
            // Other actions can be added here...
            default:
                player.currentAp += apCost; // Refund AP for invalid action
                return { error: "Invalid action." };
        }
        
        io.to(roomId).emit('gameStateUpdate', room);
        return { room };
    }
    
    // --- NPC AND GAME FLOW ---
    
    endTurn(roomId, playerId) {
        const room = this.rooms[roomId];
        if (!room) return;

        if(room.gameState.combatState.isActive) {
            if(combatState.turnOrder[combatState.currentTurnIndex] !== playerId) return;
            this.nextTurn(roomId);
        } else {
             // Old non-combat turn logic can go here if needed
        }
        return room;
    }

    executeNpcTurn(roomId, npcId) {
        const room = this.rooms[roomId];
        const combatState = room.gameState.combatState;
        
        // COMBAT AI
        if(combatState.isActive) {
            const monster = room.gameState.board.monsters.find(m => m.id === npcId);
            if (!monster) return;

            const livingExplorers = Object.values(room.players).filter(p => p.role === 'Explorer' && p.stats.currentHp > 0);
            if(livingExplorers.length > 0) {
                // Basic AI: Target lowest HP player
                livingExplorers.sort((a,b) => a.stats.currentHp - b.stats.currentHp);
                const target = livingExplorers[0];
                this.resolveAttack(roomId, npcId, target.id, monster);
            }
            this.nextTurn(roomId);
            return;
        }

        // NON-COMBAT NPC LOGIC
        const npc = room.players[npcId];
        if (!room || !npc || !npc.isNpc) return;

        let message = '';

        if (npc.role === 'DM') {
            if (room.gameState.phase === 'world_event_setup') {
                const eventCard = room.gameState.decks.worldEvent.pop();
                if (eventCard) {
                    this.playCard(roomId, npcId, eventCard.id, null);
                    message = `The NPC DM begins the story with a world event: ${eventCard.name}!`;
                }
            } else if (room.gameState.board.monsters.length === 0) {
                let monsterCard = room.gameState.decks.monster.pop();
                if (monsterCard) {
                    this.playCard(roomId, npcId, monsterCard.id, null);
                    message = `A new challenger appears! The NPC DM summons a ${monsterCard.name}!`;
                }
            }
        }
        
        if (message) io.to(room.id).emit('chatMessage', { senderName: 'System', message, channel: 'game' });
        io.to(roomId).emit('gameStateUpdate', room);
    }
    
    playCard(roomId, playerId, cardId, targetId) {
        const room = this.rooms[roomId];
        const player = room.players[playerId];
        if (!room || !player) return { error: "Invalid action." };
        
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        const card = cardIndex > -1 ? player.hand[cardIndex] : (player.isNpc ? {id: cardId, ...Object.values(gameData).flat().find(c => c.id === cardId)} : null);
        if (!card) return { error: "Card not found." };
        
        if (card.type === 'Monster') {
            if (cardIndex > -1) player.hand.splice(cardIndex, 1);
            const monsterData = { ...card, currentHp: card.maxHp, id: `${card.id}-${Math.random()}` }; // Ensure unique ID for multiple monsters
            room.gameState.board.monsters.push(monsterData);
            io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${player.name} summons a ${monsterData.name}!`, channel: 'game' });
            if (!room.gameState.combatState.isActive) {
                this.initializeCombat(roomId);
            }
        } else if (card.type === 'World Event') {
            if (cardIndex > -1) player.hand.splice(cardIndex, 1);
            room.gameState.worldEvents.currentSequence = [card];
             if (room.gameState.phase === 'world_event_setup') {
                room.gameState.phase = 'active';
            }
        } else if (card.category === 'Damage' || card.category === 'Healing') {
             // Route to action system instead of direct effect
             const action = card.type === 'Spell' ? 'castSpell' : 'useItem';
             return this.handlePlayerAction(roomId, playerId, { action, targetId, cardId });
        }
        
        io.to(roomId).emit('gameStateUpdate', room);
        return { room };
    }
}

const gameManager = new GameManager();

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`[Socket.IO] A user connected: ${socket.id}`);

    socket.on('createRoom', (playerName) => {
        const room = gameManager.createRoom(socket, playerName);
        socket.join(room.id);
        socket.emit('roomCreated', room);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const upperRoomId = roomId.toUpperCase();
        const room = gameManager.joinRoom(socket, upperRoomId, playerName);
        if (room) {
            socket.join(upperRoomId);
            socket.emit('joinSuccess', room);
            io.to(room.id).emit('playerListUpdate', room);
        } else {
            socket.emit('actionError', 'Room not found or is full.');
        }
    });

    socket.on('chooseClass', ({ classId }) => {
        const updatedRoom = gameManager.chooseClass(socket.id, classId);
        if (updatedRoom) {
            io.to(updatedRoom.id).emit('playerListUpdate', updatedRoom);
        }
    });
    
    socket.on('equipItem', ({ cardId }) => {
        const updatedRoom = gameManager.equipItem(socket.id, cardId);
        if(updatedRoom) {
            io.to(updatedRoom.id).emit('gameStateUpdate', updatedRoom);
            const player = updatedRoom.players[socket.id];
            const card = player.equipment.weapon?.id === cardId ? player.equipment.weapon : player.equipment.armor;
            io.to(updatedRoom.id).emit('chatMessage', { senderName: 'System', message: `${player.name} equipped ${card.name}.`, channel: 'game' });
        }
    });

    socket.on('sendMessage', ({ channel, message }) => {
        const result = gameManager.getPlayer(socket.id);
        if (!result) return; 
        const { player, room } = result;
        const messagePayload = { senderName: player.name, message, channel };
        io.to(room.id).emit('chatMessage', messagePayload);
    });
    
    socket.on('startGame', ({ gameMode }) => {
        const result = gameManager.getPlayer(socket.id);
        if (result && (result.player.role === 'DM' || Object.keys(result.room.players).length === 1)) {
            const room = gameManager.startGame(result.room.id, gameMode);
            if(room) {
                io.to(room.id).emit('gameStarted', room);
                io.to(room.id).emit('chatMessage', { senderName: 'System', message: `${result.player.name} has started the game in ${gameMode} mode! Roles & classes assigned.`, channel: 'game' });
            }
        }
    });
    
    socket.on('advancedCardChoice', ({ cardType }) => {
        const result = gameManager.getPlayer(socket.id);
        if (result) {
            const updatedRoom = gameManager.handleAdvancedCardChoice(result.room.id, socket.id, cardType);
            if (updatedRoom) io.to(updatedRoom.id).emit('gameStateUpdate', updatedRoom);
        }
    });
    
    socket.on('playCard', ({ cardId, targetId }) => {
        const result = gameManager.getPlayer(socket.id);
        if (result) {
            const { error } = gameManager.playCard(result.room.id, socket.id, cardId, targetId);
            if (error) socket.emit('actionError', error);
        }
    });

    socket.on('playerAction', (actionData) => {
        const result = gameManager.getPlayer(socket.id);
        if (result) {
            const { error } = gameManager.handlePlayerAction(result.room.id, socket.id, actionData);
            if(error) socket.emit('actionError', error);
        }
    });
    
    socket.on('endTurn', () => {
        const result = gameManager.getPlayer(socket.id);
        if (result) {
            const room = gameManager.endTurn(result.room.id, socket.id);
            if (room) {
                 io.to(room.id).emit('chatMessage', { senderName: 'System', message: `${result.player.name} ended their turn.`, channel: 'game' });
            }
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`[Socket.IO] User disconnected: ${socket.id}`);
        const result = gameManager.removePlayer(socket);
        if (result && result.remainingPlayers && Object.keys(result.remainingPlayers).length > 0) {
            io.to(result.roomId).emit('playerLeft', { room: { players: result.remainingPlayers, ...result } });
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
