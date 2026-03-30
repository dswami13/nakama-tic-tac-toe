/// <reference types="nakama-runtime" />

interface GameState {
    board: string[];          
    turn: string;             
    presences: nkruntime.Presence[]; 
    active: boolean;
    //Securely maps a player's sessionId to "X" or "O"
    marks: { [sessionId: string]: string };
    //Tracks who wants a rematch
    playAgainVotes: string[];      
}

//RPC Function to create a custom match ---
const rpcCreateMatch: nkruntime.RpcFunction = function (ctx, logger, nk, payload) {
    try {
        const matchId = nk.matchCreate("tic_tac_toe", {});
        logger.info(`Custom match created via RPC: ${matchId}`);
        return JSON.stringify({ matchId: matchId });
    } catch (error: any) {
        logger.error(`Error creating custom match: ${error.message}`);
        throw error;
    }
};

// FIX: Removed 'export const' and replaced with 'let'
let InitModule: nkruntime.InitModule = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
    initializer.registerMatch("tic_tac_toe", {
        matchInit, matchJoinAttempt, matchJoin, matchLeave, matchLoop, matchTerminate, matchSignal
    });
    initializer.registerMatchmakerMatched(matchmakerMatched);

    //Register the RPC so the frontend can call it
    initializer.registerRpc("create_match", rpcCreateMatch);
    
    logger.info("Tic-Tac-Toe Server-Authoritative Module Loaded!");
};

const matchmakerMatched: nkruntime.MatchmakerMatchedFunction = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult[]) {
    try {
        // FIX: Remove the complex 'users' parameter. Just create the room.
        return nk.matchCreate("tic_tac_toe", {}); 
    } catch (error: any) {
        logger.error("Match create error: %s", error.message);
        return ""; 
    }
};

// FIX 2: Explicitly pass <GameState> to the type definitions
const matchInit: nkruntime.MatchInitFunction<GameState> = function (ctx, logger, nk, params) {
    const state: GameState = {
        board: ["", "", "", "", "", "", "", "", ""],
        turn: "X",
        presences: [],
        active: true,
        marks: {}, // Initialize empty
        playAgainVotes: []
    };
    return { state, tickRate: 10, label: "tic-tac-toe" };
};

const matchJoinAttempt: nkruntime.MatchJoinAttemptFunction<GameState> = function (ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
    return { state, accept: state.presences.length < 2 };
};

const matchJoin: nkruntime.MatchJoinFunction<GameState> = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    for (const presence of presences) {
        state.presences.push(presence);
        
        // Securely assign symbols if they don't have one yet
        if (!state.marks[presence.sessionId]) {
            if (Object.keys(state.marks).length === 0) {
                state.marks[presence.sessionId] = "X";
            } else {
                state.marks[presence.sessionId] = "O";
            }
        }
    }

    // If the game has already started and someone is rejoining, 
    // send them the current board state!
    if (state.active) {
        dispatcher.broadcastMessage(7, JSON.stringify({
            board: state.board,
            turn: state.turn
        }));
    }

    return { state };
};

const matchLeave: nkruntime.MatchLeaveFunction<GameState> = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    // 1. Remove the players who left from the state
    state.presences = state.presences.filter(p => !presences.some(left => left.sessionId === p.sessionId));

    // If EVERYONE left, shut down the server room
    if (state.presences.length === 0) {
        logger.info("Room empty. Shutting down match.");
        return null; 
    }

    // If one player is still here, tell them their opponent disconnected
    dispatcher.broadcastMessage(4, JSON.stringify({
        message: "Opponent disconnected. Waiting for them to rejoin..."
    }));

    return { state };
};

function checkWinner(board: string[]): string | null {
    const winningCombos = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
        [0, 4, 8], [2, 4, 6]             // Diagonals
    ];

    for (const combo of winningCombos) {
        const [a, b, c] = combo;
        if (board[a] !== "" && board[a] === board[b] && board[a] === board[c]) {
            return board[a]; // Returns "X" or "O" if someone won
        }
    }
    return null; // No winner yet
}

const matchLoop: nkruntime.MatchLoopFunction<GameState> = function (ctx, logger, nk, dispatcher, tick, state, messages) {
    for (const message of messages) {
        
        // --- NEW: HANDLE PLAY AGAIN VOTES (OpCode 5) ---
        if (message.opCode === 5 && !state.active) {
            // Add the player's ID to the vote list if they haven't voted yet
            if (state.playAgainVotes.indexOf(message.sender.sessionId) === -1) {
                state.playAgainVotes.push(message.sender.sessionId);
                logger.info(`${message.sender.sessionId} voted to play again. Votes: ${state.playAgainVotes.length}/2`);
            }

            // If both players voted, restart the game!
            if (state.playAgainVotes.length === 2) {
                state.board = ["", "", "", "", "", "", "", "", ""];
                state.active = true;
                state.playAgainVotes = [];
                state.turn = "X"; // X always starts the new game

                logger.info("Both players voted. Restarting match!");
                
                // Broadcast OpCode 6 to tell clients to reset their boards
                dispatcher.broadcastMessage(6, JSON.stringify({
                    board: state.board,
                    turn: state.turn
                }));
            }
        }

        // --- EXISTING MOVE LOGIC (OpCode 1) ---
        // Notice we added `&& state.active` so players can't move after the game ends
        if (message.opCode === 1 && state.active) {
            try {
                let data: any;
                let dataString = "";

                if (typeof message.data === "string") {
                    dataString = message.data as string;
                } else {
                    dataString = nk.binaryToString(message.data);
                }

                try {
                    data = JSON.parse(dataString);
                } catch (e) {
                    const decodedBytes = nk.base64Decode(dataString);
                    const decodedString = nk.binaryToString(decodedBytes);
                    data = JSON.parse(decodedString);
                }

                if (typeof data === "string") {
                    data = JSON.parse(data);
                }

                const index = data.index;
                const playerSymbol = state.marks[message.sender.sessionId];
                
                if (playerSymbol && state.turn === playerSymbol && index !== undefined && state.board[index] === "") {
                    state.board[index] = playerSymbol; 
                    
                    dispatcher.broadcastMessage(2, JSON.stringify({
                        index: index,
                        symbol: playerSymbol,
                        board: state.board
                    }));

                    const winner = checkWinner(state.board);
                    const isDraw = state.board.indexOf("") === -1 && winner === null;

                    if (winner !== null || isDraw) {
                        state.active = false;
                        dispatcher.broadcastMessage(3, JSON.stringify({ winner: winner, isDraw: isDraw }));
                    } else {
                        state.turn = state.turn === "X" ? "O" : "X";
                    }
                }
            } catch (error: any) {
                logger.error(`CRASH in matchLoop: ${error.message}`);
            }
        }
    }
    return { state };
};

const matchTerminate: nkruntime.MatchTerminateFunction<GameState> = function (ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
    return { state };
};

const matchSignal: nkruntime.MatchSignalFunction<GameState> = function (ctx, logger, nk, dispatcher, tick, state, data) {
    return { state, data: "signal received" };
};

// This prevents Rollup from deleting InitModule during its tree-shaking optimization
InitModule && InitModule.bind(null);

export {};