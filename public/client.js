// This script handles the client-side logic for interacting with the server.

const socket = io();

// --- Client State ---
let myPlayerInfo = {};
let myId = '';
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
        
        p.innerHTML = `
            <span class="${channelColor} font-semibold">${channelTag}</span>
            <span class="${senderColor}">${senderName}:</span>
            <span class="text-slate-200">${message}</span>
        `;
    }
    
    chatLog.appendChild(p);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function createCardElement(card) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'w-40 h-56 bg-slate-700 rounded-lg p-3 flex flex-col justify-between border-2 border-slate-600 hover:border-sky-400 cursor-pointer transition-all duration-200 flex-shrink-0';
    cardDiv.dataset.cardId = card.id;
    cardDiv.innerHTML = `
        <h3 class="font-bold text-sm text-sky-200">${card.name}</h3>
        <p class="text-xs text-slate-300 flex-grow">${card.effect}</p>
        <p class="text-xs text-slate-500 italic">${card.type} / ${card.category || 'General'}</p>
    `;
    cardDiv.addEventListener('click', () => {
        socket.emit('playCard', { cardId: card.id });
    });
    return cardDiv;
}

function renderGameState(room) {
    const { players, gameState } = room;
    myPlayerInfo = players[myId];
    if (!myPlayerInfo) {
        // If our player info isn't in the list (e.g., we are a spectator or just left), do nothing.
        return;
    }

    const currentPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
    playerList.innerHTML = ''; 
    for (const id in players) {
        const player = players[id];
        const isCurrentTurn = id === currentPlayerId;
        const li = document.createElement('li');
        li.id = `player-${id}`;
        li.className = `p-2 rounded-md transition-colors ${isCurrentTurn ? 'bg-yellow-500/30 border border-yellow-400' : 'bg-slate-700'}`;
        
        const npcTag = player.isNpc ? '<span class="text-xs text-slate-400">[NPC]</span> ' : '';
        const roleColor = player.role === 'DM' ? 'text-yellow-300' : 'text-sky-300';

        li.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="${isCurrentTurn ? 'font-bold text-yellow-200' : ''}">${npcTag}${player.name} (${player.hand.length})</span>
                <span class="text-xs font-semibold ${roleColor} bg-slate-800 px-2 py-1 rounded-full">${player.role}</span>
            </div>
            <div class="text-xs text-green-400 mt-1">HP: ${player.currentHp} / ${player.maxHp}</div>
        `;
        playerList.appendChild(li);
    }
    
    if (gameState.phase === 'active') {
        const currentPlayer = players[currentPlayerId];
        const currentPlayerName = currentPlayer?.name || 'Unknown';
        turnIndicator.textContent = `Current Turn: ${currentPlayerName}`;
        if (currentPlayerId === myId) {
             turnIndicator.textContent += " (Your Turn!)";
             endTurnBtn.classList.remove('hidden');
        } else {
            endTurnBtn.classList.add('hidden');
        }
    }

    playerHandDiv.innerHTML = '';
    if (myPlayerInfo && myPlayerInfo.hand) {
        myPlayerInfo.hand.forEach(card => {
            playerHandDiv.appendChild(createCardElement(card));
        });
    }
    
    const allBoardCards = [...(gameState.board.playedCards || []), ...(gameState.board.monsters || [])];
    gameBoardDiv.innerHTML = '';
    if (allBoardCards.length > 0) {
        allBoardCards.forEach(card => {
            const cardEl = createCardElement(card);
            cardEl.classList.remove('cursor-pointer', 'hover:border-sky-400');
            cardEl.classList.add('opacity-80');
            cardEl.removeEventListener('click', () => {});
            gameBoardDiv.appendChild(cardEl);
        });
    }
}


function showGameArea() {
    lobbyScreen.classList.add('hidden');
    gameArea.classList.remove('hidden');

    const myRole = myPlayerInfo.role;

    if (myRole === 'DM') {
        const partyOption = chatChannel.querySelector('option[value="party"]');
        if (partyOption) {
            partyOption.disabled = true;
            partyOption.textContent = 'Party (N/A)';
        }
    }
    // Only the original creator gets the start button initially
    startGameBtn.classList.remove('hidden');
}

createRoomBtn.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    if (!playerName) return alert('Please enter a player name.');
    socket.emit('createRoom', playerName);
});

joinRoomBtn.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    const roomId = roomIdInput.value.trim();
    if (!playerName || !roomId) return alert('Please enter a player name and a room code.');
    socket.emit('joinRoom', { roomId, playerName });
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

startGameBtn.addEventListener('click', () => {
    socket.emit('startGame');
});

endTurnBtn.addEventListener('click', () => {
    socket.emit('endTurn');
});


socket.on('roomCreated', ({ roomId, players, yourId }) => {
    myId = yourId;
    myPlayerInfo = players[yourId];
    roomCodeDisplay.textContent = roomId;
    renderGameState({ players, gameState: { phase: 'lobby', turnOrder: [], board: {} } });
    showGameArea();
    logMessage(`You created the room. The code is ${roomId}.`);
});

socket.on('joinSuccess', ({ roomId, players, yourId }) => {
    myId = yourId;
    myPlayerInfo = players[yourId];
    roomCodeDisplay.textContent = roomId;
    renderGameState({ players, gameState: { phase: 'lobby', turnOrder: [], board: {} } });
    showGameArea();
    logMessage(`You joined room ${roomId}. Welcome!`);
    startGameBtn.classList.add('hidden'); // Only creator can start
});

socket.on('playerJoined', (data) => {
    const newPlayerName = Object.values(data.players).find(p => !document.getElementById(`player-${p.id}`)).name;
    logMessage(`${newPlayerName} has joined the room.`);
    renderGameState({ ...data, gameState: { phase: 'lobby', turnOrder: [], board: {} } });
});

socket.on('playerLeft', (data) => {
    logMessage(`${data.playerName} has left the room.`);
    renderGameState({ ...data, gameState: { phase: 'lobby', turnOrder: [], board: {} } });
});

socket.on('chatMessage', ({ senderName, message, channel }) => {
    logMessage(message, { type: 'chat', channel, senderName });
});

socket.on('gameStarted', (room) => {
    console.log("Game has started!", room);
    startGameBtn.classList.add('hidden');
    renderGameState(room);
    
    // Update our own role and UI based on what the server assigned
    myPlayerInfo = room.players[myId];
    if (myPlayerInfo.role === 'DM') {
        const partyOption = chatChannel.querySelector('option[value="party"]');
        if (partyOption) {
            partyOption.disabled = true;
            partyOption.textContent = 'Party (N/A)';
        }
    }
});

socket.on('gameStateUpdate', (room) => {
    console.log("Game state updated!", room);
    renderGameState(room);
});

socket.on('error', (message) => {
    console.error('Server error:', message);
    alert(`Error: ${message}`);
});


// WebRTC Logic remains unchanged
joinVoiceBtn.addEventListener('click', async () => { /* ... */ });
socket.on('voice-peers', (peerIds) => { /* ... */ });
socket.on('voice-peer-join', ({ peerId }) => { /* ... */ });
socket.on('voice-offer', ({ offer, fromId }) => { /* ... */ });
socket.on('voice-answer', ({ answer, fromId }) => { /* ... */ });
socket.on('voice-ice-candidate', ({ candidate, fromId }) => { /* ... */ });
socket.on('voice-peer-disconnect', ({ peerId }) => { /* ... */ });
