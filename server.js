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
/**
 * Shuffles an array in place.
 * @param {Array} array The array to shuffle.
 */
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
                [socket.id]: { name: playerName, role: 'DM', hand: [] }
            },
            // Initial empty game state
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
        if (room) {
            room.players[socket.id] = { name: playerName, role: 'Player', hand: [] };
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
        for (const roomId in this.rooms) {
            const room = this.rooms[roomId];
            if (room.players[socket.id]) {
                const playerName = room.players[socket.id].name;
                delete room.players[socket.id];
                console.log(`[GameManager] ${playerName} (${socket.id}) removed from room ${roomId}.`);

                // Also remove from turn order if game is active
                const turnIndex = room.gameState.turnOrder.indexOf(socket.id);
                if (turnIndex > -1) {
                    room.gameState.turnOrder.splice(turnIndex, 1);
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
    
    /**
     * Starts the game for a given room.
     * @param {string} roomId - The ID of the room.
     */
    startGame(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.phase !== 'lobby') {
            return false;
        }
        
        console.log(`[GameManager] Starting game in room ${roomId}...`);
        
        // 1. Initialize and shuffle decks
        room.gameState.itemDeck = [...gameData.itemCards];
        room.gameState.spellDeck = [...gameData.spellCards];
        room.gameState.monsterDeck = [...gameData.monsterCards];
        shuffle(room.gameState.itemDeck);
        shuffle(room.gameState.spellDeck);
        shuffle(room.gameState.monsterDeck);

        // 2. Set turn order (Players only, DM doesn't take a turn in this logic)
        room.gameState.turnOrder = Object.keys(room.players).filter(id => room.players[id].role === 'Player');
        shuffle(room.gameState.turnOrder);
        
        // 3. Deal starting hands (e.g., 5 cards)
        const startingHandSize = 5;
        for (const playerId of room.gameState.turnOrder) {
            for (let i = 0; i < startingHandSize; i++) {
                // Example: deal item cards for simplicity
                if (room.gameState.itemDeck.length > 0) {
                    room.players[playerId].hand.push(room.gameState.itemDeck.pop());
                }
            }
        }

        // 4. Set first player's turn and update phase
        room.gameState.currentPlayerIndex = 0;
        room.gameState.phase = 'active';

        return room;
    }
    
    /**
     * Advances to the next player's turn.
     * @param {string} roomId - The ID of the room.
     */
    endTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.phase !== 'active') {
            return;
        }
        
        // Move to the next player, looping back to the start if necessary
        room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
        console.log(`[GameManager] Room ${roomId} advanced to next turn.`);
        
        // Placeholder for drawing a card at the start of a turn
        const currentPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        const player = room.players[currentPlayerId];
        if (room.gameState.itemDeck.length > 0) {
            player.hand.push(room.gameState.itemDeck.pop());
        }

        return room;
    }
    
    // Placeholder for playCard logic
    playCard(roomId, playerId, cardId) {
        const room = this.rooms[roomId];
        const player = room.players[playerId];
        if (!room || !player) return;
        
        const cardIndex = player.hand.findIndex(card => card.id === cardId);
        if (cardIndex > -1) {
            const card = player.hand.splice(cardIndex, 1)[0];
            room.gameState.board.playedCards.push(card);
            console.log(`[GameManager] ${player.name} played ${card.name}`);
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
            socket.emit('error', 'Room not found.');
        }
    });

    socket.on('sendMessage', ({ channel, message }) => {
        const result = gameManager.getPlayer(socket.id);
        if (!result) return; 

        const { player, room } = result;
        const messagePayload = {
            senderName: player.name,
            senderRole: player.role,
            message,
            channel
        };
        
        if (channel === 'game') {
            io.to(room.id).emit('chatMessage', messagePayload);
        } else if (channel === 'party' && player.role === 'Player') {
            const playerSocketIds = Object.keys(room.players).filter(id => room.players[id].role === 'Player');
            io.to(playerSocketIds).emit('chatMessage', messagePayload);
        }
    });
    
    // --- Game Action Listeners ---
    socket.on('startGame', () => {
        const result = gameManager.getPlayer(socket.id);
        if (result && result.player.role === 'DM') {
            const room = gameManager.startGame(result.room.id);
            if(room) {
                io.to(room.id).emit('gameStarted', room);
                io.to(room.id).emit('chatMessage', { senderName: 'System', message: `${result.player.name} has started the game!`, channel: 'game' });
            }
        }
    });
    
    socket.on('playCard', ({ cardId }) => {
        const result = gameManager.getPlayer(socket.id);
        if (result) {
            const updatedRoom = gameManager.playCard(result.room.id, socket.id, cardId);
            if(updatedRoom) {
                io.to(updatedRoom.id).emit('gameStateUpdate', updatedRoom);
                io.to(updatedRoom.id).emit('chatMessage', { senderName: 'System', message: `${result.player.name} played a card.`, channel: 'game' });
            }
        }
    });
    
    socket.on('endTurn', () => {
        const result = gameManager.getPlayer(socket.id);
        if (result) {
             const room = result.room;
             // Basic validation: only current player can end their turn
             const currentPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
             if (socket.id === currentPlayerId) {
                const updatedRoom = gameManager.endTurn(room.id);
                if (updatedRoom) {
                    io.to(updatedRoom.id).emit('gameStateUpdate', updatedRoom);
                    io.to(updatedRoom.id).emit('chatMessage', { senderName: 'System', message: `${result.player.name} ended their turn.`, channel: 'game' });
                }
             }
        }
    });


    socket.on('disconnect', () => {
        console.log(`[Socket.IO] User disconnected: ${socket.id}`);
        const result = gameManager.removePlayer(socket);
        if (result && Object.keys(result.remainingPlayers).length > 0) {
            io.to(result.roomId).emit('playerLeft', { players: result.remainingPlayers, playerName: result.playerName });
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
