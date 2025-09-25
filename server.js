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
                advancedChoicesPending: []
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
            player.stats = { maxHp: 20, currentHp: 20, damageBonus: 0, shieldBonus: 0, ap: 2 };
            return;
        }

        const classData = gameData.classes[player.class];
        if (!classData) return;

        let stats = {
            maxHp: classData.baseHp,
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
        
        const oldMaxHp = player.stats.maxHp;
        player.stats = { ...stats, currentHp: player.stats.currentHp || stats.maxHp };
        
        if (player.stats.maxHp !== oldMaxHp) {
            player.stats.currentHp = Math.min(player.stats.currentHp, player.stats.maxHp);
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
            // If all choices are made, proceed
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
            // BUG FIX: Trigger NPC DM's first action immediately
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
        
        const explorerIds = Object.keys(room.players).filter(id => room.players[id].role === 'Explorer');
        const dmId = Object.keys(room.players).find(id => room.players[id].role === 'DM');

        if (gameMode === 'Beginner') {
            explorerIds.forEach(id => {
                const player = room.players[id];
                const weapon = room.gameState.decks.weapon.pop();
                const armor = room.gameState.decks.armor.pop();
                if(weapon) player.hand.push(weapon);
                if(armor) player.hand.push(armor);
                if(room.gameState.decks.spell.length > 0) player.hand.push(room.gameState.decks.spell.pop());
                
                if (weapon) this.equipItem(id, weapon.id);
                if (armor) this.equipItem(id, armor.id);
            });
            this.transitionToWorldEventSetup(room);
        } else if (gameMode === 'Advanced') {
            room.gameState.phase = 'advanced_setup_choice';
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

        room.gameState.turnOrder = explorerIds;
        shuffle(room.gameState.turnOrder);
        room.gameState.currentPlayerIndex = -1;

        return room;
    }
    
    endTurn(roomId, playerId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.phase !== 'active') return;

        const currentPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        if(playerId !== currentPlayerId) return;
        
        room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
        
        // After a full round, trigger NPC DM's turn.
        if (room.gameState.currentPlayerIndex === 0) {
            const dm = Object.values(room.players).find(p => p.role === 'DM');
            if (dm && dm.isNpc) {
                setTimeout(() => this.executeNpcTurn(room.id, dm.id), 2000);
            }
        }
        
        const nextPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        if (room.players[nextPlayerId]?.isNpc) {
            setTimeout(() => this.executeNpcTurn(room.id, nextPlayerId), 2000);
        }
        return room;
    }

    executeNpcTurn(roomId, npcId) {
        const room = this.rooms[roomId];
        const npc = room.players[npcId];
        if (!room || !npc || !npc.isNpc) return;

        let message = '';
        let broadcastRoom = true;

        if (npc.role === 'DM') {
            // ENHANCED NPC DM LOGIC
            const boardIsEmpty = room.gameState.board.monsters.length === 0;

            if (room.gameState.phase === 'world_event_setup') {
                const eventCard = npc.hand.find(c => c.type === 'World Event') || room.gameState.decks.worldEvent.pop();
                if (eventCard) {
                    this.playCard(roomId, npcId, eventCard.id, null);
                    message = `The NPC DM begins the story with a world event: ${eventCard.name}!`;
                }
            } else if (room.gameState.monstersDefeatedSinceLastTurn) {
                const eventCard = npc.hand.find(c => c.type === 'World Event') || room.gameState.decks.worldEvent.pop();
                if (eventCard) {
                    this.playCard(roomId, npcId, eventCard.id, null);
                    message = `With the threat gone, the world shifts... The DM plays a new event: ${eventCard.name}.`;
                    room.gameState.monstersDefeatedSinceLastTurn = false;
                }
            } else if (boardIsEmpty) {
                let monsterCard = npc.hand.find(c => c.type === 'Monster');
                if (!monsterCard && room.gameState.decks.monster.length > 0) {
                    monsterCard = room.gameState.decks.monster.pop();
                    npc.hand.push(monsterCard);
                }
                if (monsterCard) {
                    this.playCard(roomId, npcId, monsterCard.id, null);
                    message = `A new challenger appears! The NPC DM summons a ${monsterCard.name}!`;
                }
            } else { // Board has monsters, no one was defeated
                if (room.gameState.decks.monster.length > 0) {
                    npc.hand.push(room.gameState.decks.monster.pop());
                    message = `The NPC DM prepares for what's to come...`;
                }
            }
        } else if (npc.role === 'Explorer') {
            const canPlayDamage = room.gameState.board.monsters.length > 0;
            const needsHealing = npc.stats.currentHp < (npc.stats.maxHp / 2);
            let cardToPlay = needsHealing ? npc.hand.find(c => c.category === 'Healing') : null;
            let targetId = null;
            if (!cardToPlay && canPlayDamage) {
                cardToPlay = npc.hand.find(c => c.category === 'Damage');
                if(cardToPlay) {
                    const monsters = room.gameState.board.monsters;
                    targetId = monsters[Math.floor(Math.random() * monsters.length)].id;
                }
            }
            
            if (cardToPlay) {
                const { error } = this.playCard(roomId, npcId, cardToPlay.id, targetId);
                if (!error) message = `${npc.name} played ${cardToPlay.name}.`;
                else message = `${npc.name} considers their options...`;
            } else {
                 message = `${npc.name} ends their turn.`;
            }
            
            const updatedRoom = this.endTurn(roomId, npcId);
            if(updatedRoom) io.to(roomId).emit('gameStateUpdate', updatedRoom);
            broadcastRoom = false; // endTurn already broadcasts
        }
        
        if (message) io.to(room.id).emit('chatMessage', { senderName: 'System', message, channel: 'game' });
        if(broadcastRoom) io.to(roomId).emit('gameStateUpdate', room);
    }
    
    playCard(roomId, playerId, cardId, targetId) {
        const room = this.rooms[roomId];
        const player = room.players[playerId];
        if (!room || !player) return { error: "Invalid action." };
        
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        // Allow playing from deck if card isn't in hand (for NPC DM)
        const card = cardIndex > -1 ? player.hand[cardIndex] : (player.isNpc ? {id: cardId, ...gameData.worldEventCards.find(c => c.id === cardId)} : null);
        if (!card) return { error: "Card not found." };
            
        if ((card.category === 'Damage' || card.category === 'Attack') && room.gameState.board.monsters.length === 0) {
            return { error: "You can only play Damage cards when monsters are on the board." };
        }
        
        if (cardIndex > -1) player.hand.splice(cardIndex, 1); // Remove card from hand if it was there

        if (card.type === 'World Event') {
            room.gameState.worldEvents.currentSequence = [card];
             if (room.gameState.phase === 'world_event_setup') {
                room.gameState.phase = 'active';
                room.gameState.currentPlayerIndex = 0;
                const firstPlayer = room.players[room.gameState.turnOrder[0]];
                if (firstPlayer.isNpc) {
                    setTimeout(() => this.executeNpcTurn(room.id, firstPlayer.id), 2000);
                }
            }
        } else if (card.category === 'Damage') {
            const monster = room.gameState.board.monsters.find(m => m.id === targetId);
            if (monster) {
                const damageAmount = (card.bonuses?.damage || 0) + (player.stats.damageBonus || 0);
                monster.currentHp -= damageAmount;
                io.to(roomId).emit('chatMessage', { senderName: 'Combat', message: `${player.name} hits ${monster.name} for ${damageAmount} damage!`, channel: 'game' });
                if (monster.currentHp <= 0) {
                    room.gameState.board.monsters = room.gameState.board.monsters.filter(m => m.id !== targetId);
                    room.gameState.monstersDefeatedSinceLastTurn = true;
                    io.to(roomId).emit('chatMessage', { senderName: 'Combat', message: `${monster.name} has been defeated!`, channel: 'game' });
                }
            }
        } else if (card.type === 'Monster') {
            const monsterData = { ...card, currentHp: card.maxHp };
            room.gameState.board.monsters.push(monsterData);
        }
        
        this.calculatePlayerStats(playerId, room);
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
        if (channel === 'game') {
            io.to(room.id).emit('chatMessage', messagePayload);
        } else if (channel === 'party' && player.role !== 'DM') {
            const playerSocketIds = Object.keys(room.players).filter(id => room.players[id].role !== 'DM');
            playerSocketIds.forEach(id => io.to(id).emit('chatMessage', messagePayload));
        }
    });
    
    socket.on('startGame', ({ gameMode, choices }) => {
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
            const { room: updatedRoom, error } = gameManager.playCard(result.room.id, socket.id, cardId, targetId);
            if (error) {
                socket.emit('actionError', error);
            } else if(updatedRoom) {
                io.to(updatedRoom.id).emit('gameStateUpdate', updatedRoom);
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
        
        let room;
        if (action === 'startWorldEventSequence' || action === 'drawWorldEvents') {
            const eventCard = result.player.hand.find(c => c.type === 'World Event');
            if (eventCard) {
                const { room: updatedRoom } = gameManager.playCard(result.room.id, socket.id, eventCard.id);
                room = updatedRoom;
            } else {
                socket.emit('actionError', "You have no World Event cards to play!");
            }
        }
        if (room) io.to(result.room.id).emit('gameStateUpdate', room);
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