// This script handles the client-side logic for interacting with the server.

const socket = io();

// --- Client State ---
let myPlayerInfo = {};
let myId = '';
let currentRoomState = {};
let localStream;
const peerConnections = {};
let selectedTargetId = null; // For combat targeting
let pendingActionData = null; // For narrative modal
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// --- DOM Element References ---
const lobbyScreen = document.getElementById('lobby');
const gameArea = document.getElementById('game-area');
const playerNameInput = document.getElementById('playerName');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomIdInput = document.getElementById('roomIdInput');
const roomCodeDisplay = document.getElementById('room-code');
const playerList = document.getElementById('player-list');
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatChannel = document.getElementById('chat-channel');
const chatInput = document.getElementById('chat-input');
const startGameBtn = document.getElementById('startGameBtn');
const endTurnBtn = document.getElementById('endTurnBtn');
const turnIndicator = document.getElementById('turn-indicator');
const playerHandDiv = document.getElementById('player-hand');
const gameBoardDiv = document.getElementById('board-cards');
const joinVoiceBtn = document.getElementById('join-voice-btn');
const voiceChatContainer = document.getElementById('voice-chat-container');
const gameModeSelector = document.getElementById('game-mode-selector');
const dmControls = document.getElementById('dm-controls');
const worldEventBtn = document.getElementById('worldEventBtn');
const worldEventsContainer = document.getElementById('world-events-container');
const classSelectionDiv = document.getElementById('class-selection');
const classButtonsDiv = document.getElementById('class-buttons');
const playerStatsContainer = document.getElementById('player-stats-container');
const playerStatsDiv = document.getElementById('player-stats');
const equippedItemsDiv = document.getElementById('equipped-items');
const advancedCardChoiceDiv = document.getElementById('advanced-card-choice');
const advancedChoiceButtonsDiv = document.getElementById('advanced-choice-buttons');
const playerActionsContainer = document.getElementById('player-actions-container');
const narrativeModal = document.getElementById('narrative-modal');
const narrativePrompt = document.getElementById('narrative-prompt');
const narrativeInput = document.getElementById('narrative-input');
const narrativeCancelBtn = document.getElementById('narrative-cancel-btn');
const narrativeConfirmBtn = document.getElementById('narrative-confirm-btn');


// --- Helper Functions ---
function logMessage(message, options = {}) {
    const { type = 'system', channel, senderName, isNarrative = false } = options;
    const p = document.createElement('p');
    p.classList.add('chat-message');
    if (type === 'system') {
        p.classList.add('system');
        p.innerHTML = `<span>[System]</span> ${message}`;
    } else if (type === 'chat') {
        if (isNarrative) {
             p.classList.add('narrative');
             p.innerHTML = `<strong>${senderName}:</strong> ${message}`;
        } else {
            const isSelf = senderName === myPlayerInfo.name;
            const channelTag = channel === 'party' ? '[Party]' : '[Game]';
            const channelClass = channel === 'party' ? 'party' : 'game';
            const senderClass = isSelf ? 'self' : 'other';
            p.innerHTML = `<span class="channel ${channelClass}">${channelTag}</span> <span class="sender ${senderClass}">${senderName}:</span> <span class="message">${message}</span>`;
        }
    }
    chatLog.appendChild(p);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function openNarrativeModal(actionData, cardName) {
    pendingActionData = actionData;
    narrativePrompt.textContent = `How do you use ${cardName}?`;
    narrativeInput.value = '';
    narrativeModal.classList.remove('hidden');
    narrativeInput.focus();
}

function closeNarrativeModal() {
    pendingActionData = null;
    narrativeModal.classList.add('hidden');
}

function createCardElement(card, actions = {}) {
    const { isPlayable = false, isEquippable = false, isTargetable = false } = actions;
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.dataset.cardId = card.id;

    if (card.type === 'Monster') {
        cardDiv.dataset.monsterId = card.id;
        if(isTargetable) cardDiv.classList.add('targetable');
        if(selectedTargetId === card.id) cardDiv.classList.add('selected-target');
    }
    
    let typeInfo = card.type;
    if (card.category && card.category !== 'General') typeInfo += ` / ${card.category}`;
    else if (card.type === 'World Event' && card.tags) typeInfo = card.tags;
    
    let bonusesHTML = '';
    if (card.effect?.bonuses) {
        bonusesHTML = Object.entries(card.effect.bonuses).map(([key, value]) => 
            `<div class="card-bonus">${key.charAt(0).toUpperCase() + key.slice(1)}: ${value > 0 ? '+' : ''}${value}</div>`
        ).join('');
    }
    
    let monsterStatsHTML = '';
    if(card.type === 'Monster') {
        monsterStatsHTML = `<div class="card-bonus">HP: ${card.currentHp} / ${card.maxHp}</div>`;
    }

    let statusEffectsHTML = '';
    if (card.statusEffects && card.statusEffects.length > 0) {
        statusEffectsHTML = `<div class="status-effects-container">` +
            card.statusEffects.map(e => `<span class="status-effect">${e.name}</span>`).join(' ') +
            `</div>`;
    }

    cardDiv.innerHTML = `
        <div class="card-content">
            <h3 class="card-title">${card.name}</h3>
            <p class="card-effect">${card.effect?.description || card.outcome || ''}</p>
        </div>
        ${statusEffectsHTML}
        <div class="card-footer">
            ${bonusesHTML}
            ${monsterStatsHTML}
            <p class="card-type">${typeInfo}</p>
        </div>
    `;
    
    const actionContainer = document.createElement('div');
    actionContainer.className = 'card-actions';

    if (isPlayable) {
        const playBtn = document.createElement('button');
        const cardEffect = card.effect || {};
        playBtn.textContent = card.type === 'Spell' ? 'Cast' : 'Use';
        playBtn.className = 'fantasy-button-xs fantasy-button-primary';
        playBtn.onclick = () => {
            if ((cardEffect.type === 'damage' || cardEffect.target === 'any-monster') && !selectedTargetId) {
                alert("You must select a monster to target!");
                return;
            }
            const action = card.type === 'Spell' ? 'castSpell' : 'useItem';
            openNarrativeModal({ action, cardId: card.id, targetId: selectedTargetId }, card.name);
            selectedTargetId = null; // Reset target after opening modal
        };
        actionContainer.appendChild(playBtn);
    }
    if (isEquippable) {
        const equipBtn = document.createElement('button');
        equipBtn.textContent = 'Equip';
        equipBtn.className = 'fantasy-button-xs fantasy-button-success';
        equipBtn.onclick = () => socket.emit('equipItem', { cardId: card.id });
        actionContainer.appendChild(equipBtn);
    }
    cardDiv.appendChild(actionContainer);
    return cardDiv;
}

function renderPlayerList(players, gameState) {
    const currentPlayerId = gameState.combatState.isActive ? gameState.combatState.turnOrder[gameState.combatState.currentTurnIndex] : null;
    playerList.innerHTML = ''; 
    Object.values(players).forEach(player => {
        const isCurrentTurn = player.id === currentPlayerId;
        const li = document.createElement('li');
        li.id = `player-${player.id}`;
        li.className = `player-list-item ${isCurrentTurn ? 'active' : ''}`;
        
        const npcTag = player.isNpc ? '<span class="npc-tag">[NPC]</span> ' : '';
        const roleClass = player.role === 'DM' ? 'dm' : 'explorer';
        const classText = player.class ? `<span class="player-class"> - ${player.class}</span>` : '';
        
        const statusEffectsHTML = (player.statusEffects || [])
            .map(e => `<span class="status-effect-sm">${e.name}</span>`)
            .join(' ');

        li.innerHTML = `
            <div class="player-info">
                <span>${npcTag}${player.name}${classText}</span>
                <span class="player-role ${roleClass}">${player.role}</span>
            </div>
            <div class="player-hp">HP: ${player.stats.currentHp || '?'} / ${player.stats.maxHp || '?'}</div>
            <div class="player-status-effects">${statusEffectsHTML}</div>
        `;
        playerList.appendChild(li);
    });
}

function renderGameState(room) {
    currentRoomState = room;
    const { players, gameState } = room;
    myPlayerInfo = players[myId];
    if (!myPlayerInfo) return;

    renderPlayerList(players, gameState);
    
    // --- Phase-specific UI rendering ---
    const isCombat = gameState.combatState.isActive;
    const isMyTurn = isCombat ? gameState.combatState.turnOrder[gameState.combatState.currentTurnIndex] === myId : (gameState.currentPlayerIndex !== -1 ? gameState.turnOrder[gameState.currentPlayerIndex] === myId : false);
    const isDm = myPlayerInfo.role === 'DM';
    const canPlayTargetedCard = gameState.board.monsters.length > 0;
    
    classSelectionDiv.classList.toggle('hidden', gameState.phase !== 'lobby' || isDm);
    advancedCardChoiceDiv.classList.toggle('hidden', gameState.phase !== 'advanced_setup_choice' || isDm);
    playerStatsContainer.classList.toggle('hidden', gameState.phase === 'lobby');
    endTurnBtn.classList.toggle('hidden', !isMyTurn);
    dmControls.classList.toggle('hidden', !isDm || gameState.phase === 'lobby');
    playerActionsContainer.classList.toggle('hidden', !isMyTurn);
    
    // --- Lobby Phase ---
    if (gameState.phase === 'lobby' && !isDm) {
        if (classButtonsDiv.children.length === 0) {
            ['Warrior', 'Mage', 'Rogue', 'Cleric', 'Ranger', 'Barbarian'].forEach(className => {
                const btn = document.createElement('button');
                btn.textContent = className;
                btn.className = 'fantasy-button';
                btn.onclick = () => { socket.emit('chooseClass', { classId: className }); };
                classButtonsDiv.appendChild(btn);
            });
        }
        document.querySelectorAll('#class-buttons button').forEach(b => b.classList.toggle('active', b.textContent === myPlayerInfo.class));
    }
    
    // --- Advanced Setup Phase ---
    if (gameState.phase === 'advanced_setup_choice' && !isDm) {
        turnIndicator.textContent = "Choose your starting card type...";
        if (advancedChoiceButtonsDiv.children.length === 0) {
            ['Weapon', 'Armor', 'Spell'].forEach(cardType => {
                const btn = document.createElement('button');
                btn.textContent = cardType;
                btn.className = 'fantasy-button';
                btn.onclick = () => { socket.emit('advancedCardChoice', { cardType }); advancedCardChoiceDiv.classList.add('hidden'); };
                advancedChoiceButtonsDiv.appendChild(btn);
            });
        }
    }
    
    // --- Active Game & Turn Indicator ---
    if (gameState.phase !== 'lobby' && gameState.phase !== 'advanced_setup_choice') {
        let turnTakerId = null;
        // Determine the current turn taker based on game phase (combat vs. exploration)
        if (isCombat) {
            turnTakerId = gameState.combatState.turnOrder[gameState.combatState.currentTurnIndex];
        } else if (gameState.currentPlayerIndex > -1 && gameState.turnOrder[gameState.currentPlayerIndex]) {
            // Non-combat turn order is based on the main turnOrder array
            turnTakerId = gameState.turnOrder[gameState.currentPlayerIndex];
        }

        const turnTaker = players[turnTakerId] || gameState.board.monsters.find(m => m.id === turnTakerId);
        
        if (turnTaker) {
            turnIndicator.textContent = `Current Turn: ${turnTaker.name}`;
            if(isMyTurn) turnIndicator.textContent += " (Your Turn!)";
        } else {
            // If no turnTaker is identified, it's the DM's turn to act
            turnIndicator.textContent = "Waiting on DM...";
        }
    }

    const { stats, currentAp } = myPlayerInfo;
    playerStatsDiv.innerHTML = `
        <span>HP:</span> <span class="stat-value">${stats.currentHp} / ${stats.maxHp}</span>
        <span>Damage Bonus:</span> <span class="stat-value">${stats.damageBonus > 0 ? '+' : ''}${stats.damageBonus}</span>
        <span>Shield Bonus:</span> <span class="stat-value">${stats.shieldBonus > 0 ? '+' : ''}${stats.shieldBonus}</span>
        <span>Action Points:</span> <span class="stat-value">${currentAp} / ${stats.ap}</span>
        <span>Health Dice:</span> <span class="stat-value">${myPlayerInfo.healthDice?.current || 0} / ${myPlayerInfo.healthDice?.max || 0}</span>
    `;

    // --- Render Hand & Equipment ---
    playerHandDiv.innerHTML = '';
    equippedItemsDiv.innerHTML = '';
    
    if (myPlayerInfo.hand) {
        myPlayerInfo.hand.forEach(card => {
            const isEquippable = card.type === 'Weapon' || card.type === 'Armor';
            const isPlayable = isMyTurn && ((card.effect?.target !== 'any-monster' || canPlayTargetedCard));
            playerHandDiv.appendChild(createCardElement(card, { isPlayable, isEquippable }));
        });
    }
    if (myPlayerInfo.equipment) {
        Object.values(myPlayerInfo.equipment).forEach(item => {
            if(item) equippedItemsDiv.appendChild(createCardElement(item, {}));
        });
    }
    
    // --- Render Board & World Events ---
    gameBoardDiv.innerHTML = '';
    (gameState.board.monsters || []).forEach(monster => {
        const isTargetable = isMyTurn;
        const monsterCard = createCardElement(monster, { isTargetable });
        if(isTargetable) {
            monsterCard.onclick = () => {
                selectedTargetId = selectedTargetId === monster.id ? null : monster.id;
                renderGameState(currentRoomState); // Re-render to show selection change
            };
        }
        gameBoardDiv.appendChild(monsterCard);
    });
    
    worldEventsContainer.innerHTML = '';
    (gameState.worldEvents?.currentSequence || []).forEach(card => {
        worldEventsContainer.appendChild(createCardElement(card, {}));
    });

    // Render contextual actions
    playerActionsContainer.innerHTML = '';
    if (isMyTurn && !isCombat) {
        const respiteBtn = document.createElement('button');
        respiteBtn.textContent = 'Brief Respite';
        respiteBtn.className = 'fantasy-button-sm fantasy-button-secondary';
        respiteBtn.onclick = () => socket.emit('playerAction', { action: 'briefRespite' });
        playerActionsContainer.appendChild(respiteBtn);
        
        const restBtn = document.createElement('button');
        restBtn.textContent = 'Full Rest';
        restBtn.className = 'fantasy-button-sm fantasy-button-success';
        restBtn.onclick = () => socket.emit('playerAction', { action: 'fullRest' });
        playerActionsContainer.appendChild(restBtn);
    }
}

function showGameArea(room) {
    lobbyScreen.classList.add('hidden');
    gameArea.classList.remove('hidden');
    myPlayerInfo = room.players[myId];
    
    if (myPlayerInfo.role === 'DM') {
        chatChannel.querySelector('option[value="party"]').disabled = true;
        startGameBtn.classList.remove('hidden');
    } else {
        startGameBtn.classList.add('hidden');
    }
}

// --- Lobby Event Listeners ---
createRoomBtn.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    if (!playerName) return alert('Please enter a player name.');
    socket.emit('createRoom', playerName);
});

joinRoomBtn.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    const roomId = roomIdInput.value.trim();
    if (!playerName || !roomId) return alert('Please enter a player name and a room code.');
    gameModeSelector.classList.add('hidden');
    socket.emit('joinRoom', { roomId, playerName });
});

gameModeSelector.addEventListener('change', (e) => {
    document.querySelectorAll('#game-mode-selector span').forEach(span => span.parentElement.classList.remove('active'));
    document.querySelector('input[name="gameMode"]:checked').parentElement.classList.add('active');
});
document.querySelector('input[name="gameMode"]:checked').parentElement.classList.add('active');


// --- Game Event Listeners ---
chatForm.addEventListener('submit', (e) => { e.preventDefault(); const msg=chatInput.value.trim(); if (msg) { socket.emit('sendMessage', { channel: chatChannel.value, message: msg }); chatInput.value = ''; } });
startGameBtn.addEventListener('click', () => socket.emit('startGame', { gameMode: document.querySelector('input[name="gameMode"]:checked').value }));
endTurnBtn.addEventListener('click', () => socket.emit('endTurn'));
worldEventBtn.addEventListener('click', () => {
    const worldEventCard = myPlayerInfo.hand.find(c => c.type === 'World Event');
    if (worldEventCard) {
        socket.emit('playCard', { cardId: worldEventCard.id });
    } else {
        alert("You don't have a World Event card to play!");
    }
});
narrativeConfirmBtn.addEventListener('click', () => {
    if (pendingActionData) {
        pendingActionData.narrative = narrativeInput.value.trim();
        socket.emit('playerAction', pendingActionData);
        closeNarrativeModal();
    }
});
narrativeCancelBtn.addEventListener('click', closeNarrativeModal);



// --- Socket.IO Event Handlers ---
socket.on('roomCreated', (room) => {
    myId = socket.id;
    roomCodeDisplay.textContent = room.id;
    showGameArea(room);
    renderGameState(room);
    logMessage(`You created the room. The code is ${room.id}.`);
});

socket.on('joinSuccess', (room) => {
    myId = socket.id;
    roomCodeDisplay.textContent = room.id;
    gameModeSelector.style.display = 'none';
    showGameArea(room);
    renderGameState(room);
    logMessage(`You joined room ${room.id}. Welcome!`);
});

socket.on('playerListUpdate', (room) => {
    const oldPlayerCount = currentRoomState.players ? Object.keys(currentRoomState.players).length : 0;
    const newPlayerCount = room.players ? Object.keys(room.players).length : 0;
    if (newPlayerCount > oldPlayerCount) {
        const newPlayer = Object.values(room.players).find(p => !currentRoomState.players || !currentRoomState.players[p.id]);
        if(newPlayer) logMessage(`${newPlayer.name} has joined the room.`);
    }
    renderGameState(room);
});

socket.on('playerLeft', ({ room }) => {
    logMessage(`${room.playerName} has left the room.`);
    renderGameState({ players: room.remainingPlayers, gameState: currentRoomState.gameState });
});

socket.on('chatMessage', ({ senderName, message, channel, isNarrative }) => logMessage(message, { type: 'chat', channel, senderName, isNarrative }));

socket.on('gameStarted', (room) => {
    console.log("Game has started!", room);
    startGameBtn.classList.add('hidden');
    gameModeSelector.style.display = 'none';
    renderGameState(room);
});

socket.on('gameStateUpdate', (room) => {
    console.log("Game state updated!", room);
    renderGameState(room);
});

socket.on('actionError', (message) => { 
    alert(`Action Failed: ${message}`);
    logMessage(message, { type: 'system' });
});


// --- WebRTC Logic ---
async function handleVoiceConnection(peerId, isInitiator) {
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) { console.error('Error accessing microphone:', err); logMessage('Could not access microphone.'); return; }
    }
    const peerConnection = new RTCPeerConnection(iceServers);
    peerConnections[peerId] = peerConnection;
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    peerConnection.onicecandidate = e => { if (e.candidate) socket.emit('voice-ice-candidate', { candidate: e.candidate, toId: peerId }); };
    peerConnection.ontrack = e => {
        const audio = document.createElement('audio');
        audio.srcObject = e.streams[0];
        audio.autoplay = true;
        audio.id = `audio-${peerId}`;
        voiceChatContainer.appendChild(audio);
    };
    if (isInitiator) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('voice-offer', { offer, toId: peerId });
    }
}

joinVoiceBtn.addEventListener('click', () => { socket.emit('join-voice'); joinVoiceBtn.disabled=true; joinVoiceBtn.textContent='Voice Active'; logMessage('Joining voice chat...'); });
socket.on('voice-peers', peerIds => peerIds.forEach(id => handleVoiceConnection(id, true)));
socket.on('voice-peer-join', ({ peerId }) => { logMessage('A user joined voice. Connecting...'); handleVoiceConnection(peerId, false); });
socket.on('voice-offer', async ({ offer, fromId }) => {
    await handleVoiceConnection(fromId, false);
    await peerConnections[fromId].setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnections[fromId].createAnswer();
    await peerConnections[fromId].setLocalDescription(answer);
    socket.emit('voice-answer', { answer, toId: fromId });
});
socket.on('voice-answer', async ({ answer, fromId }) => { if (peerConnections[fromId]) await peerConnections[fromId].setRemoteDescription(new RTCSessionDescription(answer)); });
socket.on('voice-ice-candidate', async ({ candidate, fromId }) => { if (peerConnections[fromId]) await peerConnections[fromId].addIceCandidate(new RTCIceCandidate(candidate)); });
socket.on('voice-peer-disconnect', ({ peerId }) => {
    logMessage('A user left voice chat.');
    if (peerConnections[peerId]) { peerConnections[peerId].close(); delete peerConnections[peerId]; }
    const audioEl = document.getElementById(`audio-${peerId}`);
    if (audioEl) audioEl.remove();
});