// This script handles the client-side logic for interacting with the server.

const socket = io();

// --- Client State ---
let myPlayerInfo = {};
let myId = '';

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

/**
 * Renders a single card element.
 * @param {object} card - The card data to render.
 * @returns {HTMLElement} The card element.
 */
function createCardElement(card) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'w-40 h-56 bg-slate-700 rounded-lg p-3 flex flex-col justify-between border-2 border-slate-600 hover:border-sky-400 cursor-pointer transition-all duration-200 flex-shrink-0';
    cardDiv.dataset.cardId = card.id;
    cardDiv.innerHTML = `
        <h3 class="font-bold text-sm text-sky-200">${card.name}</h3>
        <p class="text-xs text-slate-300 flex-grow">${card.effect}</p>
        <p class="text-xs text-slate-500 italic">${card.type}</p>
    `;
    // Add event listener to play the card when clicked
    cardDiv.addEventListener('click', () => {
        socket.emit('playCard', { cardId: card.id });
    });
    return cardDiv;
}

/**
 * The main rendering function for the entire game state.
 * @param {object} room - The full room object from the server.
 */
function renderGameState(room) {
    const { players, gameState } = room;
    myPlayerInfo = players[myId];

    // Update Player List, highlighting the current player
    const currentPlayerId = gameState.turnOrder[gameState.currentPlayerIndex];
    playerList.innerHTML = ''; 
    for (const id in players) {
        const player = players[id];
        const isCurrentTurn = id === currentPlayerId;
        const li = document.createElement('li');
        li.id = `player-${id}`;
        li.className = `flex items-center justify-between p-2 rounded-md transition-colors ${isCurrentTurn ? 'bg-yellow-500/30 border border-yellow-400' : 'bg-slate-700'}`;
        li.innerHTML = `
            <span class="${isCurrentTurn ? 'font-bold text-yellow-200' : ''}">${player.name} (${player.hand.length} cards)</span>
            <span class="text-xs font-semibold ${player.role === 'DM' ? 'text-yellow-300' : 'text-sky-300'} bg-slate-800 px-2 py-1 rounded-full">${player.role}</span>
        `;
        playerList.appendChild(li);
    }
    
    // Update Turn Indicator
    if (gameState.phase === 'active') {
        const currentPlayerName = players[currentPlayerId]?.name || 'Unknown';
        turnIndicator.textContent = `Current Turn: ${currentPlayerName}`;
        if (currentPlayerId === myId) {
             turnIndicator.textContent += " (Your Turn!)";
             endTurnBtn.classList.remove('hidden');
        } else {
            endTurnBtn.classList.add('hidden');
        }
    }

    // Render Player Hand
    playerHandDiv.innerHTML = '';
    if (myPlayerInfo && myPlayerInfo.hand) {
        myPlayerInfo.hand.forEach(card => {
            playerHandDiv.appendChild(createCardElement(card));
        });
    }
    
    // Render Game Board (played cards)
    gameBoardDiv.innerHTML = '';
    if (gameState.board && gameState.board.playedCards) {
        gameState.board.playedCards.forEach(card => {
            const cardEl = createCardElement(card);
            cardEl.classList.remove('cursor-pointer', 'hover:border-sky-400'); // Cannot play cards from board
            cardEl.classList.add('opacity-80');
            cardEl.removeEventListener('click', () => {});
            gameBoardDiv.appendChild(cardEl);
        });
    }
}


function showGameArea(role) {
    lobbyScreen.classList.add('hidden');
    gameArea.classList.remove('hidden');

    if (role === 'DM') {
        const partyOption = chatChannel.querySelector('option[value="party"]');
        if (partyOption) {
            partyOption.disabled = true;
            partyOption.textContent = 'Party (N/A)';
        }
        startGameBtn.classList.remove('hidden'); // Show start button for DM
    }
}

// --- Client-Side Event Emitters ---

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


// --- Server-Side Event Listeners ---

socket.on('roomCreated', ({ roomId, players, yourId }) => {
    myId = yourId;
    myPlayerInfo = players[yourId];
    roomCodeDisplay.textContent = roomId;
    renderGameState({ players, gameState: { phase: 'lobby', turnOrder: [], board: {} } });
    showGameArea(myPlayerInfo.role);
    logMessage(`You created the room. The code is ${roomId}.`);
});

socket.on('joinSuccess', ({ roomId, players, yourId }) => {
    myId = yourId;
    myPlayerInfo = players[yourId];
    roomCodeDisplay.textContent = roomId;
    renderGameState({ players, gameState: { phase: 'lobby', turnOrder: [], board: {} } });
    showGameArea(myPlayerInfo.role);
    logMessage(`You joined room ${roomId}. Welcome!`);
});

socket.on('playerJoined', ({ players }) => {
    const newPlayerName = Object.values(players).pop().name;
    logMessage(`${newPlayerName} has joined the room.`);
    // A full render is needed to update player counts etc.
    const room = { players, gameState: { phase: 'lobby', turnOrder: [], board: {} } } // Mock room for lobby state
    renderGameState(room);
});

socket.on('playerLeft', ({ players, playerName }) => {
    logMessage(`${playerName} has left the room.`);
    const room = { players, gameState: { phase: 'lobby', turnOrder: [], board: {} } } // Mock room for lobby state
    renderGameState(room);
});

socket.on('chatMessage', ({ senderName, message, channel }) => {
    logMessage(message, { type: 'chat', channel, senderName });
});

// --- Game State Listeners ---
socket.on('gameStarted', (room) => {
    console.log("Game has started!", room);
    startGameBtn.classList.add('hidden'); // Hide start button after game starts
    renderGameState(room);
});

socket.on('gameStateUpdate', (room) => {
    console.log("Game state updated!", room);
    renderGameState(room);
});


socket.on('error', (message) => {
    console.error('Server error:', message);
    alert(`Error: ${message}`);
});
