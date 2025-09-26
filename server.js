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
        const roomId = this.generateRoomId();
        const newPlayer = this.createPlayerObject(socket.id, playerName, 'DM');
        
        const newRoom = {
            id: roomId,
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
                worldEvents: { currentSequence: [], sequenceActive: false },
                monstersDefeatedSinceLastTurn: false,
                advancedChoicesPending: [],
                combatState: {
                    isActive: false,
                    turnOrder: [],
                    currentTurnIndex: -1,
                    participants: {},
                },
                turnCount: 0,
                monstersKilledCount: 0,
                gameStage: 1,
            }
        };
        this.rooms[roomId] = newRoom;
        console.log(`[GameManager] Room ${roomId} created by ${playerName} (${socket.id}).`);
        return newRoom;
    }
    
    createPlayerObject(id, name, role = 'Explorer', isNpc = false) {
        return {
            id, name, role, isNpc,
            class: null,
            hand: [],
            equipment: { weapon: null, armor: null },
            stats: { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0 },
            lifeCount: 3,
            healthDice: { max: 0, current: 0 },
            statusEffects: [], // e.g., { name: 'Poisoned', duration: 3 }
            currentAp: 0,
            pendingEventRoll: false,
            pendingEventChoice: false,
        };
    }

    joinRoom(socket, roomId, playerName) {
        const room = this.rooms[roomId];
        if (!room) {
            console.log(`[GameManager] Join failed: Room ${roomId} not found.`);
            return null;
        }
        if (Object.keys(room.players).length >= 5) {
            console.log(`[GameManager] Join failed: Room ${roomId} is full.`);
            return null;
        }
        
        room.players[socket.id] = this.createPlayerObject(socket.id, playerName);
        console.log(`[GameManager] ${playerName} (${socket.id}) joined room ${roomId}.`);
        return room;
    }
    
    getRoomBySocketId(socketId) {
        for (const roomId in this.rooms) {
            if (this.rooms[roomId].players[socketId]) {
                return this.rooms[roomId];
            }
        }
        return null;
    }

    // --- UTILITY METHODS ---
    rollDice(diceNotation) {
        if (!diceNotation) return 0;
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
    
    getRandomDialogue(category, subcategory) {
        const phrases = gameData.npcDialogue?.[category]?.[subcategory];
        if (phrases && phrases.length > 0) {
            return phrases[Math.floor(Math.random() * phrases.length)];
        }
        return '';
    }
    
    broadcastToRoom(roomId, event, data) {
        io.to(roomId).emit(event, data);
    }
    
    calculatePlayerStats(playerId, room) {
        const player = room.players[playerId];
        if (!player || !player.class) {
            player.stats = { maxHp: 20, currentHp: 20, damageBonus: 0, shieldBonus: 0, ap: 3 };
            return;
        }
    
        const classData = gameData.classes[player.class];
        let damageBonus = classData.baseDamageBonus;
        let shieldBonus = classData.baseShieldBonus;
        let ap = classData.baseAp;
    
        // Add bonuses from equipment
        if (player.equipment.weapon && player.equipment.weapon.effect.bonuses) {
            damageBonus += player.equipment.weapon.effect.bonuses.damage || 0;
        }
        if (player.equipment.armor && player.equipment.armor.effect.bonuses) {
            shieldBonus += player.equipment.armor.effect.bonuses.shield || 0;
            ap += player.equipment.armor.effect.bonuses.ap || 0;
        }
        
        const oldMaxHp = player.stats.maxHp;
        const newMaxHp = classData.baseHp;

        player.stats = {
            maxHp: newMaxHp,
            currentHp: player.stats.currentHp > 0 ? (player.stats.currentHp + (newMaxHp - oldMaxHp)) : newMaxHp,
            damageBonus,
            shieldBonus,
            ap
        };
        
        player.healthDice = {
            max: classData.healthDice,
            current: player.healthDice.current > 0 ? player.healthDice.current : classData.healthDice,
        };
    }
    
    // --- CORE GAME LOGIC ---
    startGame(dmId, gameMode) {
        const room = this.getRoomBySocketId(dmId);
        if (!room || room.players[dmId].role !== 'DM' || room.gameState.phase !== 'lobby') return;

        room.gameState.gameMode = gameMode;
        
        // Assign stats and initialize players
        Object.values(room.players).forEach(p => {
            if(p.role !== 'DM') this.calculatePlayerStats(p.id, room);
        });

        // Create turn order (DM not included)
        room.gameState.turnOrder = Object.values(room.players)
            .filter(p => p.role !== 'DM')
            .map(p => p.id);
        shuffle(room.gameState.turnOrder);
        
        const allCards = [
            ...gameData.itemCards,
            ...gameData.spellCards,
            ...gameData.weaponCards,
            ...gameData.armorCards,
        ];
        
        if (gameMode === 'Beginner') {
            Object.values(room.players).forEach(player => {
                if (player.role !== 'DM' && player.class) {
                    const classSpecificDeck = allCards.filter(card => {
                        if (!card.class || card.class === 'Any') return true;
                        if (Array.isArray(card.class)) return card.class.includes(player.class);
                        return card.class === player.class;
                    });
                    
                    if (classSpecificDeck.length > 0) {
                        shuffle(classSpecificDeck);
                        const cardToDraw = classSpecificDeck.pop();
                        player.hand.push({ ...cardToDraw, id: this.generateUniqueCardId() });
                    }
                }
            });
            room.gameState.phase = 'active';
            this.startNextTurn(room.id);
        } else if (gameMode === 'Advanced') {
            room.gameState.phase = 'advanced_setup_choice';
        }
        
        this.broadcastToRoom(room.id, 'gameStarted', room);
    }
    
    handleAdvancedCardChoice(socketId, cardType) {
        const room = this.getRoomBySocketId(socketId);
        const player = room.players[socketId];
        if (!room || !player || room.gameState.phase !== 'advanced_setup_choice') return;

        let potentialCards = [];
        if (cardType === 'Weapon') potentialCards = gameData.weaponCards;
        else if (cardType === 'Armor') potentialCards = gameData.armorCards;
        else if (cardType === 'Spell') potentialCards = gameData.spellCards;
        
        const classSpecificDeck = potentialCards.filter(card => {
            if (!card.class || card.class === 'Any') return true;
            if (Array.isArray(card.class)) return card.class.includes(player.class);
            return card.class === player.class;
        });
        
        if (classSpecificDeck.length > 0) {
            shuffle(classSpecificDeck);
            player.hand.push({ ...classSpecificDeck.pop(), id: this.generateUniqueCardId() });
        }
        
        player.madeAdvancedChoice = true;
        
        const allExplorersMadeChoice = Object.values(room.players)
            .filter(p => p.role !== 'DM')
            .every(p => p.madeAdvancedChoice);
            
        if (allExplorersMadeChoice) {
            room.gameState.phase = 'active';
            this.startNextTurn(room.id);
        }
        
        this.broadcastToRoom(room.id, 'gameStateUpdate', room);
    }

    startNextTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room) return;
        
        if (room.gameState.combatState.isActive) {
             // Combat turn logic handled by endTurn
        } else {
            room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
            const currentPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
            const currentPlayer = room.players[currentPlayerId];
            
            if (room.gameState.currentPlayerIndex === 0) {
                room.gameState.turnCount++;
            }
            
            // Random event check every 3 explorer turns
            if (room.gameState.turnCount > 0 && room.gameState.turnCount % 3 === 0 && room.gameState.currentPlayerIndex === 0) {
                 Object.values(room.players).forEach(p => p.pendingEventRoll = (p.role !== 'DM'));
            }
            
            // Reset AP
            currentPlayer.currentAp = currentPlayer.stats.ap;
        }

        this.broadcastToRoom(roomId, 'gameStateUpdate', room);
    }
    
    endTurn(socketId) {
        const room = this.getRoomBySocketId(socketId);
        if (!room) return;
        
        const isCombat = room.gameState.combatState.isActive;
        const currentTurnTakerId = isCombat ? room.gameState.combatState.turnOrder[room.gameState.combatState.currentTurnIndex] : room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        
        if (socketId !== currentTurnTakerId) return; // Not their turn
        
        if (isCombat) {
             room.gameState.combatState.currentTurnIndex = (room.gameState.combatState.currentTurnIndex + 1) % room.gameState.combatState.turnOrder.length;
        } else {
            this.startNextTurn(room.id);
        }
        this.broadcastToRoom(room.id, 'gameStateUpdate', room);
    }
    
    resolveAttack(roomId, attacker, target, weapon) {
        const room = this.rooms[roomId];
        const attackRoll = this.rollDice('1d20') + attacker.stats.damageBonus;
        
        const damageDice = weapon.effect.dice;
        const damageRoll = this.rollDice(damageDice) + attacker.stats.damageBonus;
        
        let message = '';
        
        if (attackRoll >= target.requiredRollToHit) {
            target.currentHp -= damageRoll;
            message = `${attacker.name} rolls a ${attackRoll} to hit... Success! They roll a ${damageRoll} on their ${damageDice}, dealing ${damageRoll} damage to ${target.name}.`;
            if (target.currentHp <= 0) {
                message += ` ${target.name} has been defeated!`;
                // Handle monster death, remove from board etc.
                room.gameState.board.monsters = room.gameState.board.monsters.filter(m => m.id !== target.id);
            }
        } else {
            message = `${attacker.name} rolls a ${attackRoll} to hit... Miss!`;
        }
        
        this.broadcastToRoom(roomId, 'chatMessage', { senderName: 'Game Master', message, channel: 'game' });
        // Send data for animation
        io.to(attacker.id).emit('attackAnimation', { damageDice, damageRoll });
        this.broadcastToRoom(roomId, 'gameStateUpdate', room);
    }

    rollForEvent(socketId) {
        const room = this.getRoomBySocketId(socketId);
        const player = room.players[socketId];
        if (!player || !player.pendingEventRoll) return;

        player.pendingEventRoll = false;
        const roll = this.rollDice('1d20');
        this.broadcastToRoom(room.id, 'chatMessage', { senderName: 'Game Master', message: `${player.name} rolled a ${roll} for an event...`, channel: 'game' });
        
        let outcome = 'none';
        if (roll >= 15) outcome = 'discovery';
        else if (roll >= 10) outcome = 'playerEvent';

        if (outcome !== 'none') {
            player.pendingEventChoice = true;
            let deck;

            if (outcome === 'discovery') {
                const allDiscoveryCards = [...room.gameState.decks.discovery];
                const classSpecificDeck = allDiscoveryCards.filter(card => {
                    if (!card.class || card.class === 'Any') return true;
                    if (Array.isArray(card.class)) return card.class.includes(player.class);
                    return card.class === player.class;
                });
                // Use specific deck if it has enough cards, otherwise fallback to the full deck
                deck = classSpecificDeck.length >= 3 ? classSpecificDeck : allDiscoveryCards;
            } else { // playerEvent
                deck = [...room.gameState.decks.playerEvent];
            }
            
            shuffle(deck);
            const cardOptions = deck.slice(0, 3).map(c => ({...c, id: this.generateUniqueCardId() }));
            io.to(socketId).emit('eventRollResult', { roll, outcome, cardOptions });
        } else {
            io.to(socketId).emit('eventRollResult', { roll, outcome });
        }
        this.broadcastToRoom(room.id, 'gameStateUpdate', room);
    }
    
    selectEventCard(socketId, chosenCardId) {
        const room = this.getRoomBySocketId(socketId);
        const player = room.players[socketId];
        if (!player || !player.pendingEventChoice) return;
        
        player.pendingEventChoice = false;

        const allEventCards = [...gameData.playerEventCards, ...gameData.discoveryCards];
        const chosenCardTemplate = allEventCards.find(c => c.id === chosenCardId.split('-')[0] || c.name === allEventCards.find(c2 => c2.id === chosenCardId)?.name); // A bit fuzzy matching
        const chosenCard = { ...chosenCardTemplate, id: chosenCardId };

        if (!chosenCard) return;

        io.to(socketId).emit('eventCardReveal', { chosenCard });

        if (chosenCard.type === 'Player Event') {
            // Resolve event immediately
            this.broadcastToRoom(room.id, 'chatMessage', { senderName: 'Game Master', message: `${player.name} triggered a Player Event: ${chosenCard.name}! ${chosenCard.description}`, channel: 'game' });
            // Apply effect (simplified)
            if (chosenCard.effect.type === 'heal') player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + this.rollDice(chosenCard.effect.dice));
            if (chosenCard.effect.type === 'damage') player.stats.currentHp -= this.rollDice(chosenCard.effect.dice);
        } else { // Discovery
            player.hand.push(chosenCard);
            this.broadcastToRoom(room.id, 'chatMessage', { senderName: 'Game Master', message: `${player.name} made a discovery! A new item has been found!`, channel: 'game' });
        }

        setTimeout(() => this.broadcastToRoom(room.id, 'gameStateUpdate', room), 4000); // Wait for client to see card
    }
}

const gameManager = new GameManager();

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`[Socket.IO] User connected: ${socket.id}`);

    socket.on('createRoom', (playerName) => {
        const room = gameManager.createRoom(socket, playerName);
        socket.join(room.id);
        socket.emit('roomCreated', room);
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const room = gameManager.joinRoom(socket, roomId.toUpperCase(), playerName);
        if (room) {
            socket.join(roomId.toUpperCase());
            socket.emit('joinSuccess', room);
            io.to(roomId.toUpperCase()).emit('playerListUpdate', room);
        } else {
            socket.emit('actionError', 'Could not join room.');
        }
    });
    
    socket.on('chooseClass', ({ classId }) => {
        const room = gameManager.getRoomBySocketId(socket.id);
        if (room && room.players[socket.id]) {
            room.players[socket.id].class = classId;
            gameManager.calculatePlayerStats(socket.id, room);
            io.to(room.id).emit('playerListUpdate', room);
        }
    });
    
    socket.on('startGame', ({ gameMode }) => {
        const room = gameManager.getRoomBySocketId(socket.id);
        if(room && room.players[socket.id].role === 'DM') {
            gameManager.startGame(socket.id, gameMode);
        }
    });

    socket.on('advancedCardChoice', ({ cardType }) => {
        gameManager.handleAdvancedCardChoice(socket.id, cardType);
    });

    socket.on('sendMessage', ({ channel, message }) => {
        const room = gameManager.getRoomBySocketId(socket.id);
        const sender = room.players[socket.id];
        if (room && sender) {
            io.to(room.id).emit('chatMessage', { senderName: sender.name, message, channel });
        }
    });
    
    socket.on('endTurn', () => {
        gameManager.endTurn(socket.id);
    });
    
    socket.on('playerAction', (data) => {
        const room = gameManager.getRoomBySocketId(socket.id);
        const player = room.players[socket.id];
        if (!room || !player) return;

        if (data.action === 'attack') {
             const target = room.gameState.board.monsters.find(m => m.id === data.targetId);
             const weapon = player.equipment.weapon;
             if(target && weapon) {
                 gameManager.resolveAttack(room.id, player, target, weapon);
                 io.to(room.id).emit('chatMessage', { senderName: player.name, message: data.narrative, channel: 'game', isNarrative: true });
             }
        }
    });
    
    socket.on('equipItem', ({ cardId }) => {
        const room = gameManager.getRoomBySocketId(socket.id);
        const player = room.players[socket.id];
        if (!room || !player) return;

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;
        
        const cardToEquip = player.hand[cardIndex];
        const itemType = cardToEquip.type.toLowerCase(); // 'weapon' or 'armor'
        
        // Unequip current item if one exists and move it to hand
        if (player.equipment[itemType]) {
            player.hand.push(player.equipment[itemType]);
        }
        
        // Equip new item
        player.equipment[itemType] = cardToEquip;
        player.hand.splice(cardIndex, 1);
        
        gameManager.calculatePlayerStats(socket.id, room);
        io.to(room.id).emit('gameStateUpdate', room);
    });
    
    socket.on('rollForEvent', () => {
        gameManager.rollForEvent(socket.id);
    });
    
    socket.on('selectEventCard', ({ cardId }) => {
        gameManager.selectEventCard(socket.id, cardId);
    });

    // --- Voice Chat Handling ---
    socket.on('join-voice', () => {
        const room = gameManager.getRoomBySocketId(socket.id);
        if (room) {
            const peers = room.voiceChatPeers;
            socket.emit('voice-peers', peers);
            peers.push(socket.id);
            socket.to(room.id).emit('voice-peer-join', { peerId: socket.id });
        }
    });
    socket.on('voice-offer', ({ offer, toId }) => socket.to(toId).emit('voice-offer', { offer, fromId: socket.id }));
    socket.on('voice-answer', ({ answer, toId }) => socket.to(toId).emit('voice-answer', { answer, fromId: socket.id }));
    socket.on('voice-ice-candidate', ({ candidate, toId }) => socket.to(toId).emit('voice-ice-candidate', { candidate, fromId: socket.id }));

    socket.on('disconnect', () => {
        console.log(`[Socket.IO] User disconnected: ${socket.id}`);
        const room = gameManager.getRoomBySocketId(socket.id);
        if (room) {
            const playerName = room.players[socket.id].name;
            delete room.players[socket.id];
            
            // Voice chat cleanup
            room.voiceChatPeers = room.voiceChatPeers.filter(id => id !== socket.id);
            socket.to(room.id).emit('voice-peer-disconnect', { peerId: socket.id });

            if (Object.keys(room.players).length === 0) {
                delete gameManager.rooms[room.id];
                console.log(`[GameManager] Room ${room.id} closed.`);
            } else {
                 io.to(room.id).emit('playerLeft', { room: { playerName, remainingPlayers: room.players } });
            }
        }
    });
});

// --- Server Start ---
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});