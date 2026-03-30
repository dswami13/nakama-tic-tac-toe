/// <reference types="nakama-runtime" />
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
        marks: {} // Initialize empty
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
        // Securely assign symbols based on join order
        if (Object.keys(state.marks).length === 0) {
            state.marks[presence.sessionId] = "X";
        }
        else if (Object.keys(state.marks).length === 1 && !state.marks[presence.sessionId]) {
            state.marks[presence.sessionId] = "O";
        }
    }
    return { state: state };
};
var matchLeave = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    // 1. Remove the players who left from the state
    state.presences = state.presences.filter(function (p) { return !presences.some(function (left) { return left.sessionId === p.sessionId; }); });
    // 2. DISCONNECT LOGIC: If the game is active and we drop below 2 players
    if (state.active && state.presences.length < 2) {
        state.active = false;
        // Broadcast a special "Opponent Disconnected" message (OpCode 4)
        dispatcher.broadcastMessage(4, JSON.stringify({
            reason: "opponent_disconnected",
            message: "Your opponent left the match."
        }));
        logger.info("Match terminated because a player disconnected.");
        // Return null to shut down the server room
        return null;
    }
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
    if (!state.active)
        return { state: state };
    for (var _i = 0, messages_1 = messages; _i < messages_1.length; _i++) {
        var message = messages_1[_i];
        // 1. Log every single message the server receives
        logger.info("Received OpCode ".concat(message.opCode, " from ").concat(message.sender.sessionId));
        // --- NEW PARSING LOGIC STARTS HERE ---
        if (message.opCode === 1) {
            try {
                var data = void 0;
                var dataString = "";
                // 1. Convert whatever we received into a plain string first
                if (typeof message.data === "string") {
                    dataString = message.data;
                }
                else {
                    // message.data is an ArrayBuffer or Uint8Array
                    dataString = nk.binaryToString(message.data);
                }
                // 2. Parse the string into a JSON object
                try {
                    data = JSON.parse(dataString);
                }
                catch (e) {
                    // If standard parsing fails, it might be Base64 encoded text.
                    // nk.base64Decode takes a string and returns an ArrayBuffer, 
                    // so we have to convert those bytes back into a string!
                    var decodedBytes = nk.base64Decode(dataString);
                    var decodedString = nk.binaryToString(decodedBytes);
                    data = JSON.parse(decodedString);
                }
                // 3. Fix Double-Stringification
                // If parsing resulted in a string instead of an object, parse it one more time.
                if (typeof data === "string") {
                    data = JSON.parse(data);
                }
                var index = data.index;
                var playerSymbol = state.marks[message.sender.sessionId];
                logger.info("Decision Matrix -> Player is: ".concat(playerSymbol, ", Server Turn is: ").concat(state.turn, ", Cell ").concat(index, " is: \"").concat(state.board[index], "\""));
                // Check if the move is valid
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
                        return null;
                    }
                    else {
                        state.turn = state.turn === "X" ? "O" : "X";
                    }
                }
                else {
                    logger.warn("REJECTED MOVE: ".concat(message.sender.sessionId, " tried to play out of turn or on a filled square. Index received: ").concat(index));
                }
            }
            catch (error) {
                logger.error("CRASH in matchLoop processing OpCode 1: ".concat(error.message));
            }
        }
        // --- NEW PARSING LOGIC ENDS HERE ---
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
export {};
