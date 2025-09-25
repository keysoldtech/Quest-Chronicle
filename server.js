// Import required modules
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const gameData = require('./game-data'); // Import card data

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
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
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
        const newRoom = {
            id: roomId,
            players: {
                [socket.id]: { 
                    id: socket.id,
                    name: playerName, 
                    role: 'DM', // Default role, will be reassigned at game start
                    hand: [],
                    maxHp: 20,
                    currentHp: 20,
                    isNpc: false,
                }
            },
            voiceChatPeers: [],
            gameState: {
                phase: 'lobby',
                itemDeck: [],
                spellDeck: [],
                monsterDeck: [],
                turnOrder: [],
                currentPlayerIndex: -1,
                board: {
                    monsters: [],
                    playedCards: [],
                }
            }
        };
        this.rooms[roomId] = newRoom;
        console.log(`[GameManager] Room ${roomId} created by ${playerName} (${socket.id}).`);
        return newRoom;
    }

    joinRoom(socket, roomId, playerName) {
        const room = this.rooms[roomId];
        if (room && Object.keys(room.players).length < 5) {
            room.players[socket.id] = { 
                id: socket.id,
                name: playerName, 
                role: 'Player', 
                hand: [],
                maxHp: 20,
                currentHp: 20,
                isNpc: false,
            };
            console.log(`[GameManager] ${playerName} (${socket.id}) joined room ${roomId}.`);
            return room;
        }
        return null;
    }
    
    getPlayer(socketId) {
        for (const roomId in this.rooms) {
            if (this.rooms[roomId].players[socketId]) {
                return {
                    player: this.rooms[roomId].players[socketId],
                    room: this.rooms[roomId]
                };
            }
        }
        return null;
    }

    removePlayer(socket) {
        // ... (rest of removePlayer function is unchanged)
        for (const roomId in this.rooms) {
            const room = this.rooms[roomId];
            if (room.players[socket.id]) {
                const playerName = room.players[socket.id].name;
                delete room.players[socket.id];
                console.log(`[GameManager] ${playerName} (${socket.id}) removed from room ${roomId}.`);
                const turnIndex = room.gameState.turnOrder.indexOf(socket.id);
                if (turnIndex > -1) {
                    room.gameState.turnOrder.splice(turnIndex, 1);
                }
                const voiceIndex = room.voiceChatPeers.indexOf(socket.id);
                if (voiceIndex > -1) {
                    room.voiceChatPeers.splice(voiceIndex, 1);
                }
                if (Object.keys(room.players).length === 0) {
                    delete this.rooms[roomId];
                    console.log(`[GameManager] Room ${roomId} is empty and has been deleted.`);
                }
                return { roomId, playerName, remainingPlayers: room.players };
            }
        }
        return null;
    }
    
    startGame(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.phase !== 'lobby') return false;
        
        console.log(`[GameManager] Starting game in room ${roomId}...`);
        
        const humanPlayerIds = Object.keys(room.players).filter(id => !room.players[id].isNpc);
        const humanPlayerCount = humanPlayerIds.length;

        // --- Dynamic Role and NPC Assignment ---
        if (humanPlayerCount === 5) {
            // Full party, assign one human as DM
            shuffle(humanPlayerIds);
            const dmId = humanPlayerIds.pop();
            room.players[dmId].role = 'DM';
            humanPlayerIds.forEach(id => room.players[id].role = 'Explorer');
        } else {
            // 4 or fewer players, create NPC DM and fill Explorer slots
            const npcDmId = 'npc-dm';
            room.players[npcDmId] = {
                id: npcDmId, name: 'NPC Dungeon Master', role: 'DM',
                hand: [], maxHp: 999, currentHp: 999, isNpc: true
            };
            
            humanPlayerIds.forEach(id => room.players[id].role = 'Explorer');
            
            const explorersToCreate = 4 - humanPlayerCount;
            for (let i = 0; i < explorersToCreate; i++) {
                const npcExplorerId = `npc-explorer-${i+1}`;
                room.players[npcExplorerId] = {
                    id: npcExplorerId, name: `NPC Explorer #${i+1}`, role: 'Explorer',
                    hand: [], maxHp: 20, currentHp: 20, isNpc: true
                };
            }
        }

        // --- Deck and Hand Initialization ---
        room.gameState.itemDeck = [...gameData.itemCards];
        room.gameState.spellDeck = [...gameData.spellCards];
        room.gameState.monsterDeck = [...gameData.monsterCards];
        shuffle(room.gameState.itemDeck);
        shuffle(room.gameState.spellDeck);
        shuffle(room.gameState.monsterDeck);

        const explorerIds = Object.keys(room.players).filter(id => room.players[id].role === 'Explorer');
        const dmId = Object.keys(room.players).find(id => room.players[id].role === 'DM');

        const startingHandSize = 5;
        explorerIds.forEach(id => {
            for (let i = 0; i < startingHandSize; i++) {
                if (room.gameState.itemDeck.length > 0) room.players[id].hand.push(room.gameState.itemDeck.pop());
            }
        });
        
        // Give DM some monster cards
        for (let i = 0; i < startingHandSize; i++) {
            if (room.gameState.monsterDeck.length > 0) room.players[dmId].hand.push(room.gameState.monsterDeck.pop());
        }

        room.gameState.turnOrder = explorerIds;
        shuffle(room.gameState.turnOrder);
        
        room.gameState.currentPlayerIndex = 0;
        room.gameState.phase = 'active';

        // Check if first player is an NPC and trigger their turn
        const firstPlayer = room.players[room.gameState.turnOrder[0]];
        if (firstPlayer.isNpc) {
            setTimeout(() => this.executeNpcTurn(room.id, firstPlayer.id), 2000); // 2s delay
        }

        return room;
    }
    
    endTurn(roomId, playerId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.phase !== 'active') return;

        const currentPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        if(playerId !== currentPlayerId) return; // Not their turn
        
        room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
        console.log(`[GameManager] Room ${roomId} advanced to next turn.`);
        
        // --- NPC Turn Logic ---
        const nextPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        const nextPlayer = room.players[nextPlayerId];
        if (nextPlayer.isNpc) {
            setTimeout(() => this.executeNpcTurn(room.id, nextPlayer.id), 2000); // 2s delay
        }
        
        return room;
    }

    executeNpcTurn(roomId, npcId) {
        const room = this.rooms[roomId];
        const npc = room.players[npcId];
        if (!room || !npc || !npc.isNpc) return;

        let actionTaken = false;
        let message = `${npc.name} is thinking...`;

        if (npc.role === 'Explorer') {
            // Simple Explorer AI: Use healing if low, otherwise use damage.
            const needsHealing = npc.currentHp < (npc.maxHp / 2);
            let cardToPlay = null;

            if (needsHealing) {
                cardToPlay = npc.hand.find(card => card.category === 'Healing');
            }
            if (!cardToPlay) {
                cardToPlay = npc.hand.find(card => card.category === 'Damage');
            }
            
            if (cardToPlay) {
                this.playCard(roomId, npcId, cardToPlay.id);
                actionTaken = true;
                message = `${npc.name} played ${cardToPlay.name}.`;
            }
        } else if (npc.role === 'DM') {
            // Simple DM AI: Play a monster card if possible
            const monsterCard = npc.hand.find(card => card.type === 'Monster');
            if (monsterCard) {
                this.playCard(roomId, npcId, monsterCard.id);
                actionTaken = true;
                message = `The NPC DM plays a ${monsterCard.name}!`;
            }
        }
        
        if (!actionTaken) {
            message = `${npc.name} ends their turn.`;
        }
        
        io.to(room.id).emit('chatMessage', { senderName: 'System', message, channel: 'game' });
        
        // After "thinking" and acting, the NPC ends its turn
        if (npc.role === 'Explorer') {
            const updatedRoom = this.endTurn(roomId, npcId);
            if(updatedRoom) io.to(roomId).emit('gameStateUpdate', updatedRoom);
        }
    }
    
    playCard(roomId, playerId, cardId) {
        const room = this.rooms[roomId];
        const player = room.players[playerId];
        if (!room || !player) return null;
        
        const cardIndex = player.hand.findIndex(card => card.id === cardId);
        if (cardIndex > -1) {
            const card = player.hand.splice(cardIndex, 1)[0];
            
            // Apply card effects (simplified)
            if(card.category === 'Healing') {
                player.currentHp = Math.min(player.maxHp, player.currentHp + 5); // Simple +5 heal
            } else if (card.type === 'Monster') {
                room.gameState.board.monsters.push(card);
            } else {
                 room.gameState.board.playedCards.push(card);
            }
            
            console.log(`[GameManager] ${player.name} played ${card.name}`);
            
            io.to(roomId).emit('gameStateUpdate', room); // Emit immediate update
            return room;
        }
        return null;
    }
}

const gameManager = new GameManager();

// --- Socket.IO Connection Handling ---

io.on('connection', (socket) => {
    console.log(`[Socket.IO] A user connected: ${socket.id}`);

    socket.on('createRoom', (playerName) => {
        const room = gameManager.createRoom(socket, playerName);
        socket.join(room.id);
        socket.emit('roomCreated', { roomId: room.id, players: room.players, yourId: socket.id });
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const upperRoomId = roomId.toUpperCase();
        const room = gameManager.joinRoom(socket, upperRoomId, playerName);
        if (room) {
            socket.join(upperRoomId);
            socket.emit('joinSuccess', { roomId: room.id, players: room.players, yourId: socket.id });
            io.to(room.id).emit('playerJoined', { players: room.players });
        } else {
            socket.emit('error', 'Room not found or is full.');
        }
    });

    socket.on('sendMessage', ({ channel, message }) => {
        const result = gameManager.getPlayer(socket.id);
        if (!result) return; 
        const { player, room } = result;
        const messagePayload = { senderName: player.name, message, channel };
        if (channel === 'game') {
            io.to(room.id).emit('chatMessage', messagePayload);
        } else if (channel === 'party' && player.role !== 'DM') {
            const playerSocketIds = Object.keys(room.players).filter(id => room.players[id].role !== 'DM');
            playerSocketIds.forEach(id => io.to(id).emit('chatMessage', messagePayload));
        }
    });
    
    socket.on('startGame', () => {
        const result = gameManager.getPlayer(socket.id);
        if (result && (result.player.role === 'DM' || Object.keys(result.room.players).length === 1)) {
            const room = gameManager.startGame(result.room.id);
            if(room) {
                io.to(room.id).emit('gameStarted', room);
                io.to(room.id).emit('chatMessage', { senderName: 'System', message: `${result.player.name} has started the game! Roles have been assigned.`, channel: 'game' });
            }
        }
    });
    
    socket.on('playCard', ({ cardId }) => {
        const result = gameManager.getPlayer(socket.id);
        if (result) {
            const updatedRoom = gameManager.playCard(result.room.id, socket.id, cardId);
            if(updatedRoom) {
                io.to(updatedRoom.id).emit('chatMessage', { senderName: 'System', message: `${result.player.name} played a card.`, channel: 'game' });
            }
        }
    });
    
    socket.on('endTurn', () => {
        const result = gameManager.getPlayer(socket.id);
        if (result) {
            const updatedRoom = gameManager.endTurn(result.room.id, socket.id);
            if (updatedRoom) {
                io.to(updatedRoom.id).emit('gameStateUpdate', updatedRoom);
                io.to(updatedRoom.id).emit('chatMessage', { senderName: 'System', message: `${result.player.name} ended their turn.`, channel: 'game' });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Socket.IO] User disconnected: ${socket.id}`);
        const result = gameManager.removePlayer(socket);
        if (result) {
            if (Object.keys(result.remainingPlayers).length > 0) {
                io.to(result.roomId).emit('playerLeft', { players: result.remainingPlayers, playerName: result.playerName });
                io.to(result.roomId).emit('voice-peer-disconnect', { peerId: socket.id });
            }
        }
    });
    
    // WebRTC listeners remain unchanged
    socket.on('join-voice', () => { /* ... */ });
    socket.on('voice-offer', ({ offer, toId }) => { /* ... */ });
    socket.on('voice-answer', ({ answer, toId }) => { /* ... */ });
    socket.on('voice-ice-candidate', ({ candidate, toId }) => { /* ... */ });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
