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
        [array[i], array[j]] = [array[j], array[j]];
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
                itemDeck: [], spellDeck: [], monsterDeck: [], weaponDeck: [], armorDeck: [], worldEventDeck: [],
                turnOrder: [],
                currentPlayerIndex: -1,
                board: { monsters: [], playedCards: [] },
                worldEvents: { currentSequence: [], sequenceActive: false }
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
    
    calculatePlayerStats(playerId, room) {
        const player = room.players[playerId];
        if (!player || !player.class) {
             // Set default stats if no class is selected yet
            player.stats = { maxHp: 20, currentHp: 20, damageBonus: 0, shieldBonus: 0, ap: 2 };
            return;
        }

        const classData = gameData.classes[player.class];
        if (!classData) return;

        // Start with base class stats
        let stats = {
            maxHp: classData.baseHp,
            damageBonus: classData.baseDamageBonus,
            shieldBonus: classData.baseShieldBonus,
            ap: classData.baseAp,
        };

        // Apply equipment bonuses
        for (const slot in player.equipment) {
            const item = player.equipment[slot];
            if (item && item.bonuses) {
                stats.shieldBonus += item.bonuses.shield || 0;
                stats.ap += item.bonuses.ap || 0;
                // Note: Weapon damage bonus is often handled at time of attack, but we could add it here if needed.
            }
        }
        
        const oldMaxHp = player.stats.maxHp;
        player.stats = { ...stats, currentHp: player.stats.currentHp || stats.maxHp };
        
        // Adjust current HP based on new Max HP
        if (player.stats.maxHp !== oldMaxHp) {
            player.stats.currentHp = Math.min(player.stats.currentHp, player.stats.maxHp);
            if(oldMaxHp === 0) player.stats.currentHp = player.stats.maxHp; // First time setup
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
        const itemType = itemToEquip.type.toLowerCase(); // 'weapon' or 'armor'

        if (itemType === 'weapon' || itemType === 'armor') {
            // Unequip current item in that slot, if any
            if (player.equipment[itemType]) {
                player.hand.push(player.equipment[itemType]);
            }
            // Equip new item
            player.equipment[itemType] = player.hand.splice(cardIndex, 1)[0];
            this.calculatePlayerStats(socketId, room);
            return room;
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
                const turnIndex = room.gameState.turnOrder.indexOf(socket.id);
                if (turnIndex > -1) room.gameState.turnOrder.splice(turnIndex, 1);
                
                const voiceIndex = room.voiceChatPeers.indexOf(socket.id);
                if (voiceIndex > -1) room.voiceChatPeers.splice(voiceIndex, 1);
                
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
        
        // --- Role & NPC Assignment ---
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

        // --- Class Assignment ---
        const classIds = Object.keys(gameData.classes);
        Object.values(room.players).forEach(player => {
            if(player.role === 'Explorer' && !player.class) {
                player.class = classIds[Math.floor(Math.random() * classIds.length)];
            }
            this.calculatePlayerStats(player.id, room); // Initial stat calculation
        });

        // --- Deck Initialization ---
        ['itemDeck', 'spellDeck', 'monsterDeck', 'weaponDeck', 'armorDeck', 'worldEventDeck'].forEach(deck => {
            room.gameState[deck] = [...gameData[deck.replace('Deck', 'Cards')]];
            shuffle(room.gameState[deck]);
        });
        
        const explorerIds = Object.keys(room.players).filter(id => room.players[id].role === 'Explorer');
        const dmId = Object.keys(room.players).find(id => room.players[id].role === 'DM');

        // --- Starting Hand & Equipment Logic by Game Mode ---
        if (gameMode === 'Beginner') {
            explorerIds.forEach(id => {
                const player = room.players[id];
                const weapon = room.gameState.weaponDeck.pop();
                const armor = room.gameState.armorDeck.pop();
                if(weapon) player.hand.push(weapon);
                if(armor) player.hand.push(armor);
                if(room.gameState.spellDeck.length > 0) player.hand.push(room.gameState.spellDeck.pop());
                
                // Auto-equip for beginner mode
                if (weapon) this.equipItem(id, weapon.id);
                if (armor) this.equipItem(id, armor.id);
            });
        } else if (gameMode === 'Advanced') {
            explorerIds.forEach(id => {
                 if(room.gameState.itemDeck.length > 0) room.players[id].hand.push(room.gameState.itemDeck.pop());
            });
        }
        
        for (let i = 0; i < 5; i++) {
            if (room.gameState.monsterDeck.length > 0) room.players[dmId].hand.push(room.gameState.monsterDeck.pop());
        }

        // Final stat calculation after potential auto-equips
        Object.keys(room.players).forEach(id => this.calculatePlayerStats(id, room));

        room.gameState.turnOrder = explorerIds;
        shuffle(room.gameState.turnOrder);
        room.gameState.currentPlayerIndex = -1; // No one's turn yet
        room.gameState.phase = 'world_event_setup'; // NEW PHASE: Wait for DM to act

        return room;
    }
    
    endTurn(roomId, playerId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.phase !== 'active') return;

        const currentPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        if(playerId !== currentPlayerId) return;
        
        room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
        
        const nextPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        if (room.players[nextPlayerId].isNpc) {
            setTimeout(() => this.executeNpcTurn(room.id, nextPlayerId), 2000);
        }
        return room;
    }

    executeNpcTurn(roomId, npcId) {
        const room = this.rooms[roomId];
        const npc = room.players[npcId];
        if (!room || !npc || !npc.isNpc) return;

        let message = `${npc.name} is thinking...`;
        let actionTaken = false;

        if (npc.role === 'Explorer') {
            const canPlayDamage = room.gameState.board.monsters.length > 0;
            const needsHealing = npc.stats.currentHp < (npc.stats.maxHp / 2);
            let cardToPlay = needsHealing ? npc.hand.find(c => c.category === 'Healing') : null;
            if (!cardToPlay && canPlayDamage) cardToPlay = npc.hand.find(c => c.category === 'Damage');
            
            if (cardToPlay) {
                this.playCard(roomId, npcId, cardToPlay.id); // This will pass the damage check
                actionTaken = true;
                message = `${npc.name} played ${cardToPlay.name}.`;
            }
        } else if (npc.role === 'DM') {
            const monsterCard = npc.hand.find(c => c.type === 'Monster');
            if (monsterCard) {
                this.playCard(roomId, npcId, monsterCard.id);
                actionTaken = true;
                message = `The NPC DM plays a ${monsterCard.name}!`;
            }
        }
        
        if (!actionTaken) message = `${npc.name} ends their turn.`;
        io.to(room.id).emit('chatMessage', { senderName: 'System', message, channel: 'game' });
        
        if (npc.role === 'Explorer') {
            const updatedRoom = this.endTurn(roomId, npcId);
            if(updatedRoom) io.to(roomId).emit('gameStateUpdate', updatedRoom);
        }
    }
    
    playCard(roomId, playerId, cardId) {
        const room = this.rooms[roomId];
        const player = room.players[playerId];
        if (!room || !player) return { error: "Invalid action." };
        
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return { error: "Card not found in hand." };
            
        const card = player.hand[cardIndex];

        // NEW RULE: Combat Logic Check
        if ((card.category === 'Damage' || card.category === 'Attack') && room.gameState.board.monsters.length === 0) {
            return { error: "You can only play Damage cards when monsters are on the board." };
        }

        player.hand.splice(cardIndex, 1)[0]; // Remove card from hand
        
        if(card.category === 'Healing') {
            const healAmount = (card.bonuses && card.bonuses.heal) ? card.bonuses.heal : 5;
            player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healAmount);
        } else if (card.type === 'Monster') {
            room.gameState.board.monsters.push(card);
        } else {
            room.gameState.board.playedCards.push(card);
        }
        this.calculatePlayerStats(playerId, room);
        return { room };
    }

    // --- GM Action Functions ---
    drawMonsterForDm(roomId, dmId) {
        const room = this.rooms[roomId];
        if(room && room.players[dmId]?.role === 'DM' && room.gameState.monsterDeck.length > 0) {
            const card = room.gameState.monsterDeck.pop();
            room.players[dmId].hand.push(card);
            return { room, card };
        }
        return null;
    }
    
    drawDiscoveryForPlayer(roomId, playerId) {
        const room = this.rooms[roomId];
        if(room && room.players[playerId] && room.gameState.itemDeck.length > 0) {
            const card = room.gameState.itemDeck.pop();
            room.players[playerId].hand.push(card);
            return { room, card };
        }
        return null;
    }
    
    startWorldEventSequence(roomId) {
        const room = this.rooms[roomId];
        if(room && !room.gameState.worldEvents.sequenceActive) {
            // NEW RULE: Start game loop after first world event
            if (room.gameState.phase === 'world_event_setup') {
                room.gameState.phase = 'active';
                room.gameState.currentPlayerIndex = 0;
            }
            room.gameState.worldEvents.currentSequence = [];
            for(let i=0; i<3; i++) if(room.gameState.worldEventDeck.length > 0) room.gameState.worldEvents.currentSequence.push(room.gameState.worldEventDeck.pop());
            room.gameState.worldEvents.sequenceActive = true;
            return room;
        }
        return null;
    }
    
    drawWorldEventsForDm(roomId) {
        const room = this.rooms[roomId];
        if(room) {
            // NEW RULE: Start game loop after first world event
            if (room.gameState.phase === 'world_event_setup') {
                room.gameState.phase = 'active';
                room.gameState.currentPlayerIndex = 0;
            }
            room.gameState.worldEvents.currentSequence = [];
            for(let i=0; i<3; i++) if(room.gameState.worldEventDeck.length > 0) room.gameState.worldEvents.currentSequence.push(room.gameState.worldEventDeck.pop());
            room.gameState.worldEvents.sequenceActive = true;
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
        if (channel === 'game') {
            io.to(room.id).emit('chatMessage', messagePayload);
        } else if (channel === 'party' && player.role !== 'DM') {
            const playerSocketIds = Object.keys(room.players).filter(id => room.players[id].role !== 'DM');
            playerSocketIds.forEach(id => io.to(id).emit('chatMessage', messagePayload));
        }
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
    
    socket.on('playCard', ({ cardId }) => {
        const result = gameManager.getPlayer(socket.id);
        if (result) {
            const { room: updatedRoom, error } = gameManager.playCard(result.room.id, socket.id, cardId);
            if (error) {
                socket.emit('actionError', error);
            } else if(updatedRoom) {
                io.to(updatedRoom.id).emit('gameStateUpdate', updatedRoom);
                 const card = updatedRoom.gameState.board.monsters.find(c => c.id === cardId) || updatedRoom.gameState.board.playedCards.find(c => c.id === cardId);
                io.to(updatedRoom.id).emit('chatMessage', { senderName: 'System', message: `${result.player.name} played ${card?.name || 'a card'}.`, channel: 'game' });
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

    socket.on('gmAction', ({ action, targetPlayerId }) => {
        const result = gameManager.getPlayer(socket.id);
        if(!result || result.player.role !== 'DM') return;
        let updatedRoom, card, player;
        switch(action) {
            case 'drawMonster':
                ({ room: updatedRoom, card } = gameManager.drawMonsterForDm(result.room.id, socket.id) || {});
                if(updatedRoom) io.to(socket.id).emit('chatMessage', { senderName: 'System', message: `You drew monster: ${card.name}.`, channel: 'game' });
                break;
            case 'drawDiscovery':
                player = result.room.players[targetPlayerId];
                if(!player) return;
                ({ room: updatedRoom, card } = gameManager.drawDiscoveryForPlayer(result.room.id, targetPlayerId) || {});
                if(updatedRoom) io.to(result.room.id).emit('chatMessage', { senderName: 'System', message: `${player.name} discovered an item: ${card.name}!`, channel: 'game' });
                break;
            case 'startWorldEventSequence':
                updatedRoom = gameManager.startWorldEventSequence(result.room.id);
                if(updatedRoom) io.to(result.room.id).emit('chatMessage', { senderName: 'System', message: `A world event sequence has begun!`, channel: 'game' });
                break;
            case 'drawWorldEvents':
                 updatedRoom = gameManager.drawWorldEventsForDm(result.room.id);
                 if(updatedRoom) io.to(result.room.id).emit('chatMessage', { senderName: 'System', message: `The GM has drawn new world events.`, channel: 'game' });
                 break;
        }
        if (updatedRoom) io.to(result.room.id).emit('gameStateUpdate', updatedRoom);
    });

    socket.on('disconnect', () => {
        console.log(`[Socket.IO] User disconnected: ${socket.id}`);
        const result = gameManager.removePlayer(socket);
        if (result && Object.keys(result.remainingPlayers).length > 0) {
            io.to(result.roomId).emit('playerLeft', { room: result });
            io.to(result.roomId).emit('voice-peer-disconnect', { peerId: socket.id });
        }
    });
    
    // --- WebRTC Signaling ---
    socket.on('join-voice', () => {
        const result = gameManager.getPlayer(socket.id);
        if (result) {
            const { room } = result;
            const otherPeers = room.voiceChatPeers.filter(id => id !== socket.id);
            socket.emit('voice-peers', otherPeers);
            room.voiceChatPeers.push(socket.id);
            otherPeers.forEach(peerId => io.to(peerId).emit('voice-peer-join', { peerId: socket.id }));
        }
    });

    socket.on('voice-offer', ({ offer, toId }) => io.to(toId).emit('voice-offer', { offer, fromId: socket.id }));
    socket.on('voice-answer', ({ answer, toId }) => io.to(toId).emit('voice-answer', { answer, fromId: socket.id }));
    socket.on('voice-ice-candidate', ({ candidate, toId }) => io.to(toId).emit('voice-ice-candidate', { candidate, fromId: socket.id }));
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});