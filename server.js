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
                worldEvents: { currentEvent: null, currentSequence: [], sequenceActive: false },
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
            stats: { maxHp: 0, currentHp: 0, damageBonus: 0, shieldBonus: 0, ap: 0 },
            lifeCount: 3,
            healthDice: { max: 0, current: 0 },
            statusEffects: [], // e.g., { name: 'Poisoned', duration: 3 }
            currentAp: 0,
            pendingEventRoll: false,
            pendingEventChoice: false,
            madeAdvancedChoice: false,
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
            console.log(`[GameManager] Join failed: Room ${roomId} is full with 5 human players.`);
            socket.emit('actionError', 'This room is full with 5 players.');
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
        if (!classData) { // Fallback for safety
             player.stats = { maxHp: 20, currentHp: 20, damageBonus: 0, shieldBonus: 0, ap: 3 };
             return;
        }
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

        // --- FINAL SETUP ---
        Object.values(room.players).forEach(p => console.log(`[GameManager] Player: ${p.name}, ID: ${p.id}, Role: ${p.role}`));

        Object.values(room.players).forEach(player => {
            if (player.role === 'DM') {
                player.stats = { maxHp: 999, currentHp: 999, damageBonus: 99, shieldBonus: 99, ap: 99 };
            } else if (player.role === 'Explorer') {
                this.calculatePlayerStats(player.id, room);
            }
        });
        console.log(`[GameManager] Room ${room.id} - Assigned stats to all players.`);

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
        
        if (gameMode === 'Beginner') {
            console.log(`[GameManager] Room ${room.id} - Beginner Mode: Assigning starting WEAPONS.`);
            const weaponCards = [...gameData.weaponCards];
            shuffle(weaponCards);
            const explorers = Object.values(room.players).filter(p => p.role === 'Explorer');
            explorers.forEach(player => {
                if (weaponCards.length > 0) {
                    const cardToEquip = { ...weaponCards.pop(), id: this.generateUniqueCardId() };
                    player.equipment.weapon = cardToEquip;
                    this.calculatePlayerStats(player.id, room);
                    this.broadcastToRoom(room.id, 'chatMessage', { 
                        senderName: 'Game Master', 
                        message: `${player.name} starts their adventure with a ${cardToEquip.name}!`, 
                        channel: 'game' 
                    });
                }
            });
            room.gameState.phase = 'active';
            this.broadcastToRoom(room.id, 'gameStarted', room);
            console.log(`[GameManager] Room ${room.id} - Game started. Beginning first turn.`);
            setTimeout(() => this.startNextTurn(room.id), 500);
        } else if (gameMode === 'Advanced') {
            room.gameState.phase = 'advanced_setup_choice';
            this.broadcastToRoom(room.id, 'gameStarted', room);
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
            message: `A World Event occurs: ${eventCard.name}! ${eventCard.outcome}`, 
            channel: 'game' 
        });
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
            room.gameState.worldEvents.currentEvent = null; // Clear previous event
            console.log(`[GameManager] Room ${roomId} - DM Turn Start. Turn count: ${room.gameState.turnCount}`);
            
            // --- Post-Combat Flow ---
            if (room.gameState.board.monsters.length === 0 && room.gameState.turnCount > 1) {
                console.log(`[GameManager] Room ${roomId} - DM turn, no monsters. Starting post-combat flow.`);
                this.playWorldEvent(roomId);
                
                setTimeout(() => {
                    console.log(`[GameManager] Room ${roomId} - Spawning new monster post-event.`);
                    this.playMonsterCard(roomId);
                    // Update state to clients after monster spawn
                    this.broadcastToRoom(roomId, 'gameStateUpdate', room);
                }, 3000); 
                
                setTimeout(() => {
                    console.log(`[GameManager] Room ${roomId} - Ending DM post-combat turn.`);
                    this.startNextTurn(roomId);
                }, 5000); 
                return; // Stop further execution for this turn
            }
        }

        currentPlayer.currentAp = currentPlayer.stats.ap;
        
        if (isDmTurn && currentPlayer.isNpc && room.gameState.turnCount === 1) {
            console.log(`[GameManager] Room ${roomId} - NPC DM is taking its automated first turn.`);
            this.playMonsterCard(roomId);
            setTimeout(() => {
                console.log(`[GameManager] Room ${roomId} - Automatically ending NPC DM's first turn.`);
                this.startNextTurn(roomId);
            }, 3000);
            return;
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
        const currentTurnTaker = room.players[currentTurnTakerId];

        if (currentTurnTaker?.role === 'DM' && currentTurnTaker.isNpc && socketId === room.hostId) {
            this.startNextTurn(room.id);
            return;
        }

        if (socketId !== currentTurnTakerId) {
            console.log(`[GameManager] Action blocked: Not ${socketId}'s turn.`);
            return;
        }

        this.startNextTurn(room.id);
    }
    
    resolveAttack(roomId, attacker, target, weapon) {
        const room = this.rooms[roomId];
        if (!room || !attacker || !target || !weapon) return;
        
        const hitRoll = this.rollDice('1d20');
        const attackRoll = hitRoll + attacker.stats.damageBonus;
        
        const damageDice = weapon.effect.dice;
        const rawDamageRoll = this.rollDice(damageDice);
        const damageBonus = attacker.stats.damageBonus;
        const totalDamage = rawDamageRoll + damageBonus;
        
        let message = '';
        
        if (attackRoll >= target.requiredRollToHit) {
            target.currentHp -= totalDamage;
            message = `${attacker.name} rolls a ${rawDamageRoll} on their ${damageDice} + ${damageBonus} Bonus for a total of ${totalDamage} damage to ${target.name}!`;
            
            if (target.currentHp <= 0) {
                message += ` ${target.name} has been defeated!`;
                room.gameState.board.monsters = room.gameState.board.monsters.filter(m => m.id !== target.id);
            }
            this.broadcastToRoom(roomId, 'attackAnimation', { attackerName: attacker.name, damageDice, rawDamageRoll, damageBonus, totalDamage });
        } else {
            message = `${attacker.name} rolls a ${attackRoll} to hit... Miss!`;
        }
        
        this.broadcastToRoom(roomId, 'chatMessage', { senderName: 'Game Master', message, channel: 'game' });
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
        const chosenCardTemplate = allEventCards.find(c => c.id === chosenCardId.split('-')[0] || c.name === allEventCards.find(c2 => c2.id === chosenCardId)?.name);
        const chosenCard = { ...chosenCardTemplate, id: chosenCardId };

        if (!chosenCard) return;

        io.to(socketId).emit('eventCardReveal', { chosenCard });

        if (chosenCard.type === 'Player Event') {
            this.broadcastToRoom(room.id, 'chatMessage', { senderName: 'Game Master', message: `${player.name} triggered a Player Event: ${chosenCard.name}! ${chosenCard.description}`, channel: 'game' });
            if (chosenCard.effect.type === 'heal') player.stats.currentHp = Math.min(player.stats.maxHp, player.stats.currentHp + this.rollDice(chosenCard.effect.dice));
            if (chosenCard.effect.type === 'damage') player.stats.currentHp -= this.rollDice(chosenCard.effect.dice);
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
                const existingGuard = player.statusEffects.find(e => e.name === 'Guarded');
                if (existingGuard) {
                    existingGuard.duration = 2;
                } else {
                    player.statusEffects.push({ name: 'Guarded', duration: 2 });
                }
                message = `${player.name} takes a defensive stance, guarding against incoming attacks.`;
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
            room.players[socket.id].class = classId;
            gameManager.calculatePlayerStats(socket.id, room);
            io.to(room.id).emit('playerListUpdate', room);
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
             const weapon = player.equipment.weapon;
             if(target && weapon) {
                 gameManager.resolveAttack(room.id, player, target, weapon);
                 io.to(room.id).emit('chatMessage', { senderName: player.name, message: data.narrative, channel: 'game', isNarrative: true });
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
            const playerName = room.players[socket.id]?.name || 'A player';
            delete room.players[socket.id];
            
            room.voiceChatPeers = room.voiceChatPeers.filter(id => id !== socket.id);
            socket.to(room.id).emit('voice-peer-disconnect', { peerId: socket.id });

            if (Object.values(room.players).filter(p => !p.isNpc).length === 0) {
                delete gameManager.rooms[room.id];
                console.log(`[GameManager] Room ${room.id} closed as all human players left.`);
            } else {
                 io.to(room.id).emit('playerListUpdate', room);
                 io.to(room.id).emit('chatMessage', { senderName: 'System', message: `${playerName} has left the game.`, channel: 'game'});
            }
        }
    });
});

// --- Server Start ---
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});