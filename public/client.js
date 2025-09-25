// This script handles the client-side logic for interacting with the server.

const socket = io();

// --- Client State ---
let myPlayerInfo = {};
let myId = '';
let currentRoomState = {};
let localStream;
const peerConnections = {};
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
const drawMonsterBtn = document.getElementById('drawMonsterBtn');
const drawDiscoveryBtn = document.getElementById('drawDiscoveryBtn');
const worldEventBtn = document.getElementById('worldEventBtn');
const worldEventsContainer = document.getElementById('world-events-container');
const classSelectionDiv = document.getElementById('class-selection');
const classButtonsDiv = document.getElementById('class-buttons');
const playerStatsContainer = document.getElementById('player-stats-container');
const playerStatsDiv = document.getElementById('player-stats');
const equippedItemsDiv = document.getElementById('equipped-items');


// --- Helper Functions ---
function logMessage(message, options = {}) {
    const { type = 'system', channel, senderName } = options;
    const p = document.createElement('p');
    if (type === 'system') {
        p.className = 'text-yellow-400 italic';
        p.textContent = `[System] ${message}`;
    } else if (type === 'chat') {
        const isSelf = senderName === myPlayerInfo.name;
        const channelTag = channel === 'party' ? '[Party]' : '[Game]';
        const channelColor = channel === 'party' ? 'text-teal-300' : 'text-sky-300';
        const senderColor = isSelf ? 'text-white font-bold' : 'text-slate-300';
        p.innerHTML = `<span class="${channelColor} font-semibold">${channelTag}</span> <span class="${senderColor}">${senderName}:</span> <span class="text-slate-200">${message}</span>`;
    }
    chatLog.appendChild(p);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function createCardElement(card, actions = {}) {
    const { isPlayable = false, isEquippable = false } = actions;
    const cardDiv = document.createElement('div');
    let cardClasses = 'w-40 h-60 bg-slate-700 rounded-lg p-3 flex flex-col justify-between border-2 border-slate-600 transition-all duration-200 flex-shrink-0 relative';
    
    cardDiv.className = cardClasses;
    cardDiv.dataset.cardId = card.id;

    let typeInfo = card.type;
    if (card.category && card.category !== 'General') typeInfo += ` / ${card.category}`;
    else if (card.type === 'World Event' && card.tags) typeInfo = card.tags;

    let bonusesHTML = '';
    if (card.bonuses) {
        bonusesHTML = Object.entries(card.bonuses).map(([key, value]) => 
            `<div class="text-xs text-amber-300">${key.charAt(0).toUpperCase() + key.slice(1)}: ${value > 0 ? '+' : ''}${value}</div>`
        ).join('');
    }

    cardDiv.innerHTML = `
        <div>
            <h3 class="font-bold text-sm text-sky-200">${card.name}</h3>
            <p class="text-xs text-slate-300 mt-1">${card.effect || card.outcome || ''}</p>
        </div>
        <div>
            ${bonusesHTML}
            <p class="text-xs text-slate-500 italic mt-2">${typeInfo}</p>
        </div>
    `;
    
    const actionContainer = document.createElement('div');
    actionContainer.className = 'absolute bottom-2 right-2 flex flex-col gap-1';

    if (isPlayable) {
        const playBtn = document.createElement('button');
        playBtn.textContent = 'Play';
        playBtn.className = 'px-2 py-1 text-xs bg-sky-600 hover:bg-sky-500 rounded';
        playBtn.onclick = () => socket.emit('playCard', { cardId: card.id });
        actionContainer.appendChild(playBtn);
    }
    if (isEquippable) {
        const equipBtn = document.createElement('button');
        equipBtn.textContent = 'Equip';
        equipBtn.className = 'px-2 py-1 text-xs bg-green-600 hover:bg-green-500 rounded';
        equipBtn.onclick = () => socket.emit('equipItem', { cardId: card.id });
        actionContainer.appendChild(equipBtn);
    }
    cardDiv.appendChild(actionContainer);
    return cardDiv;
}

function renderPlayerList(players, gameState) {
    const currentPlayerId = gameState.turnOrder?.[gameState.currentPlayerIndex];
    playerList.innerHTML = ''; 
    Object.values(players).forEach(player => {
        const isCurrentTurn = player.id === currentPlayerId;
        const li = document.createElement('li');
        li.id = `player-${player.id}`;
        li.className = `p-2 rounded-md transition-colors ${isCurrentTurn ? 'bg-yellow-500/30 border border-yellow-400' : 'bg-slate-700'}`;
        
        const npcTag = player.isNpc ? '<span class="text-xs text-slate-400">[NPC]</span> ' : '';
        const roleColor = player.role === 'DM' ? 'text-yellow-300' : 'text-sky-300';
        const classText = player.class ? `<span class="text-xs text-slate-400"> - ${player.class}</span>` : '';

        li.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="${isCurrentTurn ? 'font-bold text-yellow-200' : ''}">${npcTag}${player.name}${classText}</span>
                <span class="text-xs font-semibold ${roleColor} bg-slate-800 px-2 py-1 rounded-full">${player.role}</span>
            </div>
            <div class="text-xs text-green-400 mt-1">HP: ${player.stats.currentHp || '?'} / ${player.stats.maxHp || '?'}</div>
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

    // --- Lobby Phase: Class Selection ---
    if (gameState.phase === 'lobby' && myPlayerInfo.role !== 'DM') {
        classSelectionDiv.classList.remove('hidden');
        if (classButtonsDiv.children.length === 0) { // Populate once
            ['Warrior', 'Mage', 'Rogue', 'Cleric', 'Ranger', 'Barbarian'].forEach(className => {
                const btn = document.createElement('button');
                btn.textContent = className;
                btn.dataset.class = className;
                btn.className = 'px-2 py-2 bg-slate-600 hover:bg-sky-500 rounded transition-colors text-sm';
                btn.onclick = () => {
                    socket.emit('chooseClass', { classId: className });
                    document.querySelectorAll('#class-buttons button').forEach(b => b.classList.remove('bg-sky-600'));
                    btn.classList.add('bg-sky-600');
                };
                classButtonsDiv.appendChild(btn);
            });
        }
    } else {
        classSelectionDiv.classList.add('hidden');
    }

    // --- Active Game Phase ---
    if (gameState.phase === 'active') {
        playerStatsContainer.classList.remove('hidden');
        const { stats } = myPlayerInfo;
        playerStatsDiv.innerHTML = `
            <span class="text-slate-400">HP:</span> <span class="text-green-400 font-semibold">${stats.currentHp} / ${stats.maxHp}</span>
            <span class="text-slate-400">Damage Bonus:</span> <span class="font-semibold">${stats.damageBonus > 0 ? '+' : ''}${stats.damageBonus}</span>
            <span class="text-slate-400">Shield Bonus:</span> <span class="font-semibold">${stats.shieldBonus > 0 ? '+' : ''}${stats.shieldBonus}</span>
            <span class="text-slate-400">Action Points:</span> <span class="font-semibold">${stats.ap}</span>
        `;
        
        const currentPlayer = players[gameState.turnOrder[gameState.currentPlayerIndex]];
        turnIndicator.textContent = `Current Turn: ${currentPlayer?.name || 'Unknown'}`;
        endTurnBtn.classList.toggle('hidden', currentPlayer?.id !== myId);
        if (currentPlayer?.id === myId) turnIndicator.textContent += " (Your Turn!)";
        
        if (myPlayerInfo.role === 'DM') {
            dmControls.classList.remove('hidden');
            worldEventBtn.textContent = (gameState.gameMode === 'Beginner') ? 'Start World Event Seq.' : 'Draw World Events';
            worldEventBtn.disabled = (gameState.gameMode === 'Beginner') && gameState.worldEvents.sequenceActive;
            worldEventBtn.dataset.action = (gameState.gameMode === 'Beginner') ? 'startWorldEventSequence' : 'drawWorldEvents';
        } else {
            dmControls.classList.add('hidden');
        }
    }

    // --- Render Hand & Equipment ---
    playerHandDiv.innerHTML = '';
    equippedItemsDiv.innerHTML = '';
    if (myPlayerInfo.hand) {
        myPlayerInfo.hand.forEach(card => {
            const isEquippable = card.type === 'Weapon' || card.type === 'Armor';
            playerHandDiv.appendChild(createCardElement(card, { isPlayable: !isEquippable, isEquippable }));
        });
    }
    if (myPlayerInfo.equipment) {
        Object.values(myPlayerInfo.equipment).forEach(item => {
            if(item) equippedItemsDiv.appendChild(createCardElement(item, {}));
        });
    }
    
    // --- Render Board & World Events ---
    gameBoardDiv.innerHTML = '';
    [...(gameState.board.monsters || []), ...(gameState.board.playedCards || [])].forEach(card => {
        gameBoardDiv.appendChild(createCardElement(card, {}));
    });
    
    worldEventsContainer.innerHTML = '';
    (gameState.worldEvents?.currentSequence || []).forEach(card => {
        worldEventsContainer.appendChild(createCardElement(card, {}));
    });
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
    document.querySelectorAll('#game-mode-selector span').forEach(span => span.classList.remove('bg-sky-600', 'text-white', 'bg-slate-600', 'text-slate-300'));
    document.querySelector('input[name="gameMode"]:checked').nextElementSibling.classList.add('bg-sky-600', 'text-white');
    document.querySelector('input[name="gameMode"]:not(:checked)').nextElementSibling.classList.add('bg-slate-600', 'text-slate-300');
});

// --- Game Event Listeners ---
chatForm.addEventListener('submit', (e) => { e.preventDefault(); const msg=chatInput.value.trim(); if (msg) { socket.emit('sendMessage', { channel: chatChannel.value, message: msg }); chatInput.value = ''; } });
startGameBtn.addEventListener('click', () => socket.emit('startGame', { gameMode: document.querySelector('input[name="gameMode"]:checked').value }));
endTurnBtn.addEventListener('click', () => socket.emit('endTurn'));
drawMonsterBtn.addEventListener('click', () => socket.emit('gmAction', { action: 'drawMonster' }));
worldEventBtn.addEventListener('click', (e) => { if (e.target.dataset.action) socket.emit('gmAction', { action: e.target.dataset.action }); });
drawDiscoveryBtn.addEventListener('click', () => {
    const humanExplorers = Object.values(currentRoomState.players).filter(p => p.role === 'Explorer' && !p.isNpc);
    if (humanExplorers.length > 0) socket.emit('gmAction', { action: 'drawDiscovery', targetPlayerId: humanExplorers[0].id });
    else logMessage('No human players to give a discovery card to.');
});

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
        const newPlayer = Object.values(room.players).find(p => !currentRoomState.players[p.id]);
        if(newPlayer) logMessage(`${newPlayer.name} has joined the room.`);
    }
    renderGameState(room);
});

socket.on('playerLeft', ({ room }) => {
    logMessage(`${room.playerName} has left the room.`);
    renderGameState({ players: room.remainingPlayers, gameState: currentRoomState.gameState });
});

socket.on('chatMessage', ({ senderName, message, channel }) => logMessage(message, { type: 'chat', channel, senderName }));

socket.on('gameStarted', (room) => {
    console.log("Game has started!", room);
    startGameBtn.classList.add('hidden');
    gameModeSelector.style.display = 'none';
    classSelectionDiv.classList.add('hidden');
    renderGameState(room);
});

socket.on('gameStateUpdate', (room) => {
    console.log("Game state updated!", room);
    renderGameState(room);
});

socket.on('error', (message) => { alert(`Error: ${message}`); });


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