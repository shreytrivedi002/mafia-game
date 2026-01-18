"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Action,
  GameState,
  GameSettings,
  Player,
  RelayEvent,
  RelayEventWithIndex,
  Role,
  SecretMessage,
  Vote,
} from "@/lib/types";
import {
  ACTIVE_POLL_INTERVAL_MS,
  MASTER_STALE_MS,
  assignRoles,
  checkWin,
  createInitialState,
  generateId,
  resolveNightActions,
  resolveVotes,
} from "@/lib/game";

const STORAGE_KEYS = {
  gameId: "mafia_game_id",
  playerId: "mafia_player_id",
  playerName: "mafia_player_name",
  playerToken: "mafia_player_token",
  playerRole: "mafia_player_role",
  localState: "mafia_local_state",
  masterRoles: "mafia_master_roles",
};

type ClientInfo = {
  gameId: string;
  playerId: string;
  playerName: string;
  playerToken: string;
};

type MasterCache = {
  eventCursor: number;
  nightActions: Map<number, Action[]>;
  votes: Map<string, Vote[]>;
};

const initialMasterCache: MasterCache = {
  eventCursor: 0,
  nightActions: new Map(),
  votes: new Map(),
};

const MIN_PLAYERS_TO_START = 4;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getPhaseDurationSeconds(phase: GameState["phase"], settings: GameSettings): number | null {
  if (phase === "NIGHT") return settings.nightSeconds;
  if (phase === "DAY") return settings.daySeconds;
  if (phase === "VOTING") return settings.votingSeconds;
  return null;
}

async function relayGetState(gameId: string): Promise<GameState | null> {
  const res = await fetch(`/api/relay/state?gameId=${gameId}`, { cache: "no-store" });
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as { state: GameState };
  return data.state;
}

async function relaySetState(gameId: string, state: GameState): Promise<GameState | null> {
  const res = await fetch("/api/relay/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, state }),
  });
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as { state: GameState };
  return data.state;
}

async function relaySendEvent(gameId: string, event: RelayEvent) {
  await fetch("/api/relay/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, event }),
  });
}

async function relayFetchEvents(gameId: string, after: number) {
  const res = await fetch(`/api/relay/events?gameId=${gameId}&after=${after}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    return [] as RelayEventWithIndex[];
  }
  const data = (await res.json()) as { events: RelayEventWithIndex[] };
  return data.events;
}

async function relaySendSecret(gameId: string, playerId: string, message: SecretMessage) {
  await fetch("/api/relay/inbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, playerId, message }),
  });
}

async function relayPullInbox(gameId: string, playerId: string, token: string) {
  const res = await fetch(
    `/api/relay/inbox?gameId=${gameId}&playerId=${playerId}&token=${token}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    return [] as SecretMessage[];
  }
  const data = (await res.json()) as { messages: SecretMessage[] };
  return data.messages;
}

function storeLocalState(state: GameState) {
  localStorage.setItem(STORAGE_KEYS.localState, JSON.stringify(state));
}

function loadLocalState(): GameState | null {
  const raw = localStorage.getItem(STORAGE_KEYS.localState);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

function saveMasterRoles(roleMap: Record<string, Role>) {
  localStorage.setItem(STORAGE_KEYS.masterRoles, JSON.stringify(roleMap));
}

function loadMasterRoles(): Record<string, Role> {
  const raw = localStorage.getItem(STORAGE_KEYS.masterRoles);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, Role>;
  } catch {
    return {};
  }
}

function withRoles(players: Player[], roleMap: Record<string, Role>): Player[] {
  return players.map((player) => ({ ...player, role: roleMap[player.id] }));
}

function stripRoles(players: Player[]): Player[] {
  return players.map(({ role, ...rest }) => rest);
}

export default function Home() {
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerRole, setPlayerRole] = useState<Role | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [voteTarget, setVoteTarget] = useState("");
  const [inspectionResults, setInspectionResults] = useState<SecretMessage[]>([]);
  const [lastStateAt, setLastStateAt] = useState<number | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<GameSettings | null>(null);

  const masterCacheRef = useRef<MasterCache>(initialMasterCache);
  const autoTakeoverAttemptVersionRef = useRef<number | null>(null);
  const isMaster = gameState && client ? gameState.masterPlayerId === client.playerId : false;

  const alivePlayers = useMemo(() => {
    if (!gameState) {
      return [];
    }
    return gameState.players.filter((player) => player.alive);
  }, [gameState]);

  useEffect(() => {
    const storedGameId = localStorage.getItem(STORAGE_KEYS.gameId);
    const storedPlayerId = localStorage.getItem(STORAGE_KEYS.playerId);
    const storedPlayerName = localStorage.getItem(STORAGE_KEYS.playerName);
    const storedToken = localStorage.getItem(STORAGE_KEYS.playerToken);
    const storedRole = localStorage.getItem(STORAGE_KEYS.playerRole) as Role | null;

    if (storedGameId && storedPlayerId && storedPlayerName && storedToken) {
      setClient({
        gameId: storedGameId,
        playerId: storedPlayerId,
        playerName: storedPlayerName,
        playerToken: storedToken,
      });
      setPlayerRole(storedRole);
      const cached = loadLocalState();
      if (cached?.id === storedGameId) {
        setGameState(cached);
      }
    }
  }, []);

  useEffect(() => {
    if (!client?.gameId) {
      return;
    }

    let isActive = true;
    const poll = async () => {
      const state = await relayGetState(client.gameId);
      if (state && isActive) {
        setGameState(state);
        setLastStateAt(Date.now());
        storeLocalState(state);
      }
    };

    poll();
    const interval = window.setInterval(poll, ACTIVE_POLL_INTERVAL_MS);
    return () => {
      isActive = false;
      window.clearInterval(interval);
    };
  }, [client?.gameId]);

  useEffect(() => {
    if (!client) {
      return;
    }

    let active = true;
    const pollInbox = async () => {
      const messages = await relayPullInbox(
        client.gameId,
        client.playerId,
        client.playerToken,
      );
      if (!active || messages.length === 0) {
        return;
      }
      for (const message of messages) {
        if (message.type === "ROLE_ASSIGNMENT") {
          setPlayerRole(message.payload.role);
          localStorage.setItem(STORAGE_KEYS.playerRole, message.payload.role);
        }
        if (message.type === "GAME_RESET") {
          setPlayerRole(null);
          localStorage.removeItem(STORAGE_KEYS.playerRole);
          setInspectionResults([]);
          setSelectedTarget("");
          setVoteTarget("");
          setStatusMessage("Game restarted. Waiting in lobby.");
        }
        if (message.type === "ACTION_REJECTED") {
          setStatusMessage(message.payload.reason);
        }
        if (message.type === "INSPECTION_RESULT") {
          setInspectionResults((prev) => [...prev, message]);
        }
      }
    };

    pollInbox();
    const interval = window.setInterval(pollInbox, ACTIVE_POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [client]);

  useEffect(() => {
    if (!gameState) {
      return;
    }
    setSettingsDraft((prev) => prev ?? gameState.settings);
  }, [gameState?.id]);

  useEffect(() => {
    if (!client || !gameState || !isMaster) {
      return;
    }

    let active = true;
    const pollEvents = async () => {
      const events = await relayFetchEvents(
        client.gameId,
        masterCacheRef.current.eventCursor,
      );
      if (!active || events.length === 0) {
        return;
      }
      events.forEach((event) => {
        masterCacheRef.current.eventCursor = Math.max(
          masterCacheRef.current.eventCursor,
          event.index,
        );
        handleEvent(event);
      });
    };

    const interval = window.setInterval(pollEvents, ACTIVE_POLL_INTERVAL_MS);
    pollEvents();
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [client, gameState, isMaster]);

  useEffect(() => {
    if (!client || !gameState || isMaster) {
      return;
    }
    const isStale = lastStateAt ? Date.now() - lastStateAt > MASTER_STALE_MS : false;
    if (!isStale) {
      autoTakeoverAttemptVersionRef.current = null;
      return;
    }
    const attemptVersion = gameState.version;
    if (autoTakeoverAttemptVersionRef.current === attemptVersion) {
      return;
    }
    const sortedIds = [...gameState.players].map((p) => p.id).sort();
    const shouldAutoTakeover = sortedIds[0] === client.playerId;
    if (!shouldAutoTakeover) {
      autoTakeoverAttemptVersionRef.current = attemptVersion;
      return;
    }
    autoTakeoverAttemptVersionRef.current = attemptVersion;
    const next = {
      ...gameState,
      masterPlayerId: client.playerId,
      version: gameState.version + 1,
      updatedAt: Date.now(),
    };
    publishState(next);
  }, [client, gameState, isMaster, lastStateAt]);

  useEffect(() => {
    if (!client || !gameState || !isMaster || !gameState.settings.autoAdvance) {
      return;
    }

    const tick = () => {
      const duration = getPhaseDurationSeconds(gameState.phase, gameState.settings);
      if (!duration) {
        return;
      }
      const elapsedSeconds = (Date.now() - gameState.phaseStartedAt) / 1000;
      const remaining = duration - elapsedSeconds;
      if (remaining > 0) {
        return;
      }

      if (gameState.phase === "NIGHT") {
        attemptNightResolution(true);
      } else if (gameState.phase === "DAY") {
        handleStartVoting();
      } else if (gameState.phase === "VOTING") {
        attemptVoteResolution(true);
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, gameState, isMaster]);

  const handleEvent = (event: RelayEvent) => {
    if (!gameState || !client) {
      return;
    }

    if (event.type === "JOIN") {
      if (gameState.players.some((player) => player.id === event.payload.playerId)) {
        return;
      }
      const newPlayer: Player = {
        id: event.payload.playerId,
        name: event.payload.name,
        alive: true,
        joinedAt: event.createdAt,
        lastSeenAt: event.createdAt,
      };
      const next = {
        ...gameState,
        phase: "LOBBY",
        players: [...gameState.players, newPlayer],
        version: gameState.version + 1,
      };
      publishState(next);
      return;
    }

    if (event.type === "ACTION") {
      const action = event.payload;
      if (gameState.phase !== "NIGHT") {
        return;
      }
      if (!action.targetPlayerId) {
        return;
      }
      const roleMap = loadMasterRoles();
      const actorRole = roleMap[action.playerId];
      const targetRole = roleMap[action.targetPlayerId];
      if (action.type === "KILL" && actorRole === "MAFIA" && targetRole === "MAFIA") {
        void relaySendSecret(gameState.id, action.playerId, {
          type: "ACTION_REJECTED",
          createdAt: Date.now(),
          payload: { reason: "Invalid action: Mafia cannot kill another Mafia." },
        });
        return;
      }
      const actions = masterCacheRef.current.nightActions.get(action.nightNumber) ?? [];
      const already = actions.some((existing) => existing.playerId === action.playerId);
      if (!already) {
        masterCacheRef.current.nightActions.set(action.nightNumber, [...actions, action]);
      }
      attemptNightResolution(false);
      return;
    }

    if (event.type === "VOTE") {
      const vote = event.payload;
      if (gameState.phase !== "VOTING" || !gameState.phaseId) {
        return;
      }
      const votes = masterCacheRef.current.votes.get(vote.phaseId) ?? [];
      const already = votes.some((existing) => existing.voterId === vote.voterId);
      if (!already) {
        masterCacheRef.current.votes.set(vote.phaseId, [...votes, vote]);
      }
      attemptVoteResolution(false);
    }
  };

  const publishState = async (next: GameState) => {
    const sanitizedPlayers = stripRoles(next.players);
    const prepared = { ...next, players: sanitizedPlayers };
    const updated = await relaySetState(next.id, prepared);
    if (updated) {
      setGameState(updated);
      storeLocalState(updated);
    }
  };

  const attemptNightResolution = async (force: boolean) => {
    if (!gameState || !client) {
      return;
    }
    const roleMap = loadMasterRoles();
    const playersWithRoles = withRoles(gameState.players, roleMap);
    const requiredRoles = new Set(
      playersWithRoles
        .filter((player) => player.alive && player.role)
        .map((player) => player.role as Role),
    );

    const actions = masterCacheRef.current.nightActions.get(gameState.currentNight) ?? [];
    const hasMafia = requiredRoles.has("MAFIA");
    const hasDoctor = requiredRoles.has("DOCTOR");
    const hasDetective = requiredRoles.has("DETECTIVE");

    const actionTypes = new Set(actions.map((action) => action.type));
    if (!force && hasMafia && !actionTypes.has("KILL")) {
      return;
    }
    if (!force && hasDoctor && !actionTypes.has("SAVE")) {
      return;
    }
    if (!force && hasDetective && !actionTypes.has("INSPECT")) {
      return;
    }

    const result = resolveNightActions(
      { ...gameState, players: playersWithRoles },
      actions,
    );

    for (const inspection of result.inspectionResults) {
      await relaySendSecret(gameState.id, inspection.detectiveId, {
        type: "INSPECTION_RESULT",
        createdAt: Date.now(),
        payload: {
          nightNumber: gameState.currentNight,
          targetPlayerId: inspection.targetPlayerId,
          targetRole: inspection.targetRole,
        },
      });
    }

    masterCacheRef.current.nightActions.delete(gameState.currentNight);
    const next = {
      ...gameState,
      players: result.updatedPlayers,
      phase: "DAY",
      phaseStartedAt: Date.now(),
      lastResolution: {
        killedPlayerId: result.killedPlayerId,
        savedPlayerId: result.savedPlayerId,
      },
      version: gameState.version + 1,
    };
    publishState(next);
  };

  const attemptVoteResolution = (force: boolean) => {
    if (!gameState || !gameState.phaseId) {
      return;
    }
    const votes = masterCacheRef.current.votes.get(gameState.phaseId) ?? [];
    if (!force && votes.length < alivePlayers.length) {
      return;
    }
    const roleMap = loadMasterRoles();
    const playersWithRoles = withRoles(gameState.players, roleMap);
    const result = resolveVotes({ ...gameState, players: playersWithRoles }, votes);
    const winner = checkWin(result.updatedPlayers);
    const next = {
      ...gameState,
      players: result.updatedPlayers,
      phase: winner ? "GAME_OVER" : "RESOLUTION",
      status: winner ? "COMPLETED" : gameState.status,
      winner: winner ?? gameState.winner,
      phaseStartedAt: Date.now(),
      lastVoteResult: {
        eliminatedPlayerId: result.eliminatedPlayerId,
        tie: result.tie,
      },
      version: gameState.version + 1,
    };
    masterCacheRef.current.votes.delete(gameState.phaseId);
    publishState(next);
  };

  const handleCreateGame = async () => {
    if (!nickname.trim()) {
      setStatusMessage("Enter a nickname to create a game.");
      return;
    }
    masterCacheRef.current = {
      eventCursor: 0,
      nightActions: new Map(),
      votes: new Map(),
    };
    const gameId = generateId(6);
    const playerId = generateId(8);
    const playerToken = generateId(12);
    const player: Player = {
      id: playerId,
      name: nickname.trim(),
      alive: true,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
    };

    const state = createInitialState(gameId, playerId, [player]);
    localStorage.setItem(STORAGE_KEYS.gameId, gameId);
    localStorage.setItem(STORAGE_KEYS.playerId, playerId);
    localStorage.setItem(STORAGE_KEYS.playerName, player.name);
    localStorage.setItem(STORAGE_KEYS.playerToken, playerToken);
    setClient({ gameId, playerId, playerName: player.name, playerToken });
    setGameState(state);
    setSettingsDraft(state.settings);
    storeLocalState(state);
    await relaySendEvent(gameId, {
      type: "JOIN",
      id: generateId(12),
      createdAt: Date.now(),
      payload: { playerId, name: player.name, token: playerToken },
    });
    await publishState(state);
  };

  const handleJoinGame = async () => {
    if (!nickname.trim() || !joinCode.trim()) {
      setStatusMessage("Enter a nickname and game code.");
      return;
    }
    masterCacheRef.current = {
      eventCursor: 0,
      nightActions: new Map(),
      votes: new Map(),
    };
    const gameId = joinCode.trim().toUpperCase();
    const playerId = generateId(8);
    const playerToken = generateId(12);
    localStorage.setItem(STORAGE_KEYS.gameId, gameId);
    localStorage.setItem(STORAGE_KEYS.playerId, playerId);
    localStorage.setItem(STORAGE_KEYS.playerName, nickname.trim());
    localStorage.setItem(STORAGE_KEYS.playerToken, playerToken);
    setClient({ gameId, playerId, playerName: nickname.trim(), playerToken });
    setSettingsDraft(null);
    await relaySendEvent(gameId, {
      type: "JOIN",
      id: generateId(12),
      createdAt: Date.now(),
      payload: { playerId, name: nickname.trim(), token: playerToken },
    });
    setStatusMessage("Joined. Waiting for the master device to add you.");
  };

  const handleStartGame = async () => {
    if (!gameState || !client) {
      return;
    }
    if (gameState.players.length < MIN_PLAYERS_TO_START) {
      setStatusMessage(`At least ${MIN_PLAYERS_TO_START} players are required to start.`);
      return;
    }
    const assigned = assignRoles(gameState.players);
    const roleMap = assigned.reduce<Record<string, Role>>((acc, player) => {
      if (player.role) {
        acc[player.id] = player.role;
      }
      return acc;
    }, {});
    saveMasterRoles(roleMap);

    for (const player of assigned) {
      if (!player.role) {
        continue;
      }
      await relaySendSecret(gameState.id, player.id, {
        type: "ROLE_ASSIGNMENT",
        createdAt: Date.now(),
        payload: { role: player.role },
      });
      if (player.id === client.playerId) {
        setPlayerRole(player.role);
        localStorage.setItem(STORAGE_KEYS.playerRole, player.role);
      }
    }

    masterCacheRef.current.nightActions.clear();
    masterCacheRef.current.votes.clear();
    const next: GameState = {
      ...gameState,
      phase: "NIGHT",
      currentNight: 1,
      phaseId: undefined,
      phaseStartedAt: Date.now(),
      lastResolution: undefined,
      lastVoteResult: undefined,
      winner: undefined,
      version: gameState.version + 1,
    };
    publishState(next);
  };

  const handleStartVoting = () => {
    if (!gameState) {
      return;
    }
    if (!isMaster) {
      return;
    }
    const phaseId = `VOTE-${gameState.currentNight}-${Date.now()}`;
    masterCacheRef.current.votes.clear();
    const next = {
      ...gameState,
      phase: "VOTING",
      phaseId,
      phaseStartedAt: Date.now(),
      version: gameState.version + 1,
    };
    publishState(next);
  };

  const handleStartNight = () => {
    if (!gameState) {
      return;
    }
    if (!isMaster) {
      return;
    }
    masterCacheRef.current.nightActions.clear();
    masterCacheRef.current.votes.clear();
    const next = {
      ...gameState,
      phase: "NIGHT",
      currentNight: gameState.currentNight + 1,
      phaseId: undefined,
      phaseStartedAt: Date.now(),
      lastResolution: undefined,
      lastVoteResult: undefined,
      winner: undefined,
      version: gameState.version + 1,
    };
    publishState(next);
  };

  const handleRestartWithSamePlayers = async () => {
    if (!client || !gameState || !isMaster) {
      return;
    }

    masterCacheRef.current.nightActions.clear();
    masterCacheRef.current.votes.clear();
    localStorage.removeItem(STORAGE_KEYS.masterRoles);

    await Promise.all(
      gameState.players.map((player) =>
        relaySendSecret(gameState.id, player.id, {
          type: "GAME_RESET",
          createdAt: Date.now(),
          payload: {},
        }),
      ),
    );

    const resetPlayers = gameState.players.map((player) => ({
      ...player,
      alive: true,
    }));

    const next: GameState = {
      ...gameState,
      status: "ACTIVE",
      phase: "LOBBY",
      currentNight: 0,
      phaseId: undefined,
      phaseStartedAt: Date.now(),
      lastResolution: undefined,
      lastVoteResult: undefined,
      winner: undefined,
      players: resetPlayers,
      version: gameState.version + 1,
    };

    publishState(next);
  };

  const handleSaveSettings = () => {
    if (!gameState || !settingsDraft || !isMaster) {
      return;
    }
    const next: GameState = {
      ...gameState,
      settings: {
        nightSeconds: clampNumber(settingsDraft.nightSeconds, 10, 60 * 30),
        daySeconds: clampNumber(settingsDraft.daySeconds, 10, 60 * 60),
        votingSeconds: clampNumber(settingsDraft.votingSeconds, 10, 60 * 30),
        autoAdvance: settingsDraft.autoAdvance,
      },
      version: gameState.version + 1,
    };
    publishState(next);
    setStatusMessage("Settings updated.");
  };

  const handleSubmitAction = async () => {
    if (!client || !gameState || !selectedTarget || !playerRole) {
      return;
    }
    const actionType =
      playerRole === "MAFIA"
        ? "KILL"
        : playerRole === "DOCTOR"
          ? "SAVE"
          : "INSPECT";

    const action: Action = {
      gameId: gameState.id,
      nightNumber: gameState.currentNight,
      playerId: client.playerId,
      type: actionType,
      targetPlayerId: selectedTarget,
      createdAt: Date.now(),
    };
    await relaySendEvent(gameState.id, {
      type: "ACTION",
      id: generateId(12),
      createdAt: Date.now(),
      payload: action,
    });
    setSelectedTarget("");
  };

  const handleSubmitVote = async () => {
    if (!client || !gameState || !gameState.phaseId || !voteTarget) {
      return;
    }
    const vote: Vote = {
      gameId: gameState.id,
      phaseId: gameState.phaseId,
      voterId: client.playerId,
      targetPlayerId: voteTarget,
      createdAt: Date.now(),
    };
    await relaySendEvent(gameState.id, {
      type: "VOTE",
      id: generateId(12),
      createdAt: Date.now(),
      payload: vote,
    });
    setVoteTarget("");
  };

  const handleTakeOver = () => {
    if (!client || !gameState) {
      return;
    }
    const next = {
      ...gameState,
      masterPlayerId: client.playerId,
      version: gameState.version + 1,
    };
    publishState(next);
  };

  const resetLocal = () => {
    Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
    setClient(null);
    setGameState(null);
    setPlayerRole(null);
    setStatusMessage(null);
    setSettingsDraft(null);
    masterCacheRef.current = {
      eventCursor: 0,
      nightActions: new Map(),
      votes: new Map(),
    };
  };

  if (!client) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-950 via-slate-950 to-black px-6 py-10 text-white">
        <div className="mx-auto w-full max-w-xl space-y-6 rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">Offline Mafia</h1>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/90 ring-1 ring-white/15">
              Hostless
            </span>
          </div>
          <p className="text-sm text-white/80">
            Play in-person. The app runs the rules. No moderator needed.
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/90">Nickname</label>
            <input
              className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-violet-400/70"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              className="flex-1 rounded-xl bg-violet-500 px-4 py-2 font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400"
              onClick={handleCreateGame}
            >
              Create Game
            </button>
            <div className="flex flex-1 gap-2">
              <input
                className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-violet-400/70"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="Game code"
              />
              <button
                className="rounded-xl bg-white/10 px-4 py-2 font-medium text-white ring-1 ring-white/15 transition hover:bg-white/15"
                onClick={handleJoinGame}
              >
                Join
              </button>
            </div>
          </div>
          {statusMessage && <p className="text-sm text-white/80">{statusMessage}</p>}
          <p className="text-xs text-white/50">
            Tip: Install to Home Screen for a full-screen game feel (PWA).
          </p>
        </div>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-950 via-slate-950 to-black px-6 py-10 text-white">
        <div className="mx-auto w-full max-w-xl space-y-4 rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
          <h1 className="text-xl font-semibold">Joining game {client.gameId}</h1>
          <p className="text-sm text-white/80">Waiting for the master device...</p>
          <button className="text-sm underline text-white/80" onClick={resetLocal}>
            Leave game
          </button>
        </div>
      </div>
    );
  }

  const duration = getPhaseDurationSeconds(gameState.phase, gameState.settings);
  const remainingSeconds =
    duration === null ? null : duration - (Date.now() - gameState.phaseStartedAt) / 1000;
  const isStale = lastStateAt ? Date.now() - lastStateAt > MASTER_STALE_MS : false;

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-950 via-slate-950 to-black px-6 py-10 text-white">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-white/60">Game Code</p>
              <p className="text-2xl font-semibold">{gameState.id}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-white/60">Player</p>
              <p className="font-semibold">{client.playerName}</p>
              {playerRole && (
                <p className="text-xs uppercase tracking-wide text-white/70">
                  Role: {playerRole}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10">
            <div>
              <p className="text-xs uppercase tracking-wide text-white/60">Phase</p>
              <p className="text-lg font-semibold">{gameState.phase.replace("_", " ")}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-white/60">Time Left</p>
              <p className="text-lg font-semibold">
                {remainingSeconds === null ? "—" : formatSeconds(remainingSeconds)}
              </p>
            </div>
          </div>
        </header>

        <section className="rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Phase: {gameState.phase.replace("_", " ")}
            </h2>
            {isMaster && (
              <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-300/20">
                Master device
              </span>
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {gameState.players.map((player) => (
              <div
                key={player.id}
                className={`rounded-2xl border px-4 py-3 ${
                  player.alive
                    ? "border-white/10 bg-white/5"
                    : "border-red-400/30 bg-red-500/10"
                }`}
              >
                <p className="font-medium">{player.name}</p>
                <p className={`text-xs ${player.alive ? "text-white/60" : "text-red-200"}`}>
                  {player.alive ? "Alive" : "Eliminated"}
                </p>
              </div>
            ))}
          </div>
        </section>

        {gameState.phase === "LOBBY" && (
          <section className="rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <h2 className="text-lg font-semibold">Lobby</h2>
            <p className="mt-2 text-sm text-white/80">
              Share the game code to let others join. When ready, the master device
              starts the game.
            </p>
            <p className="mt-2 text-sm text-white/80">
              Minimum players to start: {MIN_PLAYERS_TO_START}.
            </p>
            {isMaster && settingsDraft && (
              <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-semibold">Game settings</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-sm">
                    <span className="text-white/70">Night (sec)</span>
                    <input
                      className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-violet-400/70"
                      type="number"
                      min={10}
                      max={1800}
                      value={settingsDraft.nightSeconds}
                      onChange={(e) =>
                        setSettingsDraft((prev) =>
                          prev
                            ? { ...prev, nightSeconds: Number(e.target.value) }
                            : prev,
                        )
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-white/70">Day (sec)</span>
                    <input
                      className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-violet-400/70"
                      type="number"
                      min={10}
                      max={3600}
                      value={settingsDraft.daySeconds}
                      onChange={(e) =>
                        setSettingsDraft((prev) =>
                          prev ? { ...prev, daySeconds: Number(e.target.value) } : prev,
                        )
                      }
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-white/70">Voting (sec)</span>
                    <input
                      className="mt-1 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-violet-400/70"
                      type="number"
                      min={10}
                      max={1800}
                      value={settingsDraft.votingSeconds}
                      onChange={(e) =>
                        setSettingsDraft((prev) =>
                          prev
                            ? { ...prev, votingSeconds: Number(e.target.value) }
                            : prev,
                        )
                      }
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input
                    type="checkbox"
                    checked={settingsDraft.autoAdvance}
                    onChange={(e) =>
                      setSettingsDraft((prev) =>
                        prev ? { ...prev, autoAdvance: e.target.checked } : prev,
                      )
                    }
                  />
                  Auto-advance phases when timer expires
                </label>
                <button
                  className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15"
                  onClick={handleSaveSettings}
                >
                  Save settings
                </button>
              </div>
            )}
            {isMaster && (
              <button
                className="mt-4 rounded-xl bg-violet-500 px-4 py-2 font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleStartGame}
                disabled={gameState.players.length < MIN_PLAYERS_TO_START}
              >
                Start Game
              </button>
            )}
          </section>
        )}

        {gameState.phase === "NIGHT" && (
          <section className="rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <h2 className="text-lg font-semibold">Night {gameState.currentNight}</h2>
            <p className="mt-2 text-sm text-white/80">
              If you have an action, select a target and submit.
            </p>
            {playerRole && playerRole !== "VILLAGER" && (
              <div className="mt-4 space-y-3">
                <select
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-white outline-none focus:ring-2 focus:ring-violet-400/70"
                  value={selectedTarget}
                  onChange={(event) => setSelectedTarget(event.target.value)}
                >
                  <option value="">Select target</option>
                  {alivePlayers.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
                <button
                  className="rounded-xl bg-white/10 px-4 py-2 font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleSubmitAction}
                  disabled={!selectedTarget}
                >
                  Submit{" "}
                  {playerRole === "MAFIA"
                    ? "kill"
                    : playerRole === "DOCTOR"
                      ? "save"
                      : "inspect"}
                </button>
              </div>
            )}
          </section>
        )}

        {gameState.phase === "DAY" && (
          <section className="rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <h2 className="text-lg font-semibold">Day discussion</h2>
            <p className="mt-2 text-sm text-white/80">
              Discuss offline. When ready, the master device starts voting.
            </p>
            {gameState.lastResolution?.killedPlayerId ? (
              <p className="mt-3 text-sm text-white/90">
                Eliminated overnight:{" "}
                {
                  gameState.players.find(
                    (player) => player.id === gameState.lastResolution?.killedPlayerId,
                  )?.name
                }
              </p>
            ) : (
              <p className="mt-3 text-sm text-white/90">No one was eliminated.</p>
            )}
            {isMaster && (
              <button
                className="mt-4 rounded-xl bg-amber-400 px-4 py-2 font-semibold text-black shadow-lg shadow-amber-400/20 transition hover:bg-amber-300"
                onClick={handleStartVoting}
              >
                Start Voting
              </button>
            )}
          </section>
        )}

        {gameState.phase === "VOTING" && (
          <section className="rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <h2 className="text-lg font-semibold">Voting</h2>
            <p className="mt-2 text-sm text-white/80">
              Vote for a player to eliminate. Votes are secret.
            </p>
            <div className="mt-4 space-y-3">
              <select
                className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-white outline-none focus:ring-2 focus:ring-amber-300/70"
                value={voteTarget}
                onChange={(event) => setVoteTarget(event.target.value)}
              >
                <option value="">Select player</option>
                {alivePlayers.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
              </select>
              <button
                className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-black shadow-lg shadow-amber-400/20 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleSubmitVote}
                disabled={!voteTarget}
              >
                Submit Vote
              </button>
            </div>
          </section>
        )}

        {gameState.phase === "RESOLUTION" && (
          <section className="rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <h2 className="text-lg font-semibold">Resolution</h2>
            {gameState.lastVoteResult?.tie ? (
              <p className="mt-2 text-sm text-white/80">
                Voting resulted in a tie. No one is eliminated.
              </p>
            ) : (
              <p className="mt-2 text-sm text-white/80">
                Eliminated:{" "}
                {
                  gameState.players.find(
                    (player) =>
                      player.id === gameState.lastVoteResult?.eliminatedPlayerId,
                  )?.name
                }
              </p>
            )}
            {isMaster && (
              <button
                className="mt-4 rounded-xl bg-violet-500 px-4 py-2 font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400"
                onClick={handleStartNight}
              >
                Start Next Night
              </button>
            )}
          </section>
        )}

        {gameState.phase === "GAME_OVER" && (
          <section className="rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <h2 className="text-lg font-semibold">Game Over</h2>
            <p className="mt-2 text-sm text-white/80">
              The game has ended. Start a new game to play again.
            </p>
            {gameState.winner && (
              <p className="mt-2 text-sm text-white/90">
                Winner: {gameState.winner === "MAFIA" ? "Mafia" : "Villagers"}
              </p>
            )}
            {isMaster && (
              <button
                className="mt-4 w-full rounded-xl bg-violet-500 px-4 py-2 font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400 sm:w-auto"
                onClick={handleRestartWithSamePlayers}
              >
                Restart with same players
              </button>
            )}
            <button className="mt-4 text-sm underline text-white/80" onClick={resetLocal}>
              Leave game
            </button>
          </section>
        )}

        {inspectionResults.length > 0 && (
          <section className="rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <h2 className="text-lg font-semibold">Detective Notes</h2>
            <div className="mt-3 space-y-2 text-sm text-white/80">
              {inspectionResults.map((result, index) => {
                if (result.type !== "INSPECTION_RESULT") {
                  return null;
                }
                const target = gameState.players.find(
                  (player) => player.id === result.payload.targetPlayerId,
                );
                return (
                  <p key={`${result.payload.targetPlayerId}-${index}`}>
                    Night {result.payload.nightNumber}: {target?.name ?? "Unknown"} is{" "}
                    {result.payload.targetRole}.
                  </p>
                );
              })}
            </div>
          </section>
        )}

        {isStale && !isMaster && (
          <section className="rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            <h2 className="text-lg font-semibold">Master device inactive</h2>
            <p className="mt-2 text-sm text-white/80">
              No updates received recently. You can take over to keep the game running.
            </p>
            <button
              className="mt-4 rounded-xl bg-white/10 px-4 py-2 font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15"
              onClick={handleTakeOver}
            >
              Become Master
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
