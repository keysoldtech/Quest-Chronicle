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
            healthDice: { max: 0, current: 0 },
            statusEffects: [], // e.g., { name: 'Poisoned', duration: 3 }
            currentAp: 0,
        };
    }

    joinRoom(socket, roomId, playerName) {
        const room = this.rooms[roomId];
        // FIX: Add detailed logging to debug connection issues and verify player count.
        if (!room) {
            console.log(`[GameManager] Join failed: Room ${roomId} not found.`);
            return null;
        }
        if (Object.keys(room.players).length >= 5) {
            console.log(`[GameManager] Join failed: Room ${roomId} is full (${Object.keys(room.players).length} players).`);
            return null;
        }
        
        room.players[socket.id] = this.createPlayerObject(socket.id, playerName);
        console.log(`[GameManager] ${playerName} (${socket.id}) joined room ${roomId}. Current players: ${Object.keys(room.players).length}.`);
        return room;
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

        // Add bonuses from equipment
        for (const slot in player.equipment) {
            const item = player.equipment[slot];
            if (item?.effect?.bonuses) {
                stats.shieldBonus += item.effect.bonuses.shield || 0;
                stats.ap += item.effect.bonuses.ap || 0;
            }
        }
        
        stats.maxHp = classData.baseHp + stats.shieldBonus;
        
        const oldMaxHp = player.stats.maxHp;
        player.stats = { ...player.stats, ...stats };

        if(oldMaxHp === 0) { // First time setup
            player.stats.currentHp = player.stats.maxHp;
            player.healthDice = { max: classData.healthDice, current: classData.healthDice };
        } else if (player.stats.maxHp !== oldMaxHp) { // HP changed due to equipment
            const hpDiff = player.stats.maxHp - oldMaxHp;
            player.stats.currentHp = Math.max(0, player.stats.currentHp + hpDiff);
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

    equipItem(socketId, cardId, isSetup = false) {
        const result = this.getPlayer(socketId);
        if (!result) return null;
        const { player, room } = result;

        const card = isSetup ? { id: cardId, ...gameData.weaponCards.find(c => c.id === cardId) || gameData.armorCards.find(c => c.id === cardId) } : player.hand.find(c => c.id === cardId);
        const cardIndex = isSetup ? -1 : player.hand.findIndex(c => c.id === cardId);
        if (!card) return null;

        const itemType = card.type.toLowerCase();

        if (itemType === 'weapon' || itemType === 'armor') {
            if (player.equipment[itemType] && !isSetup) {
                player.hand.push(player.equipment[itemType]);
            }
            player.equipment[itemType] = card;
            if(!isSetup) player.hand.splice(cardIndex, 1);
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
        const explorerIds = [];
        Object.values(room.players).forEach(player => {
            if (player.role === 'Explorer') {
                if (!player.class) {
                    player.class = classIds[Math.floor(Math.random() * classIds.length)];
                }
                explorerIds.push(player.id);
            }
            this.calculatePlayerStats(player.id, room);
        });
        
        shuffle(explorerIds);
        room.gameState.turnOrder = explorerIds;
        room.gameState.currentPlayerIndex = -1; // -1 indicates pre-game or DM's turn

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
                if(weapon) this.equipItem(p.id, weapon.id, true);
                if(armor) this.equipItem(p.id, armor.id, true);
                if(room.gameState.decks.spell.length > 0) p.hand.push(room.gameState.decks.spell.pop());
            });
            this.transitionToWorldEventSetup(room);
        } else if (gameMode === 'Advanced') {
            room.gameState.phase = 'advanced_setup_choice';
            const currentExplorerIds = Object.keys(room.players).filter(id => room.players[id].role === 'Explorer');
            room.gameState.advancedChoicesPending = currentExplorerIds.filter(id => !room.players[id].isNpc);
            if (room.gameState.advancedChoicesPending.length === 0) { // All explorers are NPCs
                 currentExplorerIds.forEach(id => {
                     if(room.gameState.decks.item.length > 0) room.players[id].hand.push(room.gameState.decks.item.pop());
                 });
                 this.transitionToWorldEventSetup(room);
            }
        }
        
        for (let i = 0; i < 5; i++) {
            if (room.gameState.decks.worldEvent.length > 0) room.players[dmId].hand.push(room.gameState.decks.worldEvent.pop());
            if (room.gameState.decks.monster.length > 0) room.players[dmId].hand.push(room.gameState.decks.monster.pop());
        }

        Object.keys(room.players).forEach(id => this.calculatePlayerStats(id, room));
        return room;
    }
    
    // --- COMBAT & ACTION LOGIC ---

    getCombatant(room, id) {
        if (room.players[id]) return room.players[id];
        return room.gameState.board.monsters.find(m => m.id === id);
    }

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
        let combatant = this.getCombatant(room, currentId);
        
        if (!combatant) {
            this.nextTurn(roomId);
            return;
        }

        this.processTurnEffects(roomId, currentId, 'start');

        combatant.currentAp = combatant.stats?.ap || combatant.ap;
        
        io.to(roomId).emit('chatMessage', { senderName: 'System', message: `It's ${combatant.name}'s turn!`, channel: 'game' });
        io.to(roomId).emit('gameStateUpdate', room);

        if (combatant.isNpc || (combatant.role && combatant.role !== 'Explorer') || combatant.statusEffects.some(e => e.name === 'Stunned')) {
            setTimeout(() => this.executeNpcTurn(roomId, currentId), 2000);
        }
    }
    
    nextTurn(roomId) {
        const room = this.rooms[roomId];
        const combatState = room.gameState.combatState;
        if (!combatState.isActive) return;

        const currentId = combatState.turnOrder[combatState.currentTurnIndex];
        this.processTurnEffects(roomId, currentId, 'end');

        const explorersAlive = Object.values(room.players).some(p => p.role === 'Explorer' && p.stats.currentHp > 0 && p.lifeCount > 0);
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
        
        // After combat, it's the DM's turn to set the scene or start a new fight
        room.gameState.currentPlayerIndex = -1; 
        const dm = Object.values(room.players).find(p => p.role === 'DM');
        if (dm && dm.isNpc) {
            setTimeout(() => this.executeNpcTurn(room.id, dm.id), 1500);
        }
        
        io.to(roomId).emit('gameStateUpdate', room);
    }

    resolveAttack(roomId, attackerId, targetId, weaponOrSpell) {
        const room = this.rooms[roomId];
        const attacker = this.getCombatant(room, attackerId);
        const target = this.getCombatant(room, targetId);
        if (!attacker || !target) return;

        let attackBonus = attacker.stats?.damageBonus || attacker.attackBonus || 0;
        let rollModifier = 0;
        
        (attacker.statusEffects || []).forEach(effect => {
            const def = gameData.statusEffectDefinitions[effect.name];
            if (def?.rollModifier) rollModifier += def.rollModifier;
        });

        const roll = this.rollDice('1d20');
        let message = '';
        
        if (roll === 1) {
            message = `${attacker.name} attacks ${target.name}... It's a critical miss!`;
            io.to(roomId).emit('chatMessage', { senderName: 'Combat', message, channel: 'game' });
            return;
        }
        
        const requiredRoll = target.stats?.shieldBonus ? (10 + target.stats.shieldBonus) : target.requiredRollToHit;
        const totalRoll = roll + attackBonus + rollModifier;

        if (totalRoll >= requiredRoll || roll === 20) {
            const effect = weaponOrSpell.effect;
            let damageDice = effect?.dice || '1d4';
            let damage = this.rollDice(damageDice);

            if (roll === 20) { 
                damage += this.rollDice(damageDice); 
                message = `${attacker.name} lands a CRITICAL HIT on ${target.name} for <span class="damage-value">${damage}</span> damage!`;
            } else {
                message = `${attacker.name}'s attack hits ${target.name} for <span class="damage-value">${damage}</span> damage.`;
            }

            // FIX: Add server-side log for damage dealt
            console.log(`[Combat] ${attacker.name} deals ${damage} damage to ${target.name}.`);
            this.applyDamage(roomId, targetId, damage);

            if (effect?.status) {
                this.applyStatusEffect(roomId, targetId, effect.status, effect.duration);
                message += ` ${target.name} is now <span class="status-effect-log">${effect.status}</span>!`;
            }

        } else {
            message = `${attacker.name}'s attack misses ${target.name}.`;
        }
        io.to(roomId).emit('chatMessage', { senderName: 'Combat', message, channel: 'game' });
    }

    applyDamage(roomId, targetId, damageAmount) {
        const room = this.rooms[roomId];
        const target = this.getCombatant(room, targetId);
        if(!target) return;
        
        if (target.role) { // It's a player
            if (target.isNpc) { // NPC Explorer reaction
                const dialogue = this.getRandomDialogue('explorer', 'onHit');
                if (dialogue) io.to(roomId).emit('chatMessage', { senderName: target.name, message: `"${dialogue}"`, channel: 'game', isNarrative: true });
            }
            const wasDown = target.stats.currentHp <= 0;
            target.stats.currentHp -= damageAmount;

            if (target.stats.currentHp <= 0) {
                if (wasDown) {
                    target.lifeCount--;
                    io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${target.name} suffers a grievous wound while downed and loses a life! ${target.lifeCount} lives remaining.`, channel: 'game' });
                } else {
                     io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${target.name} has been downed!`, channel: 'game' });
                }
                if (target.lifeCount <= 0) {
                     io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${target.name} has fallen in battle!`, channel: 'game' });
                }
            }
        } else { // It's a monster
            target.currentHp -= damageAmount;
            if (target.currentHp <= 0) {
                const dm = Object.values(room.players).find(p => p.role === 'DM');
                const dialogue = this.getRandomDialogue('dm', 'monsterDefeated');
                if (dm && dialogue) {
                    io.to(roomId).emit('chatMessage', { senderName: dm.name, message: `"${dialogue}"`, channel: 'game', isNarrative: true });
                }
                room.gameState.board.monsters = room.gameState.board.monsters.filter(m => m.id !== targetId);
                room.gameState.combatState.turnOrder = room.gameState.combatState.turnOrder.filter(id => id !== targetId);
                delete room.gameState.combatState.participants[targetId];
                io.to(roomId).emit('chatMessage', { senderName: 'Combat', message: `${target.name} has been defeated!`, channel: 'game' });
            }
        }
    }
    
    applyHealing(roomId, targetId, healAmount) {
        const room = this.rooms[roomId];
        const target = this.getCombatant(room, targetId);
        if (!target || !target.role) return 0;

        const oldHp = target.stats.currentHp;
        target.stats.currentHp = Math.min(target.stats.maxHp, target.stats.currentHp + healAmount);
        return target.stats.currentHp - oldHp;
    }

    handlePlayerAction(roomId, playerId, { action, targetId, cardId, options, narrative }) {
        const room = this.rooms[roomId];
        const player = room.players[playerId];
        const combatState = room.gameState.combatState;

        const isPlayerTurn = !combatState.isActive ? room.gameState.turnOrder[room.gameState.currentPlayerIndex] === playerId : combatState.turnOrder[combatState.currentTurnIndex] === playerId;

        if (!isPlayerTurn) return { error: "It's not your turn!" };
        if (player.statusEffects.some(e => e.name === 'Stunned')) return { error: "You are stunned and cannot act!" };

        let card = cardId ? player.hand.find(c => c.id === cardId) : null;
        const apCost = card?.apCost || (action === 'attack' ? 1 : (gameData.actionCosts[action] || 0));

        if (player.currentAp < apCost) return { error: "Not enough Action Points!" };
        player.currentAp -= apCost;
        
        if (narrative) {
            io.to(roomId).emit('chatMessage', { senderName: player.name, message: `"${narrative}"`, channel: 'game', isNarrative: true });
        }

        switch(action) {
            case 'attack':
                const weapon = player.equipment.weapon;
                if (!weapon) { player.currentAp += apCost; return { error: "You have no weapon equipped!" }; }
                this.resolveAttack(roomId, playerId, targetId, weapon);
                break;
            case 'castSpell':
            case 'useItem':
                 if (!card) { player.currentAp += apCost; return { error: "Card not found in hand." }; }
                 this.resolveCardEffect(roomId, playerId, card, targetId);
                 if (card.type === 'Consumable' || card.type === 'Potion' || card.type === 'Scroll' || card.type === 'Spell') {
                     player.hand = player.hand.filter(c => c.id !== cardId);
                 }
                break;
            case 'briefRespite':
                if (combatState.isActive) { player.currentAp += apCost; return { error: "Cannot rest during combat." }; }
                this.briefRespite(roomId, playerId);
                break;
            case 'fullRest':
                if (combatState.isActive) { player.currentAp += apCost; return { error: "Cannot rest during combat." }; }
                this.fullRest(roomId, playerId);
                break;
            case 'skillChallenge':
                this.resolveSkillChallenge(roomId, playerId, options.dc, options.bonus);
                break;
            default:
                player.currentAp += apCost; // Refund AP for invalid action
                return { error: "Invalid action." };
        }
        
        io.to(roomId).emit('gameStateUpdate', room);
        return { room };
    }

    resolveCardEffect(roomId, playerId, card, targetId) {
        if (!card.effect) return;
        const { type, dice, status, duration, target } = card.effect;
        const room = this.rooms[roomId];
        const player = room.players[playerId];
        
        let actualTargetId = targetId;
        if (target === 'self') actualTargetId = playerId;

        switch(type) {
            case 'damage':
                this.resolveAttack(roomId, playerId, actualTargetId, card);
                break;
            case 'heal':
                if (player.isNpc) {
                    const dialogue = this.getRandomDialogue('explorer', 'heal');
                    if(dialogue) io.to(roomId).emit('chatMessage', { senderName: player.name, message: `"${dialogue}"`, channel: 'game', isNarrative: true });
                }
                const healing = this.rollDice(dice);
                const actualHeal = this.applyHealing(roomId, actualTargetId, healing);
                io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${card.name} heals ${this.getCombatant(room, actualTargetId).name} for <span class="heal-value">${actualHeal}</span> HP.`, channel: 'game' });
                break;
            case 'status':
                this.applyStatusEffect(roomId, actualTargetId, status, duration);
                io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${card.name} inflicts <span class="status-effect-log">${status}</span> on ${this.getCombatant(room, actualTargetId).name}!`, channel: 'game' });
                break;
        }
    }

    // --- NEW MECHANICS ---
    briefRespite(roomId, playerId) {
        const player = this.rooms[roomId].players[playerId];
        if (player.healthDice.current > 0) {
            player.healthDice.current--;
            const recovery = this.rollDice('1d6');
            const actualRecovery = this.applyHealing(roomId, playerId, recovery);
            io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${player.name} takes a brief respite, recovering <span class="heal-value">${actualRecovery}</span> HP.`, channel: 'game' });
        } else {
            io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${player.name} has no Health Dice remaining.`, channel: 'game' });
        }
    }

    fullRest(roomId, playerId) {
        const player = this.rooms[roomId].players[playerId];
        player.stats.currentHp = player.stats.maxHp;
        player.healthDice.current = player.healthDice.max;
        player.statusEffects = player.statusEffects.filter(e => e.duration === 'permanent'); 
        io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${player.name} takes a full rest and is fully recovered.`, channel: 'game' });
    }

    resolveSkillChallenge(roomId, playerId, dc, bonus = 0) {
        const player = this.rooms[roomId].players[playerId];
        const roll = this.rollDice('1d20');
        let message = `${player.name} attempts a skill challenge (DC ${dc})... `;
        if (roll === 1) {
            message += `It's a Critical Failure!`;
            io.to(roomId).emit('chatMessage', { senderName: 'System', message, channel: 'game' });
            return { success: false, critical: true, roll: 1 };
        }
        if (roll === 20) {
            message += `It's a Critical Success!`;
            io.to(roomId).emit('chatMessage', { senderName: 'System', message, channel: 'game' });
            return { success: true, critical: true, roll: 20 };
        }
        const total = roll + bonus;
        if (total >= dc) {
            message += `Success! (Rolled ${total})`;
            io.to(roomId).emit('chatMessage', { senderName: 'System', message, channel: 'game' });
            return { success: true, critical: false, roll: total };
        } else {
            message += `Failure. (Rolled ${total})`;
            io.to(roomId).emit('chatMessage', { senderName: 'System', message, channel: 'game' });
            return { success: false, critical: false, roll: total };
        }
    }
    
    applyStatusEffect(roomId, targetId, statusName, duration) {
        const target = this.getCombatant(this.rooms[roomId], targetId);
        if (!target || target.statusEffects.some(e => e.name === statusName)) return;
        target.statusEffects.push({ name: statusName, duration });
    }
    
    processTurnEffects(roomId, combatantId, phase) {
        const room = this.rooms[roomId];
        const combatant = this.getCombatant(room, combatantId);
        if (!combatant) return;

        (combatant.statusEffects || []).forEach(effect => {
            const def = gameData.statusEffectDefinitions[effect.name];
            if (def && def.trigger === phase) {
                if (def.damage) {
                    const damage = this.rollDice(def.damage);
                    this.applyDamage(roomId, combatantId, damage);
                    io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${combatant.name} takes <span class="damage-value">${damage}</span> damage from ${effect.name}.`, channel: 'game' });
                }
            }
        });

        if (phase === 'end') {
            combatant.statusEffects = (combatant.statusEffects || []).map(effect => {
                if (typeof effect.duration === 'number') {
                    effect.duration--;
                }
                return effect;
            }).filter(effect => effect.duration > 0 || typeof effect.duration !== 'number');
        }
    }

    // --- NPC AND GAME FLOW ---
    endTurn(roomId, playerId) {
        const room = this.rooms[roomId];
        if (!room) return;

        if (room.gameState.combatState.isActive) {
            if (room.gameState.combatState.turnOrder[room.gameState.combatState.currentTurnIndex] !== playerId) return;
            this.nextTurn(roomId);
        } else {
            if (!room.gameState.turnOrder || room.gameState.turnOrder.length === 0 || room.gameState.turnOrder[room.gameState.currentPlayerIndex] !== playerId) return;

            // FIX: Add logging for turn progression
            console.log(`[Game Flow] ${room.players[playerId].name}'s turn ended in room ${roomId}.`);
            
            const nextIndex = room.gameState.currentPlayerIndex + 1;

            if (nextIndex >= room.gameState.turnOrder.length) {
                // Round is over, DM's turn
                console.log(`[Game Flow] All players have acted. Passing to DM in room ${roomId}.`);
                room.gameState.currentPlayerIndex = -1; // Indicate DM's turn
                io.to(roomId).emit('gameStateUpdate', room);

                const dm = Object.values(room.players).find(p => p.role === 'DM');
                if (dm && dm.isNpc) {
                    setTimeout(() => this.executeNpcTurn(room.id, dm.id), 1500);
                }
            } else {
                // Next player's turn
                room.gameState.currentPlayerIndex = nextIndex;
                const nextPlayerId = room.gameState.turnOrder[nextIndex];
                const nextPlayer = room.players[nextPlayerId];
                console.log(`[Game Flow] Turn passed to ${nextPlayer.name} in room ${roomId}.`);
                io.to(roomId).emit('chatMessage', { senderName: 'System', message: `It is now ${nextPlayer.name}'s turn.`, channel: 'game' });
                io.to(roomId).emit('gameStateUpdate', room);
                
                // FIX: If the next player is an NPC, automatically execute their turn.
                if (nextPlayer.isNpc) {
                    setTimeout(() => this.executeNpcTurn(room.id, nextPlayer.id), 1500);
                }
            }
        }
        return room;
    }

    executeNpcTurn(roomId, npcId) {
        const room = this.rooms[roomId];
        if (!room) return;
        const npc = this.getCombatant(room, npcId);
        if (!npc || !(npc.isNpc || npc.role !== 'Explorer')) return;

        const combatState = room.gameState.combatState;

        console.log(`[Game Flow] Executing NPC turn for ${npc.name} (${npc.role || 'Monster'}) in room ${roomId}. Combat: ${combatState.isActive}`);
        
        if (combatState.isActive) {
            // --- MONSTER AI (Dedicated Block) ---
            if (!npc.role) {
                console.log(`[NPC AI | Monster] Turn begins for: ${npc.name}.`);
                const livingExplorers = Object.values(room.players).filter(p => p.role === 'Explorer' && p.stats.currentHp > 0 && p.lifeCount > 0);

                if (livingExplorers.length > 0) {
                    const target = livingExplorers[Math.floor(Math.random() * livingExplorers.length)];
                    console.log(`[NPC AI | Monster] ${npc.name} is targeting: ${target.name}.`);
                    
                    this.resolveAttack(roomId, npcId, target.id, npc);
                    
                    console.log(`[NPC AI | Monster] Attack action completed.`);
                } else {
                    console.log(`[NPC AI | Monster] ${npc.name} has no valid targets to attack. Skipping action.`);
                }

                // FIX: Strictly end the monster's turn within its own logic block.
                console.log(`[Game Flow] Monster turn for ${npc.name} is complete. Scheduling next turn.`);
                setTimeout(() => {
                    console.log(`[Game Flow] Calling nextTurn() for room ${roomId} after monster turn.`);
                    this.nextTurn(roomId);
                }, 1500);
            } 
            // --- NPC EXPLORER AI (Dedicated Block) ---
            else if (npc.role === 'Explorer') {
                // FIX: If there are no monsters on the board, the NPC should immediately end its turn.
                if (room.gameState.board.monsters.length === 0) {
                    console.log(`[NPC AI] Explorer ${npc.name} sees no monsters. Ending turn.`);
                    io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${npc.name} sees no more threats and stands ready.`, channel: 'game' });
                    setTimeout(() => this.nextTurn(roomId), 1500);
                    return;
                }
                
                const isInjured = npc.stats.currentHp / npc.stats.maxHp < 0.5;
                const healingCard = npc.hand.find(c => c.effect?.type === 'heal');

                if (isInjured && healingCard) {
                    const dialogue = this.getRandomDialogue('explorer', 'heal');
                    if (dialogue) io.to(roomId).emit('chatMessage', { senderName: npc.name, message: `"${dialogue}"`, channel: 'game', isNarrative: true });
                    this.resolveCardEffect(roomId, npcId, healingCard, npcId);
                    npc.hand = npc.hand.filter(c => c.id !== healingCard.id);
                    io.to(roomId).emit('gameStateUpdate', room);
                } else {
                    const livingMonsters = [...room.gameState.board.monsters];
                    if (livingMonsters.length > 0) {
                        livingMonsters.sort((a, b) => a.currentHp - b.currentHp);
                        const target = livingMonsters[0];
                        const dialogue = this.getRandomDialogue('explorer', 'attack');
                        if (dialogue) io.to(roomId).emit('chatMessage', { senderName: npc.name, message: `"${dialogue}"`, channel: 'game', isNarrative: true });
                        this.resolveAttack(roomId, npcId, target.id, npc.equipment.weapon || { effect: { dice: '1d4' } });
                    }
                }
                
                // End the explorer's turn within its own logic block for robustness.
                console.log(`[Game Flow] NPC Explorer turn for ${npc.name} is complete. Scheduling next turn.`);
                setTimeout(() => {
                    console.log(`[Game Flow] Calling nextTurn() for room ${roomId} after explorer turn.`);
                    this.nextTurn(roomId);
                }, 1500);
            }
            return; // Return after handling combat turn
        }

        // --- NON-COMBAT LOGIC ---

        if (npc.role === 'Explorer') {
            // NPC Explorers had no logic for non-combat turns, causing the game to stall.
            // Now, they will simply wait a moment and end their turn.
            io.to(roomId).emit('chatMessage', { senderName: 'System', message: `${npc.name} pauses for a moment...`, channel: 'game' });
            setTimeout(() => {
                this.endTurn(roomId, npcId);
            }, 2000);
            return;
        }

        if (npc.role === 'DM') {
            // Overhaul DM AI to be more proactive and ensure game progression.
            console.log(`[NPC AI] Executing DM turn. Phase: ${room.gameState.phase}, Monsters on Board: ${room.gameState.board.monsters.length}`);
            console.log(`[NPC AI] DM Hand:`, npc.hand.map(c => c.name).join(', '));

            const monsterInHand = npc.hand.find(c => c.type === 'Monster');
            const worldEventInHand = npc.hand.find(c => c.type === 'World Event');

            const isFirstTurn = room.gameState.phase === 'world_event_setup';
            const needsToPlayMonster = isFirstTurn || room.gameState.board.monsters.length === 0;

            if (needsToPlayMonster) {
                console.log('[NPC AI] DM needs to play a monster to start/continue combat.');
                if (monsterInHand) {
                    console.log(`[NPC AI] DM is playing monster from hand: ${monsterInHand.name}`);
                    this.playCard(roomId, npcId, monsterInHand.id, null);
                } else {
                    console.log('[NPC AI] DM has no monster in hand. Drawing from deck...');
                    const drawnMonster = room.gameState.decks.monster.pop();
                    if (drawnMonster) {
                        console.log(`[NPC AI] DM drew and is playing: ${drawnMonster.name}`);
                        this.playCard(roomId, npcId, drawnMonster.id, null);
                    } else {
                        console.log('[NPC AI] DM ERROR: Monster deck is empty! Cannot start combat.');
                        const dialogue = this.getRandomDialogue('dm', 'environment');
                        io.to(roomId).emit('chatMessage', { senderName: npc.name, message: `"${dialogue}"`, channel: 'game', isNarrative: true });
                    }
                }
                if (isFirstTurn) {
                    room.gameState.phase = 'active';
                }
            } else {
                console.log('[NPC AI] DM is in active phase. Deciding action...');
                const possibleActions = [];
                if (monsterInHand) possibleActions.push('play_monster');
                if (worldEventInHand) possibleActions.push('play_world_event');

                if (possibleActions.length > 0) {
                    const chosenAction = possibleActions[Math.floor(Math.random() * possibleActions.length)];
                    
                    if (chosenAction === 'play_monster') {
                        console.log(`[NPC AI] DM chose to play another monster: ${monsterInHand.name}`);
                        this.playCard(roomId, npcId, monsterInHand.id, null);
                    } else if (chosenAction === 'play_world_event') {
                        console.log(`[NPC AI] DM chose to play a world event: ${worldEventInHand.name}`);
                        this.playCard(roomId, npcId, worldEventInHand.id, null);
                    }
                } else {
                    console.log('[NPC AI] DM has no monster or world event cards to play. Delivering narrative.');
                    const dialogue = this.getRandomDialogue('dm', 'environment');
                    io.to(roomId).emit('chatMessage', { senderName: npc.name, message: `"${dialogue}"`, channel: 'game', isNarrative: true });
                }
            }

            if (!room.gameState.combatState.isActive) {
                console.log('[NPC AI] DM turn complete, passing to first player.');
                room.gameState.currentPlayerIndex = 0;
                const firstPlayerId = room.gameState.turnOrder[0];
                const firstPlayer = room.players[firstPlayerId];
                if (firstPlayer) {
                    const message = `It is now ${firstPlayer.name}'s turn.`;
                    console.log(`[Game Flow] DM turn ended in room ${roomId}. Passing to ${firstPlayer.name}.`);
                    io.to(roomId).emit('chatMessage', { senderName: 'System', message: message, channel: 'game' });
                    
                    if (firstPlayer.isNpc) {
                        setTimeout(() => this.executeNpcTurn(roomId, firstPlayer.id), 1500);
                    }
                }
                 io.to(roomId).emit('gameStateUpdate', room);
            }
            return;
        }
    }
    
    playCard(roomId, playerId, cardId, targetId) {
        const room = this.rooms[roomId];
        const player = room.players[playerId];
        if (!room || !player) return { error: "Invalid action." };
        
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        const allCards = [...gameData.itemCards, ...gameData.spellCards, ...gameData.monsterCards, ...gameData.worldEventCards];
        const card = cardIndex > -1 ? player.hand[cardIndex] : (player.isNpc ? {id: cardId, ...allCards.find(c => c.id === cardId)} : null);
        if (!card) return { error: "Card not found." };
        
        let dialogue = '';
        if (player.isNpc && player.role === 'DM') {
            if (card.type === 'Monster') dialogue = this.getRandomDialogue('dm', 'playMonster');
            else if (card.type === 'World Event') dialogue = this.getRandomDialogue('dm', 'worldEvent');
            if(dialogue) io.to(roomId).emit('chatMessage', { senderName: player.name, message: `"${dialogue}"`, channel: 'game', isNarrative: true });
        }
        
        if (card.type === 'Monster') {
            if (cardIndex > -1) player.hand.splice(cardIndex, 1);
            // FIX: Monsters must be flagged as isNpc so the game loop can trigger their turn automatically.
            const monsterData = { ...card, currentHp: card.maxHp, id: `${card.id}-${Math.random()}`, statusEffects: [], isNpc: true };
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
        } else { 
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
            
            let effectMessage = `${player.name} equipped ${card.name}.`;
            if (card.effect?.bonuses) {
                const bonusStrings = Object.entries(card.effect.bonuses)
                    .map(([key, value]) => {
                        if (value === 0) return null;
                        const statName = key === 'ap' ? 'AP' : (key === 'shield' ? 'Shield Bonus' : 'Damage Bonus');
                        return `<span class="stat-bonus">${value > 0 ? '+' : ''}${value} ${statName}</span>`;
                    })
                    .filter(Boolean);
                if (bonusStrings.length > 0) {
                    effectMessage += ` (${bonusStrings.join(', ')})`;
                }
            }
            
            io.to(updatedRoom.id).emit('chatMessage', { senderName: 'System', message: effectMessage, channel: 'game' });
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
            const { error } = gameManager.playCard(result.room.id, socket.id, cardId, targetId) || {};
            if (error) socket.emit('actionError', error);
        }
    });

    socket.on('playerAction', (actionData) => {
        const result = gameManager.getPlayer(socket.id);
        if (result) {
            const { error } = gameManager.handlePlayerAction(result.room.id, socket.id, actionData) || {};
            if(error) socket.emit('actionError', error);
        }
    });
    
    socket.on('endTurn', () => {
        const result = gameManager.getPlayer(socket.id);
        if (result) {
            const room = gameManager.endTurn(result.room.id, socket.id);
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