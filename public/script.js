const socket = io();

let playerId = localStorage.getItem('game_player_id');
if (!playerId) {
    playerId = 'p_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('game_player_id', playerId);
}

let currentName = '';
let currentRoomCode = '';
let isHost = false;
let isReady = false;
let isSpectator = false;
let isGameActive = false;
let lastChatTime = 0;

socket.on('connect', () => {
    const savedRoom = sessionStorage.getItem('current_room_code');
    if (savedRoom) {
        socket.emit('rejoin_room', { roomCode: savedRoom, playerId });
    }
});

socket.on('rejoin_success', (data) => {
    currentRoomCode = data.roomCode;
    isHost = data.isHost;
    isSpectator = data.isSpectator;

    document.getElementById('step-name-screen').style.display = 'none';
    document.getElementById('step-room-screen').style.display = 'none';
    
    if (isSpectator) {
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'block';
    } else {
        document.getElementById('lobby-screen').style.display = 'block';
    }
    
    document.getElementById('room-code-display').innerText = currentRoomCode;
    updateRoleUI();
});

function goToRoomChoice() {
    const name = document.getElementById('username').value.trim();
    if (!name) {
        document.getElementById('name-error').innerText = 'Vui lòng nhập tên!';
        return;
    }

    currentName = name;
    document.getElementById('user-display-name').innerText = currentName;
    document.getElementById('step-name-screen').style.display = 'none';
    document.getElementById('step-room-screen').style.display = 'block';
}

function createRoom() {
    const roomPassword = document.getElementById('create-pass').value.trim();
    socket.emit('create_room', { name: currentName, roomPassword, playerId });
}

function joinRoom() {
    const roomCode = document.getElementById('join-code').value.trim();
    const roomPassword = document.getElementById('join-pass').value.trim();
    if (!roomCode) {
        document.getElementById('room-error').innerText = 'Nhập mã phòng 4 số!';
        return;
    }
    socket.emit('join_room', { roomCode, roomPassword, name: currentName, playerId });
}

socket.on('room_created', (data) => enterLobby(data.roomCode, true, false));
socket.on('join_success', (data) => enterLobby(data.roomCode, data.isHost, data.isSpectator));
socket.on('room_error', (msg) => document.getElementById('room-error').innerText = msg);

function enterLobby(roomCode, hostStatus, spectatorStatus) {
    currentRoomCode = roomCode;
    isHost = hostStatus;
    isSpectator = spectatorStatus;
    sessionStorage.setItem('current_room_code', roomCode);

    document.getElementById('chat-messages-lobby').innerHTML = '';
    document.getElementById('chat-messages-game').innerHTML = '';

    document.getElementById('step-room-screen').style.display = 'none';
    document.getElementById('game-over').style.display = 'none';
    
    if (isSpectator) {
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'block';
    } else {
        document.getElementById('lobby-screen').style.display = 'block';
        document.getElementById('game-screen').style.display = 'none';
    }

    document.getElementById('room-code-display').innerText = roomCode;

    if (!isHost) {
        isReady = false;
        const readyBtn = document.getElementById('ready-btn');
        readyBtn.innerText = "Sẵn Sàng";
        readyBtn.style.backgroundColor = "#ffc107";
        readyBtn.style.color = "black";
    }

    updateRoleUI();
}

function updateRoleUI() {
    const ansContainer = document.getElementById('answer-container');
    const specMsg = document.getElementById('spectator-msg');

    if (isSpectator) {
        if (ansContainer) ansContainer.style.display = 'none';
        if (specMsg) specMsg.style.display = 'block';
    } else {
        if (ansContainer) ansContainer.style.display = 'block';
        if (specMsg) specMsg.style.display = 'none';
    }

    if (isHost) {
        document.getElementById('host-controls').style.display = 'block';
        document.getElementById('player-controls').style.display = 'none';
        document.getElementById('host-category-select').style.display = 'block';
        document.getElementById('player-category-display').style.display = 'none';
    } else {
        document.getElementById('host-controls').style.display = 'none';
        document.getElementById('player-controls').style.display = isSpectator ? 'none' : 'block';
        document.getElementById('host-category-select').style.display = 'none';
        document.getElementById('player-category-display').style.display = 'block';
    }
}

function changeCategory() {
    if (!isHost) return;
    const category = document.getElementById('category-select').value;
    socket.emit('change_category', { roomCode: currentRoomCode, category });
}

socket.on('update_category', (category) => {
    document.getElementById('category-select').value = category;
    document.getElementById('current-category-text').innerText = category === 'Tất cả' ? '🎲 Tất Cả Chủ Đề' : category;
});

function toggleReady() {
    if (isSpectator) return;
    isReady = !isReady;
    const readyBtn = document.getElementById('ready-btn');
    
    if (isReady) {
        readyBtn.innerText = "Bỏ Sẵn Sàng";
        readyBtn.style.backgroundColor = "#dc3545";
        readyBtn.style.color = "white";
    } else {
        readyBtn.innerText = "Sẵn Sàng";
        readyBtn.style.backgroundColor = "#ffc107";
        readyBtn.style.color = "black";
    }

    socket.emit('toggle_ready', { roomCode: currentRoomCode, playerId });
}

function sendChat(type) {
    const now = Date.now();
    const cooldownMsg = document.getElementById(`chat-cooldown-${type}`);

    if (now - lastChatTime < 2000) {
        cooldownMsg.innerText = "Vui lòng đợi 2 giây!";
        return;
    }

    const input = document.getElementById(`chat-input-${type}`);
    const message = input.value.trim();
    if (!message) return;

    socket.emit('send_chat', { roomCode: currentRoomCode, message });
    input.value = '';
    lastChatTime = now;
    cooldownMsg.innerText = "";
}

socket.on('receive_chat', (data) => {
    ['lobby', 'game'].forEach(type => {
        const chatBox = document.getElementById(`chat-messages-${type}`);
        if (chatBox) {
            const p = document.createElement('p');
            p.style.margin = "4px 0";
            p.innerHTML = `<strong>${data.name}:</strong> ${data.message}`;
            chatBox.appendChild(p);
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    });
});

function startGame() {
    socket.emit('start_game', { roomCode: currentRoomCode, playerId });
}

socket.on('start_error', (msg) => {
    document.getElementById('lobby-error').innerText = msg;
});

socket.on('new_question', (data) => {
    isGameActive = true;
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';

    document.getElementById('q-number').innerText = `Câu hỏi ${data.questionNumber}/10 [${data.category}]`;
    document.getElementById('q-text').innerText = data.question;
    document.getElementById('feedback').innerText = '';
    
    const ansInput = document.getElementById('answer-input');
    const submitBtn = document.getElementById('submit-ans-btn');
    const ansContainer = document.getElementById('answer-container');
    const specMsg = document.getElementById('spectator-msg');

    if (isSpectator) {
        ansContainer.style.display = 'none';
        specMsg.style.display = 'block';
    } else {
        ansContainer.style.display = 'block';
        specMsg.style.display = 'none';
        ansInput.value = '';
        ansInput.disabled = false;
        submitBtn.disabled = false;
    }
});

function submitAnswer() {
    if (isSpectator) return;
    const input = document.getElementById('answer-input');
    const answer = input.value.trim();
    if (!answer) return;

    socket.emit('submit_answer', { roomCode: currentRoomCode, answer });
    input.value = '';
}

socket.on('timer_update', (timeLeft) => {
    document.getElementById('time').innerText = timeLeft;
});

socket.on('answer_result', (res) => {
    const feedback = document.getElementById('feedback');
    if (res.correct) {
        feedback.style.color = 'green';
        feedback.innerText = `Chính xác! Bạn đứng thứ ${res.rank} (+${res.points} điểm)`;
        document.getElementById('answer-input').disabled = true;
        document.getElementById('submit-ans-btn').disabled = true;
    } else {
        feedback.style.color = 'red';
        feedback.innerText = 'Sai rồi, thử lại xem!';
    }
});

socket.on('show_answer', (data) => {
    document.getElementById('feedback').style.color = 'blue';
    document.getElementById('feedback').innerText = `Hết giờ! Đáp án là: ${data.answer.toUpperCase()}`;
    if (!isSpectator) {
        document.getElementById('answer-input').disabled = true;
        document.getElementById('submit-ans-btn').disabled = true;
    }
});

socket.on('update_leaderboard', (players) => {
    const playerListLobby = document.getElementById('player-list-lobby');
    if (playerListLobby) playerListLobby.innerHTML = '';

    const scoreList = document.getElementById('score-list');
    if (scoreList) scoreList.innerHTML = '';

    document.getElementById('player-count-lobby').innerText = players.length;

    const me = players.find(p => p.playerId === playerId);
    if (me) {
        isSpectator = me.isSpectator;
        updateRoleUI();
    }

    players.forEach((player) => {
        if (playerListLobby) {
            const liLobby = document.createElement('li');
            liLobby.style.display = 'flex';
            liLobby.style.justifyContent = 'space-between';
            liLobby.style.alignItems = 'center';

            let statusText = player.ready ? " ✅ (Đã sẵn sàng)" : " ⏳ (Chưa sẵn sàng)";
            if (player.isSpectator) statusText = " 👁️ (Khán giả)";
            else if (player.isHost) statusText = " 👑 (Chủ phòng)";

            let html = `<span>${player.name}${statusText}</span>`;
            
            if (isHost && player.playerId !== playerId) {
                html += `<button onclick="kickPlayer('${player.playerId}')" style="width: auto; padding: 4px 8px; font-size: 12px; background: #dc3545; color: white; margin: 0; border-radius: 4px;">❌ Đuổi</button>`;
            }
            liLobby.innerHTML = html;
            playerListLobby.appendChild(liLobby);
        }
    });

    if (scoreList) {
        const activePlayers = players.filter(p => !p.isSpectator);
        const sortedPlayers = [...activePlayers].sort((a, b) => b.score - a.score);
        
        sortedPlayers.forEach((player, index) => {
            const liGame = document.createElement('li');
            liGame.style.display = 'flex';
            liGame.style.justifyContent = 'space-between';
            liGame.style.padding = '8px 0';
            
            let badge = `Hạng ${index + 1}`;
            if (index === 0) badge = '🥇 Hạng 1';
            else if (index === 1) badge = '🥈 Hạng 2';
            else if (index === 2) badge = '🥉 Hạng 3';

            liGame.innerHTML = `<span><b>${badge}:</b> ${player.name}</span> <b>${player.score} điểm</b>`;
            scoreList.appendChild(liGame);
        });
    }
});

socket.on('game_over', (players) => {
    isGameActive = false;
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('game-over').style.display = 'block';

    const activePlayers = players.filter(p => !p.isSpectator);
    const sortedPlayers = [...activePlayers].sort((a, b) => b.score - a.score);
    if (sortedPlayers.length > 0) {
        document.getElementById('winner-text').innerText = 
            `🏆 Chúc mừng ${sortedPlayers[0].name} đã đạt ${sortedPlayers[0].score} điểm!`;
    }
});

function playAgain() {
    socket.emit('back_to_lobby', { roomCode: currentRoomCode, playerId });
}

socket.on('return_to_lobby', () => {
    isGameActive = false;
    isSpectator = false;
    document.getElementById('game-over').style.display = 'none';
    document.getElementById('game-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'block';
    
    updateRoleUI();

    if (!isHost) {
        isReady = false;
        const readyBtn = document.getElementById('ready-btn');
        readyBtn.innerText = "Sẵn Sàng";
        readyBtn.style.backgroundColor = "#ffc107";
        readyBtn.style.color = "black";
    }
});

function leaveRoom() { 
    if (confirm("Bạn có chắc chắn muốn rời phòng?")) {
        sessionStorage.removeItem('current_room_code');
        socket.emit('leave_room', { roomCode: currentRoomCode, playerId });
        
        currentRoomCode = '';
        isHost = false;
        isReady = false;
        isSpectator = false;
        isGameActive = false;

        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-over').style.display = 'none';
        document.getElementById('game-screen').style.display = 'none';
        document.getElementById('step-room-screen').style.display = 'block';
    }
}

function kickPlayer(targetPlayerId) {
    if (confirm("Bạn có chắc chắn muốn mời người này ra khỏi phòng không?")) {
        socket.emit('kick_player', { roomCode: currentRoomCode, targetPlayerId });
    }
}

socket.on('kicked_out', () => {
    alert("Bạn đã bị Chủ phòng mời ra khỏi phòng!");
    sessionStorage.removeItem('current_room_code');
    location.reload();
});