'use strict';

/// <reference types="nakama-runtime" />
//RPC Function to create a custom match ---
var rpcCreateMatch = function (ctx, logger, nk, payload) {
    try {
        var matchId = nk.matchCreate("tic_tac_toe", {});
        logger.info("Custom match created via RPC: ".concat(matchId));
        return JSON.stringify({ matchId: matchId });
    }
    catch (error) {
        logger.error("Error creating custom match: ".concat(error.message));
        throw error;
    }
};
// FIX: Removed 'export const' and replaced with 'let'
var InitModule = function (ctx, logger, nk, initializer) {
    initializer.registerMatch("tic_tac_toe", {
        matchInit: matchInit,
        matchJoinAttempt: matchJoinAttempt,
        matchJoin: matchJoin,
        matchLeave: matchLeave,
        matchLoop: matchLoop,
        matchTerminate: matchTerminate,
        matchSignal: matchSignal
    });
    initializer.registerMatchmakerMatched(matchmakerMatched);
    //Register the RPC so the frontend can call it
    initializer.registerRpc("create_match", rpcCreateMatch);
    logger.info("Tic-Tac-Toe Server-Authoritative Module Loaded!");
};
var matchmakerMatched = function (ctx, logger, nk, matches) {
    try {
        // FIX: Remove the complex 'users' parameter. Just create the room.
        return nk.matchCreate("tic_tac_toe", {});
    }
    catch (error) {
        logger.error("Match create error: %s", error.message);
        return "";
    }
};
// FIX 2: Explicitly pass <GameState> to the type definitions
var matchInit = function (ctx, logger, nk, params) {
    var state = {
        board: ["", "", "", "", "", "", "", "", ""],
        turn: "X",
        presences: [],
        active: true,
        marks: {},
        playAgainVotes: []
    };
    return { state: state, tickRate: 10, label: "tic-tac-toe" };
};
var matchJoinAttempt = function (ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
    return { state: state, accept: state.presences.length < 2 };
};
var matchJoin = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    for (var _i = 0, presences_1 = presences; _i < presences_1.length; _i++) {
        var presence = presences_1[_i];
        state.presences.push(presence);
        // Securely assign symbols if they don't have one yet
        if (!state.marks[presence.sessionId]) {
            if (Object.keys(state.marks).length === 0) {
                state.marks[presence.sessionId] = "X";
            }
            else {
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
    return { state: state };
};
var matchLeave = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    // 1. Remove the players who left from the state
    state.presences = state.presences.filter(function (p) { return !presences.some(function (left) { return left.sessionId === p.sessionId; }); });
    // If EVERYONE left, shut down the server room
    if (state.presences.length === 0) {
        logger.info("Room empty. Shutting down match.");
        return null;
    }
    // If one player is still here, tell them their opponent disconnected
    dispatcher.broadcastMessage(4, JSON.stringify({
        message: "Opponent disconnected. Waiting for them to rejoin..."
    }));
    return { state: state };
};
function checkWinner(board) {
    var winningCombos = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6] // Diagonals
    ];
    for (var _i = 0, winningCombos_1 = winningCombos; _i < winningCombos_1.length; _i++) {
        var combo = winningCombos_1[_i];
        var a = combo[0], b = combo[1], c = combo[2];
        if (board[a] !== "" && board[a] === board[b] && board[a] === board[c]) {
            return board[a]; // Returns "X" or "O" if someone won
        }
    }
    return null; // No winner yet
}
var matchLoop = function (ctx, logger, nk, dispatcher, tick, state, messages) {
    for (var _i = 0, messages_1 = messages; _i < messages_1.length; _i++) {
        var message = messages_1[_i];
        // --- NEW: HANDLE PLAY AGAIN VOTES (OpCode 5) ---
        if (message.opCode === 5 && !state.active) {
            // Add the player's ID to the vote list if they haven't voted yet
            if (state.playAgainVotes.indexOf(message.sender.sessionId) === -1) {
                state.playAgainVotes.push(message.sender.sessionId);
                logger.info("".concat(message.sender.sessionId, " voted to play again. Votes: ").concat(state.playAgainVotes.length, "/2"));
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
                var data = void 0;
                var dataString = "";
                if (typeof message.data === "string") {
                    dataString = message.data;
                }
                else {
                    dataString = nk.binaryToString(message.data);
                }
                try {
                    data = JSON.parse(dataString);
                }
                catch (e) {
                    var decodedBytes = nk.base64Decode(dataString);
                    var decodedString = nk.binaryToString(decodedBytes);
                    data = JSON.parse(decodedString);
                }
                if (typeof data === "string") {
                    data = JSON.parse(data);
                }
                var index = data.index;
                var playerSymbol = state.marks[message.sender.sessionId];
                if (playerSymbol && state.turn === playerSymbol && index !== undefined && state.board[index] === "") {
                    state.board[index] = playerSymbol;
                    dispatcher.broadcastMessage(2, JSON.stringify({
                        index: index,
                        symbol: playerSymbol,
                        board: state.board
                    }));
                    var winner = checkWinner(state.board);
                    var isDraw = state.board.indexOf("") === -1 && winner === null;
                    if (winner !== null || isDraw) {
                        state.active = false;
                        dispatcher.broadcastMessage(3, JSON.stringify({ winner: winner, isDraw: isDraw }));
                    }
                    else {
                        state.turn = state.turn === "X" ? "O" : "X";
                    }
                }
            }
            catch (error) {
                logger.error("CRASH in matchLoop: ".concat(error.message));
            }
        }
    }
    return { state: state };
};
var matchTerminate = function (ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
    return { state: state };
};
var matchSignal = function (ctx, logger, nk, dispatcher, tick, state, data) {
    return { state: state, data: "signal received" };
};
// This prevents Rollup from deleting InitModule during its tree-shaking optimization
InitModule && InitModule.bind(null);
