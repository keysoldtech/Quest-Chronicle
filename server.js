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
                worldEvents: { currentEvent: null, pendingSaves: [], resolved: false },
                activeWorldEventEffects: [],
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
        this.rooms[newRoom.id] = newRoom;
        console.log(`[GameManager] Room ${newRoom.id} created by ${playerName} (${socket.id}).`);
        return newRoom;
    }
    
    createPlayerObject(id, name, role = 'Explorer', isNpc = false) {
        return {
            id, name, role, isNpc,
            class: null,
            hand: [],
            equipment: { weapon: null, armor: null },
            stats: { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0, shieldHp: 0, str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
            lifeCount: 3,
            healthDice: { max: 0, current: 0 },
            statusEffects: [], // e.g., { name: 'Poisoned', duration: 3 }
            currentAp: 0,
            pendingEventRoll: false,
            pendingEventChoice: false,
            madeAdvancedChoice: false,
            pendingWorldEventSave: null,
        };
    }

    joinRoom(socket, roomId, playerName) {
        const room = this.rooms[roomId];
        if (!room) {
            console.log(`[GameManager] Join failed: Room ${roomId} not found.`);
            return null;
        }

        const humanPlayerCount = Object.values(room.players).filter(p => !p.isNpc).length;
        if (humanPlayerCount >= 5) {
            socket.emit('actionError', 'This room is full with 5 players.');
            return null;
        }

        // Handle joining a game in progress by replacing an NPC
        if (room.gameState.phase === 'active') {
            const npcExplorers = Object.values(room.players).filter(p => p.role === 'Explorer' && p.isNpc);
            if (npcExplorers.length > 0) {
                shuffle(npcExplorers);
                const npcToReplace = npcExplorers[0];
                console.log(`[GameManager] Replacing NPC ${npcToReplace.name} with new player ${playerName} in room ${roomId}.`);
                
                const npcTurnIndex = room.gameState.turnOrder.indexOf(npcToReplace.id);
                delete room.players[npcToReplace.id];

                const newPlayer = this.createPlayerObject(socket.id, playerName);
                room.players[socket.id] = newPlayer;

                // --- Late Joiner Balance ---
                if (room.gameState.turnCount > 0) {
                    const catchUpCards = [];
                    // Create a pool of generally useful cards
                    const cardPool = [...gameData.discoveryCards, ...gameData.itemCards.filter(c => c.type === 'Potion')];
                    shuffle(cardPool);
                    const numCards = Math.min(room.gameState.turnCount, 5); // Cap at 5 cards
                    for (let i = 0; i < numCards; i++) {
                        if (cardPool.length > 0) {
                            catchUpCards.push({ ...cardPool.pop(), id: this.generateUniqueCardId() });
                        }
                    }
                    newPlayer.hand.push(...catchUpCards);
                    this.broadcastToRoom(roomId, 'chatMessage', { 
                        senderName: 'Game Master', 
                        message: `${playerName} receives ${numCards} item(s) from the quartermaster to catch up!`, 
                        channel: 'game' 
                    });
                }


                if (npcTurnIndex > -1) {
                    room.gameState.turnOrder[npcTurnIndex] = socket.id;
                }
                
                this.broadcastToRoom(roomId, 'chatMessage', { 
                    senderName: 'Game Master', 
                    message: `${npcToReplace.name} heads back to town as ${playerName} joins the quest!`, 
                    channel: 'game' 
                });
                
            } else {
                socket.emit('actionError', 'This adventure is already full of heroes. Cannot join mid-game.');
                return null;
            }
        } else { // Lobby join
            room.players[socket.id] = this.createPlayerObject(socket.id, playerName);
        }

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
            player.stats = { ...player.stats, maxHp: 20, currentHp: 20, damageBonus: 0, shieldBonus: 0, ap: 3 };
            return;
        }

        const classData = gameData.classes[player.class];
        if (!classData) { // Fallback for safety
             player.stats = { ...player.stats, maxHp: 20, currentHp: 20, damageBonus: 0, shieldBonus: 0, ap: 3 };
             return;
        }

        // --- Universal Stat Calculation ---
        // Start with base class stats
        let { baseDamageBonus: damageBonus, baseShieldBonus: shieldBonus, baseAp: ap } = classData;
        const newCoreStats = { ...classData.stats };

        // Process bonuses from all equipment universally
        const processEquipment = (equipment) => {
            if (!equipment?.effect?.bonuses) return;
    
            for (const [stat, value] of Object.entries(equipment.effect.bonuses)) {
                switch (stat) {
                    case 'damage':
                        damageBonus += value || 0;
                        break;
                    case 'shield':
                        shieldBonus += value || 0;
                        break;
                    case 'ap':
                        ap += value || 0;
                        break;
                    default:
                        // For core stats like STR, DEX, etc.
                        if (newCoreStats.hasOwnProperty(stat)) {
                            newCoreStats[stat] += value || 0;
                        }
                        break;
                }
            }
        };

        processEquipment(player.equipment.weapon);
        processEquipment(player.equipment.armor);
        
        const oldMaxHp = player.stats.maxHp;
        const newMaxHp = classData.baseHp;

        player.stats = {
            ...player.stats, // Keep shieldHp, currentHp, etc.
            ...newCoreStats, // Apply updated core stats (str, dex...)
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
    startGame(hostId, gameMode) {
        const room = this.getRoomBySocketId(hostId);
        if (!room || hostId !== room.hostId || room.gameState.phase !== 'lobby') return;
        
        console.log(`[GameManager] Attempting to start game in room ${room.id} by host ${hostId}.`);

        const humanPlayers = Object.values(room.players).filter(p => !p.isNpc);

        // --- CLASS SELECTION VALIDATION ---
        const playersWithoutClass = humanPlayers.filter(p => !p.class);
        if (playersWithoutClass.length > 0) {
            const names = playersWithoutClass.map(p => p.name).join(', ');
            const message = `Cannot start game. The following players must still choose a class: ${names}.`;
            console.log(`[GameManager] Start game failed for room ${room.id}: ${message}`);
            io.to(hostId).emit('actionError', message);
            return;
        }
        console.log(`[GameManager] Room ${room.id} - All human players have selected a class. Proceeding with role assignment.`);

        room.gameState.gameMode = gameMode;

        // --- ROLE ASSIGNMENT & PARTY SETUP ---
        if (humanPlayers.length === 5) {
            console.log(`[GameManager] Room ${room.id} has 5 human players. Assigning one as DM.`);
            shuffle(humanPlayers);
            const dmPlayer = humanPlayers[0];
            dmPlayer.role = 'DM';
            dmPlayer.class = 'DM';
            const explorerPlayers = humanPlayers.slice(1);
            explorerPlayers.forEach(p => p.role = 'Explorer');
            console.log(`[GameManager] Room ${room.id} Party created: 1 Human Dungeon Master, 4 Human Explorers.`);
        } else {
            console.log(`[GameManager] Room ${room.id} has ${humanPlayers.length} human players. Creating NPC DM and filling explorer slots.`);
            humanPlayers.forEach(p => p.role = 'Explorer');
            const dmNpcId = 'dm-npc';
            const dmNpc = this.createPlayerObject(dmNpcId, 'Dungeon Master', 'DM', true);
            dmNpc.class = 'DM';
            room.players[dmNpcId] = dmNpc;
            const neededNpcs = 4 - humanPlayers.length;
            if (neededNpcs > 0) {
                console.log(`[GameManager] Room ${room.id} - Adding ${neededNpcs} NPC explorers.`);
                const npcNames = ["Garrus", "Tali", "Liara", "Wrex", "Shepard", "Ashley"];
                shuffle(npcNames);
                const availableClasses = Object.keys(gameData.classes);
                for (let i = 0; i < neededNpcs; i++) {
                    const npcId = `npc-${i}-${Date.now()}`;
                    let npcName = npcNames[i % npcNames.length];
                    let nameCounter = 2;
                    while(Object.values(room.players).some(p => p.name === npcName)){
                        npcName = `${npcNames[i % npcNames.length]} ${nameCounter}`;
                        nameCounter++;
                    }
                    const npc = this.createPlayerObject(npcId, npcName, 'Explorer', true);
                    shuffle(availableClasses);
                    npc.class = availableClasses.find(c => !Object.values(room.players).some(p => p.class === c)) || availableClasses[0];
                    room.players[npcId] = npc;
                }
            }
            console.log(`[GameManager] Room ${room.id} Party created: 1 NPC Dungeon Master, ${humanPlayers.length} Human Explorers, ${neededNpcs} NPC Explorers.`);
        }

        // --- FINAL SETUP & STATS ---
        Object.values(room.players).forEach(p => console.log(`[GameManager] Player: ${p.name}, ID: ${p.id}, Role: ${p.role}`));

        Object.values(room.players).forEach(player => {
            if (player.role === 'DM') {
                player.stats = { ...player.stats, maxHp: 999, currentHp: 999, damageBonus: 99, shieldBonus: 99, ap: 99 };
            } else if (player.role === 'Explorer') {
                this.calculatePlayerStats(player.id, room);
            }
        });
        console.log(`[GameManager] Room ${room.id} - Assigned base stats to all players.`);

        // --- STARTING EQUIPMENT ---
        if (gameMode === 'Beginner') {
            console.log(`[GameManager] Room ${room.id} - Beginner Mode: Assigning starting equipment.`);
            const weaponCards = [...gameData.weaponCards];
            const armorCards = [...gameData.armorCards];
            shuffle(weaponCards);
            shuffle(armorCards);
            const explorers = Object.values(room.players).filter(p => p.role === 'Explorer');

            explorers.forEach(player => {
                // Assign Weapon
                if (weaponCards.length > 0) {
                    const cardToEquip = { ...weaponCards.pop(), id: this.generateUniqueCardId() };
                    player.equipment.weapon = cardToEquip;
                    this.broadcastToRoom(room.id, 'chatMessage', { 
                        senderName: 'Game Master', 
                        message: `${player.name} starts their adventure with a ${cardToEquip.name}!`, 
                        channel: 'game' 
                    });
                }
                // Assign Armor
                if (armorCards.length > 0) {
                    const cardToEquip = { ...armorCards.pop(), id: this.generateUniqueCardId() };
                    player.equipment.armor = cardToEquip;
                     this.broadcastToRoom(room.id, 'chatMessage', { 
                        senderName: 'Game Master', 
                        message: `${player.name} dons a sturdy ${cardToEquip.name}!`, 
                        channel: 'game' 
                    });
                }
                this.calculatePlayerStats(player.id, room); // Recalculate stats after equipment
            });
        } else if (gameMode === 'Advanced') {
            console.log(`[GameManager] Room ${room.id} - Advanced Mode: Rolling for bonus starting equipment.`);
            const weaponCards = [...gameData.weaponCards];
            const armorCards = [...gameData.armorCards];
            shuffle(weaponCards);
            shuffle(armorCards);
            const explorers = Object.values(room.players).filter(p => p.role === 'Explorer');
        
            explorers.forEach(player => {
                // 25% chance for a Weapon
                if (Math.random() < 0.25 && weaponCards.length > 0) {
                    const cardToEquip = { ...weaponCards.pop(), id: this.generateUniqueCardId() };
                    player.equipment.weapon = cardToEquip;
                    this.broadcastToRoom(room.id, 'chatMessage', { 
                        senderName: 'Game Master', 
                        message: `Fate smiles upon ${player.name}, who finds a ${cardToEquip.name}!`, 
                        channel: 'game' 
                    });
                }
                // 25% chance for Armor
                if (Math.random() < 0.25 && armorCards.length > 0) {
                    const cardToEquip = { ...armorCards.pop(), id: this.generateUniqueCardId() };
                    player.equipment.armor = cardToEquip;
                     this.broadcastToRoom(room.id, 'chatMessage', { 
                        senderName: 'Game Master', 
                        message: `${player.name} discovers a well-made ${cardToEquip.name}!`, 
                        channel: 'game' 
                    });
                }
                this.calculatePlayerStats(player.id, room); // Recalculate stats after potential equipment
            });
        }

        // --- DECKS & TURN ORDER ---
        console.log(`[GameManager] Room ${room.id} - Shuffling decks.`);
        room.gameState.decks.monster = [...gameData.monsterCards];
        shuffle(room.gameState.decks.monster);
        room.gameState.decks.worldEvent = [...gameData.worldEventCards];
        shuffle(room.gameState.decks.worldEvent);

        const dmId = Object.values(room.players).find(p => p.role === 'DM').id;
        const explorerIds = Object.values(room.players).filter(p => p.role === 'Explorer').map(p => p.id);
        shuffle(explorerIds);
        room.gameState.turnOrder = [dmId, ...explorerIds];
        room.gameState.currentPlayerIndex = -1;
        console.log(`[GameManager] Room ${room.id} - Turn order established: ${room.gameState.turnOrder.join(', ')}`);
        
        // --- START GAME FLOW ---
        if (gameMode === 'Advanced') {
            room.gameState.phase = 'advanced_setup_choice';
            this.broadcastToRoom(room.id, 'gameStarted', room);
        } else { // Beginner Mode
            room.gameState.phase = 'active';
            this.broadcastToRoom(room.id, 'gameStarted', room);
            console.log(`[GameManager] Room ${room.id} - Game started. Beginning first turn.`);
            setTimeout(() => this.startNextTurn(room.id), 500);
        }
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
            .filter(p => p.role === 'Explorer' && !p.isNpc)
            .every(p => p.madeAdvancedChoice);
            
        if (allExplorersMadeChoice) {
            room.gameState.phase = 'active';
            this.startNextTurn(room.id);
        }
        
        this.broadcastToRoom(room.id, 'gameStateUpdate', room);
    }
    
    playMonsterCard(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.decks.monster.length <= 0) return;

        const monsterCard = room.gameState.decks.monster.pop();
        const monsterInstance = {
            ...monsterCard,
            id: `monster-${this.generateUniqueCardId()}`,
            currentHp: monsterCard.maxHp,
            statusEffects: []
        };
        room.gameState.board.monsters.push(monsterInstance);
        this.broadcastToRoom(roomId, 'chatMessage', { senderName: 'Game Master', message: `A ${monsterInstance.name} emerges from the shadows!`, channel: 'game' });
        this.broadcastToRoom(roomId, 'gameStateUpdate', room);
    }

    playWorldEvent(roomId) {
        const room = this.rooms[roomId];
        if (!room) return;
        if (room.gameState.decks.worldEvent.length === 0) {
            console.log(`[GameManager] Room ${roomId} - World Event deck empty, reshuffling.`);
            room.gameState.decks.worldEvent = [...gameData.worldEventCards];
            shuffle(room.gameState.decks.worldEvent);
        }
        
        const eventCard = room.gameState.decks.worldEvent.pop();
        room.gameState.worldEvents.currentEvent = eventCard;
        
        this.broadcastToRoom(roomId, 'chatMessage', { 
            senderName: 'Game Master', 
            message: `A World Event occurs: ${eventCard.name}! ${eventCard.description || eventCard.outcome}`, 
            channel: 'game' 
        });

        if (eventCard.effect) {
            const effect = {
                ...eventCard, // Copy card info for reference
                endTurn: room.gameState.turnCount + eventCard.effect.duration
            };
            room.gameState.activeWorldEventEffects.push(effect);
            this.broadcastToRoom(roomId, 'chatMessage', {
                senderName: 'Game Master',
                message: eventCard.effect.applyMessage,
                channel: 'game'
            });
        }
    }

    startNextTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.turnOrder.length === 0) return;

        room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.gameState.turnOrder.length;
        const currentPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        const currentPlayer = room.players[currentPlayerId];
        
        if (!currentPlayer) return;
        const isDmTurn = currentPlayer.role === 'DM';
        
        if (isDmTurn) {
            room.gameState.turnCount++;
            
            // --- Handle Expired World Events ---
            const expiredEffects = [];
            room.gameState.activeWorldEventEffects = room.gameState.activeWorldEventEffects.filter(effect => {
                if (room.gameState.turnCount >= effect.endTurn) {
                    expiredEffects.push(effect);
                    return false; // remove from list
                }
                return true; // keep in list
            });
    
            if (expiredEffects.length > 0) {
                expiredEffects.forEach(effect => {
                    this.broadcastToRoom(roomId, 'chatMessage', { 
                        senderName: 'Game Master', 
                        message: effect.effect.removeMessage, 
                        channel: 'game' 
                    });
                });
            }
            
            room.gameState.worldEvents.currentEvent = null; // Clear previous event card display
            console.log(`[GameManager] Room ${roomId} - DM Turn Start. Turn count: ${room.gameState.turnCount}`);

            if (room.gameState.turnCount === 1 && currentPlayer.isNpc) {
                 console.log(`[GameManager] Room ${roomId} - NPC DM taking FIRST turn.`);
                 this.playMonsterCard(roomId);
                 setTimeout(() => this.startNextTurn(roomId), 3000);
                 return;
            }

            if (room.gameState.board.monsters.length === 0) {
                this.playWorldEvent(roomId);
                
                // Wait for event message to be read, then play a monster
                setTimeout(() => {
                    this.playMonsterCard(roomId);
                }, 3000); // 3s for reading the event
                setTimeout(() => this.startNextTurn(roomId), 5000); // 2s after monster appears
                return;

            } else {
                if (currentPlayer.isNpc) {
                    setTimeout(() => this.executeDmCombatTurn(roomId), 2000);
                    return;
                }
            }
        } else { // It's an Explorer's turn
             // Reset temporary shield HP at the start of the turn
            if (currentPlayer.stats.shieldHp > 0) {
                this.broadcastToRoom(roomId, 'chatMessage', { senderName: 'Game Master', message: `${currentPlayer.name}'s temporary shield fades.`, channel: 'game' });
                currentPlayer.stats.shieldHp = 0;
            }
            
            // --- Handle Status Effects at Turn Start ---
            currentPlayer.statusEffects.forEach(effect => {
                const effectDef = gameData.statusEffectDefinitions[effect.name];
                if (effectDef && effectDef.trigger === 'start' && effectDef.damage) {
                    this.applyEffect(currentPlayer.id, { type: 'damage', dice: effectDef.damage }, roomId);
                    this.broadcastToRoom(roomId, 'chatMessage', { senderName: 'Game Master', message: `${currentPlayer.name} is affected by ${effect.name}.`, channel: 'game' });
                }
            });

            // Set AP for the turn
            let baseAp = currentPlayer.stats.ap;
            const drainedEffect = currentPlayer.statusEffects.find(e => e.name === 'Drained');
            if (drainedEffect) {
                baseAp = Math.max(0, baseAp - 1);
                this.broadcastToRoom(roomId, 'chatMessage', { senderName: 'Game Master', message: `${currentPlayer.name} is Drained and starts with less AP.`, channel: 'game' });
            }
            
            // Apply World Event AP modifiers
            const apModifier = this.getStatModifier(currentPlayer, 'ap', room);
            currentPlayer.currentAp = Math.max(0, baseAp + apModifier);

            // Decrement durations AFTER applying effects for this turn start.
            currentPlayer.statusEffects = currentPlayer.statusEffects
                .map(effect => ({ ...effect, duration: effect.duration - 1 }))
                .filter(effect => effect.duration > 0);
        }
        
        if (currentPlayer.isNpc && currentPlayer.role === 'Explorer') {
            console.log(`[GameManager] Room ${roomId} - NPC Explorer ${currentPlayer.name}'s turn.`);
            setTimeout(() => this.executeNpcExplorerTurn(roomId, currentPlayer.id), 2000);
            return;
        }
        
        if (isDmTurn && room.gameState.turnCount > 1 && (room.gameState.turnCount -1) % 3 === 0) {
             Object.values(room.players).forEach(p => {
                 if (p.role === 'Explorer' && !p.isNpc) {
                    p.pendingEventRoll = true;
                 }
             });
        }

        this.broadcastToRoom(roomId, 'gameStateUpdate', room);
    }
    
    executeNpcExplorerTurn(roomId, npcId) {
        const room = this.rooms[roomId];
        const npc = room.players[npcId];
        if (!room || !npc) return;
    
        const monstersExist = room.gameState.board.monsters.length > 0;
        const hasWeapon = npc.equipment.weapon;
    
        // --- PRIORITY 1: ATTACK ---
        if (monstersExist && hasWeapon) {
            const target = room.gameState.board.monsters[0]; // Simple AI: attack the first monster
            const narrative = this.getRandomDialogue('explorer', 'attack');
            this.broadcastToRoom(roomId, 'chatMessage', { senderName: npc.name, message: narrative, channel: 'game', isNarrative: true });
            
            setTimeout(() => {
                this.resolveAttack(roomId, npc, target, hasWeapon);
                setTimeout(() => this.startNextTurn(roomId), 4000); // Wait for animations/messages
            }, 1500);
            return;
        }
        
        // --- PRIORITY 2: HEAL ---
        const healingCardIndex = npc.hand.findIndex(card => card.effect && card.effect.type === 'heal');
        const explorers = Object.values(room.players).filter(p => p.role === 'Explorer');
        const woundedAllies = explorers.filter(p => p.stats.currentHp < (p.stats.maxHp / 2));

        if (healingCardIndex !== -1 && (!monstersExist || woundedAllies.length > 0)) {
            const healingCard = npc.hand[healingCardIndex];
            const alliesToHeal = !monstersExist ? explorers.filter(p => p.stats.currentHp < p.stats.maxHp) : woundedAllies;
            
            if (alliesToHeal.length > 0) {
                alliesToHeal.sort((a, b) => (a.stats.currentHp / a.stats.maxHp) - (b.stats.currentHp / b.stats.maxHp));
                const target = alliesToHeal[0];
                const healthGained = this.rollDice(healingCard.effect.dice);
                target.stats.currentHp = Math.min(target.stats.maxHp, target.stats.currentHp + healthGained);
                npc.hand.splice(healingCardIndex, 1);
                
                const narrative = this.getRandomDialogue('explorer', 'heal');
                this.broadcastToRoom(roomId, 'chatMessage', { senderName: npc.name, message: narrative, channel: 'game', isNarrative: true });
                this.broadcastToRoom(roomId, 'chatMessage', { senderName: 'Game Master', message: `${npc.name} uses ${healingCard.name} on ${target.name}, restoring ${healthGained} HP.`, channel: 'game' });
                
                this.broadcastToRoom(roomId, 'gameStateUpdate', room);
                setTimeout(() => this.startNextTurn(roomId), 2000);
                return;
            }
        }
    
        // --- PRIORITY 3: DEFAULT (GUARD) ---
        if (npc.currentAp >= gameData.actionCosts.guard) {
            this.handlePlayerAbility(npc.id, 'guard');
        } else {
            this.broadcastToRoom(roomId, 'chatMessage', { senderName: 'Game Master', message: `${npc.name} stands ready, assessing the situation.`, channel: 'game' });
        }
    
        setTimeout(() => this.startNextTurn(roomId), 2000);
    }
    
    endTurn(socketId) {
        const room = this.getRoomBySocketId(socketId);
        if (!room) return;
        
        const currentTurnTakerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        if (socketId !== currentTurnTakerId) {
            console.log(`[GameManager] Action blocked: Not ${socketId}'s turn.`);
            return;
        }

        this.startNextTurn(room.id);
    }
    
    triggerRewardSequence(roomId) {
        const room = this.rooms[roomId];
        if (!room) return;
    
        const rewardPool = [
            ...gameData.weaponCards,
            ...gameData.armorCards,
            ...gameData.spellCards,
            ...gameData.itemCards,
            ...gameData.playerEventCards,
            ...gameData.discoveryCards // High-tier rewards
        ];
        shuffle(rewardPool);
    
        const chances = [0.60, 0.40, 0.20]; // 60% for 1st, 40% for 2nd, 20% for 3rd
        let rewardsFound = 0;
    
        for (const chance of chances) {
            if (Math.random() < chance) {
                if (rewardPool.length > 0) {
                    const card = rewardPool.pop();
                    const cardInstance = { ...card, id: this.generateUniqueCardId() };
                    room.gameState.lootPool.push(cardInstance);
                    rewardsFound++;
                    this.broadcastToRoom(roomId, 'chatMessage', { 
                        senderName: 'Game Master', 
                        message: `The party has discovered a reward! A "${cardInstance.name}" has been added to the party loot.`, 
                        channel: 'game' 
                    });
                }
            } else {
                break; // Stop if a roll fails
            }
        }
    
        if (rewardsFound === 0) {
            this.broadcastToRoom(roomId, 'chatMessage', { 
                senderName: 'Game Master', 
                message: `The party searches the area but finds nothing of value this time.`, 
                channel: 'game' 
            });
        }
    }
    
    getStatModifier(character, statToModify, room) {
        let modifier = 0;
        const isExplorer = character && character.role === 'Explorer';
        const isMonster = character && character.type === 'Monster';
    
        for (const effect of room.gameState.activeWorldEventEffects) {
            const effectData = effect.effect;
            if (effectData.stat !== statToModify) continue;
    
            const targetMatch = (
                effectData.target === 'all' ||
                (effectData.target === 'all_explorers' && isExplorer) ||
                (effectData.target === 'all_monsters' && isMonster)
            );
            
            if (targetMatch) {
                modifier += effectData.value;
            }
        }
        return modifier;
    }

    resolveAttack(roomId, attacker, target, weapon) {
        const room = this.rooms[roomId];
        if (!room || !attacker || !target || !weapon) return;
    
        const apCost = weapon.apCost || 1;
        if (attacker.currentAp < apCost) {
            io.to(attacker.id).emit('actionError', "Not enough Action Points to attack!");
            return;
        }
        attacker.currentAp -= apCost;
    
        const classBonus = (gameData.classes[attacker.class]?.baseDamageBonus) || 0;
        const weaponBonus = (weapon.effect?.bonuses?.damage) || 0;
        const eventBonus = this.getStatModifier(attacker, 'damageBonus', room);
        const totalBonus = classBonus + weaponBonus + eventBonus;
    
        const hitRoll = this.rollDice('1d20');
        const attackRoll = hitRoll + totalBonus;
        
        let message = '';
        const requiredRoll = target.requiredRollToHit + this.getStatModifier(target, 'requiredRollToHit', room);
    
        if (attackRoll >= requiredRoll) {
            const damageDice = weapon.effect.dice;
            const rawDamageRoll = this.rollDice(damageDice);
            const totalDamage = rawDamageRoll + totalBonus;

            console.log(`[Damage Calc] Attacker: ${attacker.name}, Weapon: ${weapon.name}`);
            console.log(`DMG = [Dice Roll: ${rawDamageRoll}] + [Total Bonus: ${totalBonus} (Class:${classBonus} + Wpn:${weaponBonus} + Event:${eventBonus})] = Total: ${totalDamage}`);
            
            target.currentHp -= totalDamage;
            message = `${attacker.name} attacks ${target.name} for ${totalDamage} damage! (${rawDamageRoll} + ${totalBonus} Bonus)`;
            
            this.broadcastToRoom(roomId, 'attackAnimation', { 
                hit: true,
                attackerName: attacker.name, 
                totalRollToHit: attackRoll,
                requiredRoll,
                damageDice, 
                rawDamageRoll, 
                damageBonus: totalBonus,
                totalDamage 
            });
            
            if (target.currentHp <= 0) {
                message += ` ${target.name} has been defeated!`;
                room.gameState.board.monsters = room.gameState.board.monsters.filter(m => m.id !== target.id);
                this.triggerRewardSequence(roomId);
            }
        } else {
            message = `${attacker.name} rolls a ${attackRoll} to hit... Miss!`;
            this.broadcastToRoom(roomId, 'attackAnimation', {
                hit: false,
                attackerName: attacker.name,
                totalRollToHit: attackRoll,
                requiredRoll
            });
        }
        
        this.broadcastToRoom(roomId, 'chatMessage', { senderName: 'Game Master', message, channel: 'game' });
        this.broadcastToRoom(roomId, 'gameStateUpdate', room);
    }
    
    resolveMonsterAttack(room, monster, target) {
        if (!room || !monster || !target) return;

        const defenseBonusFromEvents = this.getStatModifier(target, 'shieldBonus', room);
        const playerDefense = 10 + (target.stats.shieldBonus || 0) + defenseBonusFromEvents;
        const hitRoll = this.rollDice('1d20') + monster.attackBonus;
        
        let message = '';
        if (hitRoll >= playerDefense) {
            const damageBonusFromEvents = this.getStatModifier(monster, 'damageBonus', room);
            let damage = this.rollDice(monster.effect.dice) + damageBonusFromEvents;
            let damageAbsorbed = 0;
            
            if (target.stats.shieldHp > 0) {
                damageAbsorbed = Math.min(damage, target.stats.shieldHp);
                target.stats.shieldHp -= damageAbsorbed;
                damage -= damageAbsorbed;
            }

            target.stats.currentHp = Math.max(0, target.stats.currentHp - damage);
            
            const totalDealt = damage + damageAbsorbed;
            let damageMessage = `dealing ${totalDealt} damage!`;
            if (damageAbsorbed > 0) {
                damageMessage = `dealing ${totalDealt} damage! (${damageAbsorbed} absorbed by their shield.)`;
            }
            message = `${monster.name} attacks ${target.name} and hits, ${damageMessage}`;
            
            if (target.stats.currentHp === 0) {
                target.lifeCount -= 1;
                message += ` ${target.name} has been defeated! They have ${target.lifeCount} lives remaining.`;
                if(target.lifeCount > 0) {
                    // Future respawn logic can go here
                } else {
                    message += ` ${target.name} is out of the fight!`;
                }
            }
        } else {
            message = `${monster.name} attacks ${target.name} but misses!`;
        }
        
        this.broadcastToRoom(room.id, 'chatMessage', { senderName: 'Game Master', message, channel: 'game' });
    }
    
    executeDmCombatTurn(roomId) {
        const room = this.rooms[roomId];
        if (!room) return;
        
        const monsters = room.gameState.board.monsters;
        const livingExplorers = Object.values(room.players).filter(p => p.role === 'Explorer' && p.stats.currentHp > 0);
        
        if (monsters.length === 0 || livingExplorers.length === 0) {
            this.startNextTurn(roomId); // No monsters or no one to attack, end turn
            return;
        }

        const processAttack = (index) => {
            if (index >= monsters.length) {
                // All monsters have attacked. Check if reinforcements are needed.
                if (monsters.length === 1 && livingExplorers.length >= 3 && Math.random() < 0.4) {
                    this.broadcastToRoom(roomId, 'chatMessage', { senderName: 'Game Master', message: `The commotion attracts another foe!`, channel: 'game' });
                    this.playMonsterCard(roomId);
                }
                setTimeout(() => this.startNextTurn(roomId), 1000); 
                return;
            }
            
            const monster = monsters[index];
            const target = livingExplorers[Math.floor(Math.random() * livingExplorers.length)];
            
            this.resolveMonsterAttack(room, monster, target);
            this.broadcastToRoom(roomId, 'gameStateUpdate', room);

            setTimeout(() => processAttack(index + 1), 2500); // 2.5s between monster attacks
        };

        processAttack(0); // Start the attack sequence
    }
    
    resolveNpcWorldEventSave(roomId, npcId, eventCard) {
        const room = this.rooms[roomId];
        const npc = room.players[npcId];
        if (!room || !npc || !eventCard) return;

        const bonus = npc.stats[eventCard.save.toLowerCase()] || 0;
        const d20Roll = this.rollDice('1d20');
        const totalRoll = d20Roll + bonus;
        
        let message = `${npc.name} attempts a ${eventCard.save} save (rolled ${d20Roll} + ${bonus} = ${totalRoll} vs DC ${eventCard.dc})... `;
        
        if (totalRoll >= eventCard.dc) {
            message += `Success! ${npc.name} ${eventCard.successMessage}`;
        } else {
            message += `Failure! ${npc.name} ${eventCard.failureEffect.message}`;
            if (eventCard.failureEffect && eventCard.failureEffect.effect) {
                this.applyEffect(npc.id, eventCard.failureEffect.effect, roomId);
            }
        }
        
        this.broadcastToRoom(roomId, 'chatMessage', { senderName: 'Game Master', message, channel: 'game' });
        this.broadcastToRoom(roomId, 'gameStateUpdate', room);

        // This NPC has finished its save. Remove it from the pending list.
        room.gameState.worldEvents.pendingSaves = room.gameState.worldEvents.pendingSaves.filter(id => id !== npcId);
        this.checkAndProceedAfterWorldEvent(roomId);
    }
    
    checkAndProceedAfterWorldEvent(roomId) {
        const room = this.rooms[roomId];
        if (!room || room.gameState.worldEvents.pendingSaves.length > 0) {
            return; // Still waiting for other players
        }

        if (!room.gameState.worldEvents.resolved) {
            room.gameState.worldEvents.resolved = true;
            this.triggerRewardSequence(roomId);
        }

        // All saves are done. Now continue the DM's turn robustly.
        this.broadcastToRoom(roomId, 'chatMessage', { senderName: 'Game Master', message: 'All players have reacted to the event. The journey continues...', channel: 'game' });
        
        // This is the core continuation of the DM's turn to prevent freezes.
        setTimeout(() => {
            console.log(`[GameManager] Room ${roomId} - World event resolved. DM is now playing a monster.`);
            this.playMonsterCard(roomId);
            
            // After the monster is played, end the DM's turn to pass to the next player.
            setTimeout(() => {
                console.log(`[GameManager] Room ${roomId} - DM turn ending after World Event resolution.`);
                this.startNextTurn(roomId); 
            }, 2000); // Wait for monster card animation/display
        }, 1000); // Short delay after event resolution message
    }

    applyEffect(targetId, effect, roomId) {
        const room = this.rooms[roomId];
        const target = room.players[targetId];
        if (!target || !effect) return;
    
        let message = '';
    
        switch(effect.type) {
            case 'damage': {
                const damage = this.rollDice(effect.dice);
                target.stats.currentHp = Math.max(0, target.stats.currentHp - damage);
                message = `${target.name} takes ${damage} damage!`;
                // future player death logic here...
                break;
            }
            case 'status': {
                const existingEffect = target.statusEffects.find(e => e.name === effect.status);
                if (existingEffect) {
                    existingEffect.duration = Math.max(existingEffect.duration, effect.duration);
                } else {
                    target.statusEffects.push({ name: effect.status, duration: effect.duration });
                }
                message = `${target.name} is now ${effect.status}!`;
                break;
            }
        }
    
        if (message) {
            this.broadcastToRoom(roomId, 'chatMessage', { senderName: 'Game Master', message, channel: 'game' });
        }
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
                deck = classSpecificDeck.length >= 3 ? classSpecificDeck : allDiscoveryCards;
            } else {
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
        // This lookup is complex and was prone to errors. Simplified it slightly, but the root issue is finding the card template
        // after a unique ID has been assigned. We find by name as a fallback.
        const chosenCardTemplate = allEventCards.find(c => c.name === allEventCards.find(c2 => c2.id === chosenCardId)?.name);
        const chosenCard = { ...chosenCardTemplate, id: chosenCardId };


        if (!chosenCard || !chosenCard.type) {
            console.error(`[GameManager] CRITICAL ERROR: Could not find valid card data for chosen card ID ${chosenCardId}. Aborting to prevent crash.`);
            return;
        }

        io.to(socketId).emit('eventCardReveal', { chosenCard });

        if (chosenCard.type === 'Player Event') {
            this.broadcastToRoom(room.id, 'chatMessage', { senderName: 'Game Master', message: `${player.name} triggered a Player Event: ${chosenCard.name}! ${chosenCard.description}`, channel: 'game' });
             // CRITICAL FIX: Add robust check for a valid, processable effect to prevent crashes from bad data.
            if (chosenCard.effect && chosenCard.effect.type && chosenCard.effect.dice) {
                if (chosenCard.effect.type === 'heal') {
                    player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + this.rollDice(chosenCard.effect.dice));
                }
                if (chosenCard.effect.type === 'damage') {
                    player.stats.currentHp -= this.rollDice(chosenCard.effect.dice);
                }
            }
        } else {
            player.hand.push(chosenCard);
            this.broadcastToRoom(room.id, 'chatMessage', { senderName: 'Game Master', message: `${player.name} made a discovery! A new item has been found!`, channel: 'game' });
        }

        setTimeout(() => this.broadcastToRoom(room.id, 'gameStateUpdate', room), 4000);
    }

    handlePlayerAbility(socketId, action) {
        const room = this.getRoomBySocketId(socketId);
        if (!room) return;
        const player = room.players[socketId];
        const currentTurnTakerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        
        if (!player || player.id !== currentTurnTakerId) return;

        const actionCost = gameData.actionCosts[action] || 1;
        if (player.currentAp < actionCost) {
            if (!player.isNpc) {
                io.to(socketId).emit('actionError', "Not enough AP to perform this action.");
            }
            return;
        }
        
        player.currentAp -= actionCost;
        let message = '';

        switch(action) {
            case 'briefRespite': {
                if (player.healthDice.current > 0) {
                    const healthGained = this.rollDice('1d8') + (player.class === 'Cleric' ? 2 : 0);
                    player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healthGained);
                    player.healthDice.current -= 1;
                    message = `${player.name} takes a brief respite, using one health die to recover ${healthGained} HP.`;
                } else {
                    message = `${player.name} tries to rest, but has no health dice remaining.`;
                    player.currentAp += actionCost;
                }
                break;
            }
            case 'fullRest': {
                if (player.healthDice.current > 1) {
                    const healthGained = this.rollDice('2d8') + (player.class === 'Cleric' ? 4 : 0);
                    player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + healthGained);
                    player.healthDice.current -= 2;
                    message = `${player.name} takes a full rest, using two health dice to recover ${healthGained} HP.`;
                } else {
                    message = `${player.name} tries to take a full rest, but doesn't have enough health dice.`;
                    player.currentAp += actionCost;
                }
                break;
            }
            case 'guard': {
                const armor = player.equipment.armor;
                if (armor && armor.guardBonus > 0) {
                    player.stats.shieldHp = armor.guardBonus;
                    message = `${player.name} raises their shield, gaining ${armor.guardBonus} temporary Shield HP!`;
                } else {
                    // Fallback for players without shields or guardBonus
                    const existingGuard = player.statusEffects.find(e => e.name === 'Guarded');
                    if (existingGuard) {
                        existingGuard.duration = 2; // Refresh duration
                    } else {
                        player.statusEffects.push({ name: 'Guarded', duration: 2 });
                    }
                    message = `${player.name} takes a defensive stance, guarding against incoming attacks.`;
                }
                break;
            }
        }
        
        if (message) {
            this.broadcastToRoom(room.id, 'chatMessage', { senderName: 'Game Master', message, channel: 'game' });
        }
        this.broadcastToRoom(room.id, 'gameStateUpdate', room);
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
        }
    });
    
    socket.on('chooseClass', ({ classId }) => {
        const room = gameManager.getRoomBySocketId(socket.id);
        if (room && room.players[socket.id]) {
            const player = room.players[socket.id];
            player.class = classId;
            // A player joining mid-game won't have stats yet, so calculate them now.
            if (player.stats.maxHp === 0) {
                 gameManager.calculatePlayerStats(socket.id, room);
                 // Set HP to full for the new player
                 player.stats.currentHp = player.stats.maxHp;
            } else {
                gameManager.calculatePlayerStats(socket.id, room);
            }
            io.to(room.id).emit('playerListUpdate', room);
            io.to(room.id).emit('gameStateUpdate', room);
        }
    });
    
    socket.on('startGame', ({ gameMode }) => {
        const room = gameManager.getRoomBySocketId(socket.id);
        if (room && socket.id === room.hostId) {
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
            // Validate that the cardId sent is the equipped weapon
            if (target && player.equipment.weapon && player.equipment.weapon.id === data.cardId) {
                const weapon = player.equipment.weapon;
                gameManager.resolveAttack(room.id, player, target, weapon);
                io.to(room.id).emit('chatMessage', { senderName: player.name, message: data.narrative, channel: 'game', isNarrative: true });
            } else {
                console.log(`[GameManager] Invalid attack by ${player.name}: Weapon/Target mismatch.`);
            }
        } else if (['briefRespite', 'fullRest', 'guard'].includes(data.action)) {
            gameManager.handlePlayerAbility(socket.id, data.action);
        }
    });
    
    socket.on('dmAction', ({ action }) => {
        const room = gameManager.getRoomBySocketId(socket.id);
        if (!room) return;
        const player = room.players[socket.id];
    
        const currentTurnTakerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
        if (!player || player.role !== 'DM' || player.id !== currentTurnTakerId) {
            console.log(`[GameManager] Unauthorized DM action by ${player?.name || 'unknown'}`);
            return;
        }
    
        if (action === 'playMonster') {
            gameManager.playMonsterCard(room.id);
        }
    });
    
    socket.on('equipItem', ({ cardId }) => {
        const room = gameManager.getRoomBySocketId(socket.id);
        const player = room.players[socket.id];
        if (!room || !player) return;

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;
        
        const cardToEquip = player.hand[cardIndex];
        const itemType = cardToEquip.type.toLowerCase();
        
        if (player.equipment[itemType]) {
            player.hand.push(player.equipment[itemType]);
        }
        
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
    
    socket.on('rollForWorldEventSave', () => {
        const room = gameManager.getRoomBySocketId(socket.id);
        const player = room.players[socket.id];
        if (!room || !player || !player.pendingWorldEventSave) return;
        
        const eventData = player.pendingWorldEventSave;
        const bonus = player.stats[eventData.save.toLowerCase()] || 0;
        const d20Roll = gameManager.rollDice('1d20');
        const totalRoll = d20Roll + bonus;
        
        const success = totalRoll >= eventData.dc;
        
        let message = `${player.name} attempts a ${eventData.save} save (rolled ${d20Roll} + ${bonus} = ${totalRoll} vs DC ${eventData.dc})... `;

        if (success) {
            message += `Success! ${player.name} ${eventData.successMessage}`;
        } else {
            message += `Failure! ${player.name} ${eventData.failureEffect.message}`;
            if (eventData.failureEffect && eventData.failureEffect.effect) {
                gameManager.applyEffect(player.id, eventData.failureEffect.effect, room.id);
            }
        }

        io.to(socket.id).emit('worldEventSaveResult', { d20Roll, bonus, totalRoll, dc: eventData.dc, success });
        gameManager.broadcastToRoom(room.id, 'chatMessage', { senderName: 'Game Master', message, channel: 'game' });
        
        player.pendingWorldEventSave = null;
        
        // This player has finished their save. Remove them from the pending list.
        room.gameState.worldEvents.pendingSaves = room.gameState.worldEvents.pendingSaves.filter(id => id !== socket.id);
        
        gameManager.broadcastToRoom(room.id, 'gameStateUpdate', room);
        
        gameManager.checkAndProceedAfterWorldEvent(room.id);
    });

    // --- VOICE CHAT ---
    socket.on('join-voice', () => {
        const room = gameManager.getRoomBySocketId(socket.id);
        if (room) {
            // Get all other peers in the voice chat
            const peers = room.voiceChatPeers.filter(peerId => peerId !== socket.id);
            
            // Send the list of existing peers to the new joiner
            socket.emit('voice-peers', peers);
            
            // Add the new joiner to the list
            room.voiceChatPeers.push(socket.id);
            
            // Notify all other peers that a new peer has joined
            socket.to(room.id).emit('voice-peer-join', { peerId: socket.id });
        }
    });

    socket.on('voice-offer', ({ offer, toId }) => {
        socket.to(toId).emit('voice-offer', { offer, fromId: socket.id });
    });

    socket.on('voice-answer', ({ answer, toId }) => {
        socket.to(toId).emit('voice-answer', { answer, fromId: socket.id });
    });

    socket.on('voice-ice-candidate', ({ candidate, toId }) => {
        socket.to(toId).emit('voice-ice-candidate', { candidate, fromId: socket.id });
    });


    socket.on('disconnect', () => {
        console.log(`[Socket.IO] User disconnected: ${socket.id}`);
        const room = gameManager.getRoomBySocketId(socket.id);
        if (room) {
            const player = room.players[socket.id];
            
            // Remove from voice chat
            room.voiceChatPeers = room.voiceChatPeers.filter(id => id !== socket.id);
            socket.to(room.id).emit('voice-peer-disconnect', { peerId: socket.id });
            
            // Handle player leaving game logic
            const isExplorer = player.role === 'Explorer';
            const gameIsActive = room.gameState.phase === 'active';

            if (isExplorer && gameIsActive) {
                console.log(`[GameManager] Explorer ${player.name} left. Converting to NPC.`);
                // Convert to NPC instead of removing
                const npc = gameManager.createPlayerObject(socket.id, `${player.name} (NPC)`, 'Explorer', true);
                npc.class = player.class;
                npc.stats = player.stats;
                npc.lifeCount = player.lifeCount;
                npc.healthDice = player.healthDice;
                npc.hand = player.hand;
                npc.equipment = player.equipment;
                room.players[socket.id] = npc;
                 gameManager.broadcastToRoom(room.id, 'chatMessage', { 
                    senderName: 'Game Master', 
                    message: `${player.name} has lost connection. Their spirit will fight on!`, 
                    channel: 'game' 
                });
            } else {
                 console.log(`[GameManager] Player ${player.name} left room ${room.id}.`);
                 delete room.players[socket.id];
            }

            // If host leaves, assign a new host
            if (socket.id === room.hostId) {
                const otherPlayers = Object.values(room.players).filter(p => !p.isNpc);
                if (otherPlayers.length > 0) {
                    room.hostId = otherPlayers[0].id;
                    console.log(`[GameManager] Host left. New host is ${otherPlayers[0].name}.`);
                } else {
                    // No human players left, clean up room
                    console.log(`[GameManager] Last player left room ${room.id}. Deleting room.`);
                    delete gameManager.rooms[room.id];
                    return; // No need to broadcast update if room is gone
                }
            }

            io.to(room.id).emit('playerLeft', { playerName: player.name });
            io.to(room.id).emit('playerListUpdate', room);
            io.to(room.id).emit('gameStateUpdate', room);
        }
    });
});


// --- Server Listen ---
server.listen(PORT, () => {
    console.log(`[Server] Express server running on port ${PORT}`);
});
