// 1. Initialize the Nakama Client
const client = new nakamajs.Client("defaultkey", "3.107.113.140", "7350");
client.useSSL = false; 

// --- GLOBAL VARIABLES ---
let session = null;
let socket = null;
let matchId = null; 
let isGameActive = false; 

// --- UI ELEMENTS ---
const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen'); // <-- NEW LOBBY
const matchmakingScreen = document.getElementById('matchmaking-screen');
const gameScreen = document.getElementById('game-screen');

const nicknameInput = document.getElementById('nickname-input');
const loginBtn = document.getElementById('login-btn');
const playAgainBtn = document.getElementById('play-again-btn');
const leaveMatchBtn = document.getElementById('leave-match-btn');

// Lobby Buttons
const quickPlayBtn = document.getElementById('quick-play-btn');
const createMatchBtn = document.getElementById('create-match-btn');
const refreshMatchesBtn = document.getElementById('refresh-matches-btn');
const matchListDiv = document.getElementById('match-list');

const cells = document.querySelectorAll('.cell');


// --- SERVER MESSAGE HANDLER ---
function handleServerMessages(result) {
    if (!result.data) return;
    let data;

    try {
        if (typeof result.data === 'object' && !(result.data instanceof ArrayBuffer)) {
            data = result.data;
        } else if (typeof result.data === 'string') {
            try { data = JSON.parse(result.data); } 
            catch (e) { data = JSON.parse(atob(result.data)); }
        } else {
            data = JSON.parse(new TextDecoder().decode(new Uint8Array(result.data)));
        }

        if (result.op_code === 2) {
            updateBoard(data.board);
            const nextTurn = data.symbol === "X" ? "O" : "X";
            document.getElementById('status-text').innerText = `Turn: ${nextTurn}`;
        } 
        else if (result.op_code === 3) {
            if (data.board) updateBoard(data.board);
            const msg = data.isDraw ? "It's a Draw!" : `Player ${data.winner} Wins!`;
            document.getElementById('status-text').innerText = "Game Over: " + msg;
            isGameActive = false; 
            playAgainBtn.style.display = 'block'; 
        }
        else if (result.op_code === 6) {
            updateBoard(data.board); 
            isGameActive = true;     
            document.getElementById('status-text').innerText = `Game Restarted! Turn: ${data.turn}`;
            playAgainBtn.style.display = 'none'; 
        }
        else if (result.op_code === 7) {
            updateBoard(data.board); 
            isGameActive = true;
            document.getElementById('status-text').innerText = `Reconnected! Turn: ${data.turn}`;
            playAgainBtn.style.display = 'none'; 
        }
        else if (result.op_code === 4) {
            document.getElementById('status-text').innerText = data.message;
            isGameActive = false;
        }

    } catch (error) {
        console.error("Failed to decode match data:", error);
    }
}

// --- BUTTON LOGIC (Play Again) ---
playAgainBtn.addEventListener('click', async () => {
    playAgainBtn.style.display = 'none'; 
    document.getElementById('status-text').innerText = "Waiting for opponent...";
    await socket.sendMatchState(matchId, 5, JSON.stringify({}));
});

// --- LEAVE MATCH LOGIC ---
leaveMatchBtn.addEventListener('click', async () => {
    if (!matchId) return; // Do nothing if we aren't in a match

    try {
        await socket.leaveMatch(matchId);
        console.log("Left the match on the server.");
    } catch (error) {
        console.error("Error leaving match:", error);
    }

    // Clear local data
    sessionStorage.removeItem('matchId');
    matchId = null;
    isGameActive = false;

    // Reset the UI
    updateBoard(["", "", "", "", "", "", "", "", ""]);
    document.getElementById('status-text').innerText = "Waiting for opponent...";
    playAgainBtn.style.display = 'none';

    // Send player back to the lobby
    gameScreen.classList.remove('active');
    lobbyScreen.classList.add('active');
});

// --- LOGIN LOGIC ---
loginBtn.addEventListener('click', async () => {
    const rawNickname = nicknameInput.value.trim();
    if (!rawNickname) return alert("Please enter a nickname!");

    const safeNickname = rawNickname.replace(/[^a-zA-Z0-9_.-]/g, '');
    if (safeNickname.length < 3) return alert("Nickname must be at least 3 valid letters/numbers!");

    try {
        const uniqueDeviceId = "device-" + Date.now() + "-" + Math.floor(Math.random() * 10000);

        session = await client.authenticateDevice(uniqueDeviceId, undefined, safeNickname);
        sessionStorage.setItem('nakamaToken', session.token); 
        console.log("Successfully authenticated:", session);

        socket = client.createSocket();
        await socket.connect(session, true);
        console.log("Socket connected!");
        
        socket.onmatchdata = handleServerMessages;

        // --- THE MATCHMAKER LISTENER MUST BE DEFINED HERE ---
        socket.onmatchmakermatched = async (matched) => {
            console.log("Match found!", matched);
            try {
                const match = await socket.joinMatch(matched.match_id, matched.token);
                matchId = match.match_id;
                sessionStorage.setItem('matchId', matchId); 
                isGameActive = true;
                
                lobbyScreen.classList.remove('active'); // Hide lobby
                matchmakingScreen.classList.remove('active'); // Hide matchmaker
                gameScreen.classList.add('active'); // Show board
                
                document.getElementById('status-text').innerText = "Game Started! X goes first.";
            } catch (error) {
                console.error("Error joining match:", error);
            }
        };

        // Switch to Lobby after login
        loginScreen.classList.remove('active');
        lobbyScreen.classList.add('active');

    } catch (error) {
        console.error("Login failed:", error);
        alert("Could not connect to server. Is Docker running?");
    }
});


// --- LOBBY ROUTING LOGIC ---

// 1. Quick Play
quickPlayBtn.addEventListener('click', async () => {
    lobbyScreen.classList.remove('active');
    matchmakingScreen.classList.add('active');
    console.log("Joining matchmaker pool...");
    await socket.addMatchmaker("*", 2, 2);
});

// 2. Create Custom Match
createMatchBtn.addEventListener('click', async () => {
    try {
        const response = await client.rpc(session, "create_match", {});
        const newMatchId = response.payload.matchId;
        await joinSpecificMatch(newMatchId);
        document.getElementById('status-text').innerText = "Room Created! Waiting for opponent...";
    } catch (error) {
        console.error("Error creating match:", error);
        alert("Error: Did you rebuild main.ts and restart the Nakama Docker container?");
    }
});

// 3. Browse Matches
refreshMatchesBtn.addEventListener('click', async () => {
    try {
        matchListDiv.innerHTML = "Searching...";
        
        // FIX: The correct order of parameters (minSize, maxSize, limit, label)
        // Search for up to 10 authoritative matches labeled "tic-tac-toe" with exactly 1 player
        const result = await client.listMatches(session, 10, true, "tic-tac-toe", 1, 1);
        
        // FIX: Protect against undefined if the server returns exactly zero matches
        const openMatches = result.matches || [];
        
        matchListDiv.innerHTML = "";
        
        if (openMatches.length === 0) {
            matchListDiv.innerText = "No open matches found.";
            return;
        }

        openMatches.forEach(match => {
            const btn = document.createElement('button');
            btn.innerText = `Join Room (${match.match_id.substring(0, 5)}...)`;
            btn.style.display = "block";
            btn.style.marginTop = "5px";
            
            btn.addEventListener('click', () => joinSpecificMatch(match.match_id));
            matchListDiv.appendChild(btn);
        });
    } catch (error) {
        console.error("Error listing matches:", error);
        matchListDiv.innerText = "Error fetching matches.";
    }
});

// Helper for joining custom/listed matches
async function joinSpecificMatch(targetMatchId) {
    try {
        const match = await socket.joinMatch(targetMatchId);
        matchId = match.match_id;
        sessionStorage.setItem('matchId', matchId); 
        isGameActive = true;
        
        lobbyScreen.classList.remove('active');
        matchmakingScreen.classList.remove('active');
        gameScreen.classList.add('active');
    } catch (error) {
        console.error("Error joining match:", error);
        alert("Could not join this room. It may be full or closed.");
    }
}

// --- GAME BOARD LOGIC ---
cells.forEach(cell => {
    cell.addEventListener('click', async (e) => {
        if (!matchId || !isGameActive) return; 

        const index = parseInt(e.currentTarget.getAttribute('data-index'));
        if (isNaN(index)) return;

        const payload = JSON.stringify({ index: index });
        await socket.sendMatchState(matchId, 1, payload);
    });
});

function updateBoard(boardArray) {
    cells.forEach((cell, i) => {
        cell.innerText = boardArray[i];
    });
}


// --- RECONNECTION LOGIC ---
window.addEventListener('DOMContentLoaded', async () => {
    const savedToken = sessionStorage.getItem('nakamaToken');
    const savedMatchId = sessionStorage.getItem('matchId');

    if (savedToken && savedMatchId) {
        console.log("Found saved session. Attempting to reconnect...");
        
        try {
            session = nakamajs.Session.restore(savedToken);
            
            if (session.isexpired(Date.now() / 1000)) {
                console.warn("Token expired! Please log in again.");
                sessionStorage.clear(); 
                return; 
            }

            socket = client.createSocket();
            await socket.connect(session, true);
            socket.onmatchdata = handleServerMessages; 

            // IMPORTANT: We need the matchmaker listener here too just in case!
            socket.onmatchmakermatched = async (matched) => {
                const match = await socket.joinMatch(matched.match_id, matched.token);
                matchId = match.match_id;
                sessionStorage.setItem('matchId', matchId); 
                isGameActive = true;
                
                lobbyScreen.classList.remove('active');
                matchmakingScreen.classList.remove('active');
                gameScreen.classList.add('active');
            };

            matchId = savedMatchId;
            await socket.joinMatch(matchId);
            console.log("Successfully rejoined match!");
            
            loginScreen.classList.remove('active');
            lobbyScreen.classList.remove('active'); // Ensure lobby is hidden on reconnect
            matchmakingScreen.classList.remove('active');
            gameScreen.classList.add('active');

        } catch (e) {
            console.warn("Could not rejoin match.", e);
            sessionStorage.removeItem('matchId'); 
        }
    }
});