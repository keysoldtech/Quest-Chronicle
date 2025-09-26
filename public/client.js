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
let isMyTurnPreviously = false; // For "Your Turn" popup
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
const turnCounter = document.getElementById('turn-counter');
const playerHandDiv = document.getElementById('player-hand');
const gameBoardDiv = document.getElementById('board-cards');
const joinVoiceBtn = document.getElementById('join-voice-btn');
const voiceChatContainer = document.getElementById('voice-chat-container');
const gameModeSelector = document.getElementById('game-mode-selector');
const dmControls = document.getElementById('dm-controls');
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
const yourTurnPopup = document.getElementById('your-turn-popup');
const attackRollPopup = document.getElementById('attack-roll-popup');

// Event System DOM refs
const eventOverlay = document.getElementById('event-overlay');
const eventRollContainer = document.getElementById('event-roll-container');
const rollDiceBtn = document.getElementById('roll-dice-btn');
const eventDiceAnimationContainer = document.getElementById('event-dice-animation-container');
const dice = document.getElementById('dice');
const eventResultContainer = document.getElementById('event-result-container');
const eventResultTitle = document.getElementById('event-result-title');
const eventResultSubtitle = document.getElementById('event-result-subtitle');
const eventCardSelection = document.getElementById('event-card-selection');
const eventResultOkayBtn = document.getElementById('event-result-okay-btn');


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
    const currentPlayerId = gameState.combatState.isActive ? gameState.combatState.turnOrder[gameState.combatState.currentTurnIndex] : (gameState.turnOrder[gameState.currentPlayerIndex] || null);
    playerList.innerHTML = ''; 
    Object.values(players).forEach(player => {
        // Don't show the DM NPC in the player list
        if (player.id === 'dm-npc') return;

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
    const { players, gameState, hostId } = room;
    myPlayerInfo = players[myId];
    if (!myPlayerInfo) return;

    renderPlayerList(players, gameState);
    
    // --- Phase-specific UI rendering ---
    const isCombat = gameState.combatState.isActive;
    const isHost = myId === hostId;
    
    // Determine whose turn it is
    let currentTurnTakerId;
    if (isCombat && gameState.combatState.currentTurnIndex > -1) {
        currentTurnTakerId = gameState.combatState.turnOrder[gameState.combatState.currentTurnIndex];
    } else if (!isCombat && gameState.currentPlayerIndex > -1) {
        currentTurnTakerId = gameState.turnOrder[gameState.currentPlayerIndex];
    }
    
    const isMyTurn = currentTurnTakerId === myId;
    const isDmNpcTurn = currentTurnTakerId === 'dm-npc';
    const canPlayTargetedCard = gameState.board.monsters.length > 0;
    
    classSelectionDiv.classList.toggle('hidden', gameState.phase !== 'lobby' || !!myPlayerInfo.class);
    advancedCardChoiceDiv.classList.toggle('hidden', gameState.phase !== 'advanced_setup_choice' || myPlayerInfo.madeAdvancedChoice);
    playerStatsContainer.classList.toggle('hidden', gameState.phase === 'lobby');
    endTurnBtn.classList.toggle('hidden', !(isMyTurn || (isHost && isDmNpcTurn)));
    dmControls.classList.toggle('hidden', !isHost || gameState.phase === 'lobby');
    playerActionsContainer.classList.toggle('hidden', !isMyTurn);
    
    // Game mode selector should only be visible to the host in the lobby
    gameModeSelector.classList.toggle('hidden', !isHost || gameState.phase !== 'lobby');


    // "Your Turn" popup
    if (isMyTurn && !isMyTurnPreviously) {
        yourTurnPopup.classList.remove('hidden');
        setTimeout(() => yourTurnPopup.classList.add('hidden'), 1500);
    }
    isMyTurnPreviously = isMyTurn;
    
    // Event Roll UI
    if (isMyTurn && myPlayerInfo.pendingEventRoll) {
        eventOverlay.classList.remove('hidden');
        eventRollContainer.classList.remove('hidden');
        eventDiceAnimationContainer.classList.add('hidden');
        eventResultContainer.classList.add('hidden');
    } else if (!myPlayerInfo.pendingEventChoice) {
        eventOverlay.classList.add('hidden');
    }

    // --- Lobby Phase ---
    if (gameState.phase === 'lobby') {
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
    if (gameState.phase === 'advanced_setup_choice' && !myPlayerInfo.madeAdvancedChoice) {
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
    turnCounter.textContent = gameState.turnCount;
    if (gameState.phase !== 'lobby' && gameState.phase !== 'advanced_setup_choice') {
        const turnTaker = players[currentTurnTakerId] || gameState.board.monsters.find(m => m.id === currentTurnTakerId);
        
        if (turnTaker) {
            turnIndicator.textContent = `Current Turn: ${turnTaker.name}`;
            if(isMyTurn) turnIndicator.textContent += ' (Your Turn)';
            if(isDmNpcTurn) turnIndicator.textContent = "Dungeon Master's Turn";
        } else {
            turnIndicator.textContent = 'Waiting for next turn...';
        }
    }
    
    // --- Render Player Stats ---
    if (myPlayerInfo.stats) {
        playerStatsDiv.innerHTML = `
            <span>HP:</span><span class="stat-value">${myPlayerInfo.stats.currentHp} / ${myPlayerInfo.stats.maxHp}</span>
            <span>AP:</span><span class="stat-value">${myPlayerInfo.currentAp} / ${myPlayerInfo.stats.ap}</span>
            <span>DMG Bonus:</span><span class="stat-value">${myPlayerInfo.stats.damageBonus}</span>
            <span>SHIELD Bonus:</span><span class="stat-value">${myPlayerInfo.stats.shieldBonus}</span>
            <span>Health Dice:</span><span class="stat-value">${myPlayerInfo.healthDice.current}d / ${myPlayerInfo.healthDice.max}</span>
            <span>Lives:</span><span class="stat-value">${myPlayerInfo.lifeCount}</span>
        `;
    }

    // --- Render Player Hand & Equipment ---
    playerHandDiv.innerHTML = '';
    equippedItemsDiv.innerHTML = '';
    
    // Render equipped items
    ['weapon', 'armor'].forEach(type => {
        const item = myPlayerInfo.equipment[type];
        if (item) {
            const actions = { isPlayable: isMyTurn && type === 'weapon' && canPlayTargetedCard };
            const cardEl = createCardElement(item, actions);
            if (actions.isPlayable) cardEl.classList.add('attackable-weapon');
            equippedItemsDiv.appendChild(cardEl);
        }
    });

    // Render hand
    myPlayerInfo.hand.forEach(card => {
        const isEquippable = card.type === 'Weapon' || card.type === 'Armor';
        const isPlayable = isMyTurn && !isEquippable;
        const cardEl = createCardElement(card, { isPlayable, isEquippable });
        playerHandDiv.appendChild(cardEl);
    });

    // --- Render Board ---
    gameBoardDiv.innerHTML = '';
    gameState.board.monsters.forEach(monster => {
        const cardEl = createCardElement({ ...monster, currentHp: monster.currentHp }, { isTargetable: isMyTurn });
        cardEl.addEventListener('click', () => {
            if (isMyTurn) {
                selectedTargetId = selectedTargetId === monster.id ? null : monster.id;
                renderGameState(currentRoomState); // Re-render to show selection
            }
        });
        gameBoardDiv.appendChild(cardEl);
    });

    // --- Render Player Actions ---
    if(isMyTurn && playerActionsContainer.children.length === 0){
        ['Brief Respite (1d)', 'Full Rest (2d)', 'Guard'].forEach(action => {
            const btn = document.createElement('button');
            btn.textContent = action;
            btn.className = 'fantasy-button-sm fantasy-button-secondary';
            playerActionsContainer.appendChild(btn);
        });
    } else if (!isMyTurn) {
        playerActionsContainer.innerHTML = '';
    }
}

function renderEventCardChoices(cardOptions) {
    eventResultTitle.textContent = "Choose a Card";
    eventResultSubtitle.textContent = "Your choice will determine the outcome.";
    eventCardSelection.classList.remove('hidden');
    eventCardSelection.innerHTML = ''; // Clear previous cards

    cardOptions.forEach(card => {
        const cardBack = document.createElement('div');
        cardBack.className = 'card';
        cardBack.dataset.cardId = card.id;
        cardBack.onclick = () => {
            socket.emit('selectEventCard', { cardId: card.id });
            eventCardSelection.innerHTML = ''; // Prevent further clicks
        };
        eventCardSelection.appendChild(cardBack);
    });
}


// --- LOBBY EVENT LISTENERS ---
createRoomBtn.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    if (playerName) {
        socket.emit('createRoom', playerName);
    } else {
        alert('Please enter a name!');
    }
});

joinRoomBtn.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    const roomId = roomIdInput.value.trim();
    if (playerName && roomId) {
        socket.emit('joinRoom', { roomId, playerName });
    } else {
        alert('Please enter your name and a room code!');
    }
});

// --- GAME EVENT LISTENERS ---
startGameBtn.addEventListener('click', () => {
    const selectedMode = document.querySelector('input[name="gameMode"]:checked').value;
    socket.emit('startGame', { gameMode: selectedMode });
});

endTurnBtn.addEventListener('click', () => {
    socket.emit('endTurn');
});

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    const channel = chatChannel.value;
    if (message) {
        socket.emit('sendMessage', { channel, message });
        chatInput.value = '';
    }
});

narrativeConfirmBtn.addEventListener('click', () => {
    if (pendingActionData) {
        const narrative = narrativeInput.value.trim();
        socket.emit('playerAction', { ...pendingActionData, narrative });
        closeNarrativeModal();
    }
});

narrativeCancelBtn.addEventListener('click', closeNarrativeModal);

rollDiceBtn.onclick = () => {
    socket.emit('rollForEvent');
    eventRollContainer.classList.add('hidden');
    eventDiceAnimationContainer.classList.remove('hidden');
    dice.classList.add('is-rolling'); // Start animation
};


// --- SOCKET.IO EVENT HANDLERS ---
socket.on('connect', () => {
    myId = socket.id;
});

socket.on('roomCreated', (room) => {
    lobbyScreen.classList.add('hidden');
    gameArea.classList.remove('hidden');
    roomCodeDisplay.textContent = room.id;
    
    // Host-specific UI setup
    startGameBtn.classList.remove('hidden');
    gameModeSelector.classList.remove('hidden');

    renderGameState(room);
});

socket.on('joinSuccess', (room) => {
    lobbyScreen.classList.add('hidden');
    gameArea.classList.remove('hidden');
    roomCodeDisplay.textContent = room.id;
    gameModeSelector.classList.add('hidden');
    renderGameState(room);
});

socket.on('playerListUpdate', (room) => {
    renderGameState(room);
});

socket.on('gameStarted', (room) => {
    startGameBtn.classList.add('hidden');
    gameModeSelector.classList.add('hidden');
    logMessage('The game has begun!', { type: 'system' });
    renderGameState(room);
});

socket.on('gameStateUpdate', (room) => {
    renderGameState(room);
});

socket.on('chatMessage', ({ senderName, message, channel, isNarrative }) => {
    logMessage(message, { type: 'chat', senderName, channel, isNarrative });
});

socket.on('playerLeft', ({ playerName }) => {
    logMessage(`${playerName} has left the game.`, { type: 'system' });
});

socket.on('actionError', (errorMessage) => {
    alert(errorMessage);
});

socket.on('attackAnimation', ({ damageDice, damageRoll }) => {
    attackRollPopup.textContent = `Rolling ${damageDice}...`;
    attackRollPopup.classList.remove('hidden');

    // After a delay, show the result
    setTimeout(() => {
        attackRollPopup.textContent = `${damageRoll}!`;
    }, 1200);

    // Hide popup after animation is done
    setTimeout(() => {
        attackRollPopup.classList.add('hidden');
    }, 2400); // Slightly less than animation duration to avoid flicker
});

socket.on('eventRollResult', ({ roll, outcome, cardOptions }) => {
    // Wait for dice animation to complete
    setTimeout(() => {
        dice.classList.remove('is-rolling'); // Reset for next time
        eventDiceAnimationContainer.classList.add('hidden');
        eventResultContainer.classList.remove('hidden');
        eventCardSelection.classList.add('hidden'); // Hide card backs initially
        eventResultOkayBtn.classList.remove('hidden'); // Show okay button

        eventResultTitle.textContent = `You rolled a ${roll}!`;

        if (outcome === 'discovery') {
            eventResultSubtitle.textContent = "You've made a Discovery! Press Okay to see your options.";
            eventResultOkayBtn.onclick = () => {
                eventResultOkayBtn.classList.add('hidden');
                renderEventCardChoices(cardOptions);
            };
        } else if (outcome === 'playerEvent') {
            eventResultSubtitle.textContent = "You've triggered a Player Event! Press Okay to see your options.";
            eventResultOkayBtn.onclick = () => {
                eventResultOkayBtn.classList.add('hidden');
                renderEventCardChoices(cardOptions);
            };
        } else { // 'none'
            eventResultSubtitle.textContent = "The moment passes without incident. Your journey continues.";
            eventResultOkayBtn.onclick = () => {
                eventOverlay.classList.add('hidden');
            };
        }
    }, 1500); // Corresponds to dice animation duration
});

socket.on('eventCardReveal', ({ chosenCard }) => {
    eventResultTitle.textContent = `You found: ${chosenCard.name}`;
    eventResultSubtitle.textContent = '';
    eventCardSelection.innerHTML = '';
    
    const cardEl = createCardElement(chosenCard);
    eventCardSelection.appendChild(cardEl);
    eventCardSelection.classList.remove('hidden');

    setTimeout(() => {
        eventOverlay.classList.add('hidden');
    }, 4000); // Give player time to read the card
});


// --- VOICE CHAT ---
joinVoiceBtn.addEventListener('click', async () => {
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            socket.emit('join-voice');
            joinVoiceBtn.textContent = 'Voice On';
            joinVoiceBtn.classList.remove('fantasy-button-success');
            joinVoiceBtn.classList.add('fantasy-button-danger');
        } catch (error) {
            console.error('Error accessing media devices.', error);
            alert('Could not access microphone. Please check your browser permissions.');
        }
    }
});

const createPeerConnection = (peerId) => {
    const pc = new RTCPeerConnection(iceServers);
    peerConnections[peerId] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('voice-ice-candidate', { candidate: event.candidate, toId: peerId });
        }
    };
    
    pc.ontrack = (event) => {
        let audio = document.getElementById(`audio-${peerId}`);
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = `audio-${peerId}`;
            audio.autoplay = true;
            voiceChatContainer.appendChild(audio);
        }
        audio.srcObject = event.streams[0];
    };
    
    return pc;
};

socket.on('voice-peers', (peers) => {
    peers.forEach(peerId => {
        const pc = createPeerConnection(peerId);
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
                socket.emit('voice-offer', { offer: pc.localDescription, toId: peerId });
            });
    });
});

socket.on('voice-peer-join', ({ peerId }) => {
    // This is initiated by the new peer, no offer needed here.
    logMessage('A player joined voice chat.', { type: 'system' });
});

socket.on('voice-offer', async ({ offer, fromId }) => {
    const pc = createPeerConnection(fromId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('voice-answer', { answer: pc.localDescription, toId: fromId });
});

socket.on('voice-answer', async ({ answer, fromId }) => {
    const pc = peerConnections[fromId];
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('voice-ice-candidate', async ({ candidate, fromId }) => {
    const pc = peerConnections[fromId];
    if (pc && candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on('voice-peer-disconnect', ({ peerId }) => {
    if (peerConnections[peerId]) {
        peerConnections[peerId].close();
        delete peerConnections[peerId];
    }
    const audioEl = document.getElementById(`audio-${peerId}`);
    if (audioEl) {
        audioEl.remove();
    }
    logMessage('A player left voice chat.', { type: 'system' });
});

// --- UI HELPERS ---
document.querySelector('.radio-group').addEventListener('change', (e) => {
    if (e.target.name === 'gameMode') {
        document.querySelectorAll('.radio-label').forEach(label => label.classList.remove('active'));
        e.target.closest('.radio-label').classList.add('active');
    }
});
// Set initial active state for radio buttons
document.querySelector('.radio-label').classList.add('active');