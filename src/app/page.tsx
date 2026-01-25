"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
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
  nightRituals: Map<number, Map<string, { promptId: string; choice: string }>>;
  votes: Map<string, Vote[]>;
};

const initialMasterCache: MasterCache = {
  eventCursor: 0,
  nightActions: new Map(),
  nightRituals: new Map(),
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

function getPhaseDurationSeconds(phase: GameState["phase"], settings: GameSettings | undefined): number | null {
  if (!settings) return null;
  if (phase === "NIGHT") return settings.nightSeconds;
  if (phase === "DAY") return settings.daySeconds;
  if (phase === "VOTING") return settings.votingSeconds;
  return null;
}

type PhaseScene = {
  title: string;
  subtitle: string;
  accent: "violet" | "cyan" | "amber" | "emerald" | "rose";
  bgClass: string;
  icon: React.ReactNode;
};

function phaseToScene(phase: GameState["phase"], nightNumber: number): PhaseScene {
  const baseIconClass = "h-10 w-10";

  const moonIcon = (
    <svg
      className={baseIconClass}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M21 14.6A8.6 8.6 0 1 1 9.4 3a7.2 7.2 0 0 0 11.6 11.6Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M15.5 7.2l.4 1.3 1.3.4-1.3.4-.4 1.3-.4-1.3-1.3-.4 1.3-.4.4-1.3Z"
        fill="currentColor"
        opacity="0.7"
      />
    </svg>
  );

  const sunIcon = (
    <svg className={baseIconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );

  const voteIcon = (
    <svg className={baseIconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 11h10M7 15h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7.5 3h9A2.5 2.5 0 0 1 19 5.5v13A2.5 2.5 0 0 1 16.5 21h-9A2.5 2.5 0 0 1 5 18.5v-13A2.5 2.5 0 0 1 7.5 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M9 8l1.6 1.6L14.5 5.7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  const resolveIcon = (
    <svg className={baseIconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6 7h12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7.5 7 5 12.5a3 3 0 0 0 6 0L8.5 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M16.5 7 14 12.5a3 3 0 0 0 6 0L17.5 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );

  const gameOverIcon = (
    <svg className={baseIconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 21h8M12 17v4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7 3h10v4a5 5 0 0 1-10 0V3Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );

  if (phase === "LOBBY") {
    return {
      title: "Lobby",
      subtitle: "Gather players. Master configures timers and starts the game.",
      accent: "violet",
      bgClass: "bg-gradient-to-b from-violet-950 via-slate-950 to-black",
      icon: moonIcon,
    };
  }

  if (phase === "NIGHT") {
    return {
      title: `Night ${nightNumber}`,
      subtitle: "Eyes closed. Roles act in secret.",
      accent: "cyan",
      bgClass: "bg-gradient-to-b from-slate-950 via-slate-950 to-black",
      icon: moonIcon,
    };
  }

  if (phase === "DAY") {
    return {
      title: "Day",
      subtitle: "Discuss face-to-face. Decide who seems suspicious.",
      accent: "amber",
      bgClass: "bg-gradient-to-b from-amber-950/60 via-slate-950 to-black",
      icon: sunIcon,
    };
  }

  if (phase === "VOTING") {
    return {
      title: "Voting",
      subtitle: "Vote in secret. Majority wins. Ties eliminate no one.",
      accent: "amber",
      bgClass: "bg-gradient-to-b from-amber-950/70 via-slate-950 to-black",
      icon: voteIcon,
    };
  }

  if (phase === "RESOLUTION") {
    return {
      title: "Resolution",
      subtitle: "The town learns what happened.",
      accent: "emerald",
      bgClass: "bg-gradient-to-b from-emerald-950/55 via-slate-950 to-black",
      icon: resolveIcon,
    };
  }

  return {
    title: "Game Over",
    subtitle: "A winner has been decided.",
    accent: "rose",
    bgClass: "bg-gradient-to-b from-rose-950/60 via-slate-950 to-black",
    icon: gameOverIcon,
  };
}

const NIGHT_RITUALS: Array<{
  id: string;
  prompt: string;
  choices: string[];
}> = [
  {
    id: "FINGERPRINT",
    prompt: "Night ritual: pick a totally useless fingerprint.",
    choices: ["Left thumb", "Right thumb", "Pinky", "No comment"],
  },
  {
    id: "VIBE_CHECK",
    prompt: "Night ritual: choose your vibe (does not affect the game).",
    choices: ["Innocent", "Sneaky", "Confused", "Chaos"],
  },
  {
    id: "MOON_OATH",
    prompt: "Night ritual: swear an oath to the moon.",
    choices: ["I swear", "I double swear", "I pinky swear", "I refuse (still ok)"],
  },
];

function pickRitual(nightNumber: number, playerId: string) {
  const raw = `${nightNumber}:${playerId}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return NIGHT_RITUALS[hash % NIGHT_RITUALS.length];
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
  const [infoCardFlipped, setInfoCardFlipped] = useState(false);
  const [playersDrawerOpen, setPlayersDrawerOpen] = useState(false);
  const [ritualChoice, setRitualChoice] = useState<string>("");
  const [ritualSubmittedNight, setRitualSubmittedNight] = useState<number | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);

  const masterCacheRef = useRef<MasterCache>(initialMasterCache);
  const installPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  };
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
    // Deep link support: /?join=ABC123 should prefill the join code.
    const params = new URLSearchParams(window.location.search);
    const join = params.get("join") || params.get("gameId");
    if (join) {
      setJoinCode(join.toUpperCase());
      setShowQRScanner(true);
    }
  }, []);

  useEffect(() => {
    // Check if already installed
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    if (isStandalone) {
      setShowInstallPrompt(false);
      return;
    }

    // Listen for beforeinstallprompt (Android/Chrome)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      installPromptRef.current = e as BeforeInstallPromptEvent;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Show prompt immediately when beforeinstallprompt fires
      setShowInstallPrompt(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // Always show prompt after a short delay (for iOS or if beforeinstallprompt doesn't fire)
    const timeout = setTimeout(() => {
      setShowInstallPrompt(true);
    }, 1500);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
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
    if (!statusMessage) {
      return;
    }
    const timeout = window.setTimeout(() => setStatusMessage(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  useEffect(() => {
    if (!gameState) {
      return;
    }
    setSettingsDraft((prev) => prev ?? gameState.settings);
  }, [gameState?.id]);

  useEffect(() => {
    setInfoCardFlipped(false);
    setPlayersDrawerOpen(false);
    setRitualChoice("");
    setRitualSubmittedNight(null);
  }, [gameState?.phase]);

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
    if (!client || !gameState || !isMaster || !gameState.settings?.autoAdvance) {
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
        // Night should not auto-resolve just because the timer hit zero.
        // It resolves when all required actions are submitted AND all non-action players confirm ritual.
        attemptNightResolution(false);
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
      const next: GameState = {
        ...gameState,
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

    if (event.type === "RITUAL") {
      const ritual = event.payload;
      if (gameState.phase !== "NIGHT" || ritual.nightNumber !== gameState.currentNight) {
        return;
      }
      const rituals =
        masterCacheRef.current.nightRituals.get(ritual.nightNumber) ?? new Map();
      if (!rituals.has(ritual.playerId)) {
        rituals.set(ritual.playerId, { promptId: ritual.promptId, choice: ritual.choice });
        masterCacheRef.current.nightRituals.set(ritual.nightNumber, rituals);
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
    const aliveWithRole = playersWithRoles.filter((player) => player.alive && player.role);
    const requiredRoles = new Set(aliveWithRole.map((player) => player.role as Role));
    const aliveActionPlayers = aliveWithRole.filter((player) =>
      player.role === "MAFIA" || player.role === "DOCTOR" || player.role === "DETECTIVE",
    );
    const aliveRitualPlayers = playersWithRoles.filter(
      (player) => player.alive && (!player.role || player.role === "VILLAGER"),
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

    if (!force) {
      const rituals =
        masterCacheRef.current.nightRituals.get(gameState.currentNight) ?? new Map();
      const allRitualConfirmed = aliveRitualPlayers.every((player) => rituals.has(player.id));
      if (!allRitualConfirmed) {
        return;
      }

      const allActionSubmitted = aliveActionPlayers.every((player) =>
        actions.some((action) => action.playerId === player.id),
      );
      if (!allActionSubmitted) {
        return;
      }
    }

    const result = resolveNightActions(
      { ...gameState, players: playersWithRoles },
      actions,
    );
    const killedRole =
      gameState.settings?.revealRoleOnDeath && result.killedPlayerId
        ? roleMap[result.killedPlayerId]
        : undefined;

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
    masterCacheRef.current.nightRituals.delete(gameState.currentNight);
    const next: GameState = {
      ...gameState,
      players: result.updatedPlayers,
      phase: "DAY",
      phaseStartedAt: Date.now(),
      lastResolution: {
        killedPlayerId: result.killedPlayerId,
        savedPlayerId: result.savedPlayerId,
        killedRole,
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
    const revealedRoles = winner ? roleMap : undefined;
    const eliminatedRole =
      gameState.settings?.revealRoleOnDeath && result.eliminatedPlayerId
        ? roleMap[result.eliminatedPlayerId]
        : undefined;
    const next: GameState = {
      ...gameState,
      players: result.updatedPlayers,
      phase: winner ? "GAME_OVER" : "RESOLUTION",
      status: winner ? "COMPLETED" : gameState.status,
      winner: winner ?? gameState.winner,
      revealedRoles: revealedRoles ?? gameState.revealedRoles,
      phaseStartedAt: Date.now(),
      lastVoteResult: {
        eliminatedPlayerId: result.eliminatedPlayerId,
        tie: result.tie,
        eliminatedRole,
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
      nightRituals: new Map(),
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
      nightRituals: new Map(),
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
    masterCacheRef.current.nightRituals.clear();
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
    const next: GameState = {
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
    masterCacheRef.current.nightRituals.clear();
    masterCacheRef.current.votes.clear();
    const next: GameState = {
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
    masterCacheRef.current.nightRituals.clear();
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
      revealedRoles: undefined,
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
        revealRoleOnDeath: settingsDraft.revealRoleOnDeath,
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

  const handleSubmitRitual = async () => {
    if (!client || !gameState) {
      return;
    }
    if (gameState.phase !== "NIGHT") {
      return;
    }
    if (!ritualChoice) {
      setStatusMessage("Pick an option to complete your night ritual.");
      return;
    }
    const ritual = pickRitual(gameState.currentNight, client.playerId);
    await relaySendEvent(gameState.id, {
      type: "RITUAL",
      id: generateId(12),
      createdAt: Date.now(),
      payload: {
        gameId: gameState.id,
        nightNumber: gameState.currentNight,
        playerId: client.playerId,
        promptId: ritual.id,
        choice: ritualChoice,
      },
    });
    setRitualSubmittedNight(gameState.currentNight);
    setStatusMessage("Ritual complete. Waiting for others…");
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

  const handleInstallPWA = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setShowInstallPrompt(false);
        setDeferredPrompt(null);
        installPromptRef.current = null;
      }
    } else {
      // iOS - just show instructions, user needs to manually install
      setShowInstallPrompt(false);
    }
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
      nightRituals: new Map(),
      votes: new Map(),
    };
  };

  if (!client) {
  return (
      <div className="min-h-screen bg-gradient-to-br from-violet-950 via-slate-950 to-black px-6 py-10 text-white">
        {showInstallPrompt && (
          <div className="mx-auto mb-4 w-full max-w-xl rounded-2xl bg-violet-500/90 p-4 shadow-2xl ring-1 ring-violet-400/50 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="font-semibold text-white">Install App</p>
                <p className="mt-1 text-sm text-white/90">
                  {isIOS
                    ? "Tap Share → Add to Home Screen for the best experience"
                    : "Install for full-screen gameplay and faster access"}
                </p>
              </div>
              <div className="flex gap-2">
                {!isIOS && deferredPrompt && (
                  <button
                    onClick={handleInstallPWA}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-violet-600 transition hover:bg-white/90"
                  >
                    Install
                  </button>
                )}
                <button
                  onClick={() => setShowInstallPrompt(false)}
                  className="rounded-xl bg-white/20 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/30"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}
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
                type="button"
                className="rounded-xl bg-white/10 px-3 py-2 font-medium text-white ring-1 ring-white/15 transition hover:bg-white/15"
                onClick={() => setShowQRScanner(true)}
                title="Scan QR code"
              >
                📷
              </button>
              <button
                className="rounded-xl bg-white/10 px-4 py-2 font-medium text-white ring-1 ring-white/15 transition hover:bg-white/15"
                onClick={handleJoinGame}
              >
                Join
              </button>
            </div>
            {showQRScanner && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                <div className="w-full max-w-md rounded-2xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-lg font-semibold text-white">Scan QR Code</p>
                    <button
                      type="button"
                      onClick={() => setShowQRScanner(false)}
                      className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="space-y-3">
                    <p className="text-sm text-white/80">
                      Use your device camera to scan the game code QR code, or enter it manually
                      below.
                    </p>
                    <input
                      type="text"
                      className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-violet-400/70"
                      value={joinCode}
                      onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                      placeholder="Or type game code here"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="w-full rounded-xl bg-violet-500 px-4 py-2 font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400"
                      onClick={() => {
                        if (joinCode.trim()) {
                          handleJoinGame();
                          setShowQRScanner(false);
                        }
                      }}
                    >
                      Join Game
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {statusMessage && <p className="text-sm text-white/80">{statusMessage}</p>}
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
    duration === null ? null : duration - (Date.now() - (gameState.phaseStartedAt ?? Date.now())) / 1000;
  const isStale = lastStateAt ? Date.now() - lastStateAt > MASTER_STALE_MS : false;
  const scene = phaseToScene(gameState.phase, gameState.currentNight);
  const aliveCount = alivePlayers.length;
  const totalCount = gameState.players.length;

  return (
    <div className={`min-h-screen ${scene.bgClass} text-white`}>
      <div className="pointer-events-none absolute inset-0 opacity-50">
        <div className="bg-stars absolute inset-0" />
      </div>

      {showInstallPrompt && (
        <div className="relative z-30 mx-auto w-full max-w-xl px-4 pt-4">
          <div className="rounded-2xl bg-violet-500/90 p-4 shadow-2xl ring-1 ring-violet-400/50 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="font-semibold text-white">Install App</p>
                <p className="mt-1 text-sm text-white/90">
                  {isIOS
                    ? "Tap Share → Add to Home Screen for the best experience"
                    : "Install for full-screen gameplay and faster access"}
                </p>
              </div>
              <div className="flex gap-2">
                {!isIOS && deferredPrompt && (
                  <button
                    onClick={handleInstallPWA}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-violet-600 transition hover:bg-white/90"
                  >
                    Install
                  </button>
                )}
                <button
                  onClick={() => setShowInstallPrompt(false)}
                  className="rounded-xl bg-white/20 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/30"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative min-h-screen pb-24">
        <div className="mx-auto w-full max-w-xl px-4 pt-5">
          {/* Top bar */}
          <div className="flex items-start justify-between gap-3">
            <button
              type="button"
              className={`flip-card ${infoCardFlipped ? "flip-flipped" : ""} w-[210px] max-w-[70vw]`}
              onClick={() => setInfoCardFlipped((v) => !v)}
              aria-label="Show game info"
            >
              <div className="flip-inner relative h-[84px] w-full">
                <div className="flip-face absolute inset-0 rounded-2xl bg-white/10 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur">
                  <p className="text-[11px] uppercase tracking-wide text-white/60">
                    Player
                  </p>
                  <p className="truncate text-lg font-semibold leading-6">
                    {client.playerName}
                  </p>
                  <p className="mt-1 text-xs text-white/60">
                    Tap to flip • {aliveCount}/{totalCount} alive
                  </p>
                </div>
                <div className="flip-face flip-back absolute inset-0 rounded-2xl bg-white/10 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wide text-white/60">
                        Game
                      </p>
                      <p className="text-lg font-semibold leading-6">{gameState.id}</p>
                    </div>
                    {isMaster && (
                      <span className="rounded-full bg-emerald-400/20 px-2 py-1 text-[10px] font-semibold text-emerald-200 ring-1 ring-emerald-300/20">
                        MASTER
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-white/70">
                    Role:{" "}
                    <span className="font-semibold text-white">
                      {playerRole ?? "Hidden"}
                    </span>
                  </p>
                </div>
              </div>
            </button>

            <div className="flex flex-col items-end gap-2">
              <div className="rounded-2xl bg-white/10 px-4 py-3 text-right shadow-2xl ring-1 ring-white/10 backdrop-blur">
                <p className="text-[11px] uppercase tracking-wide text-white/60">
                  Time left
                </p>
                <p
                  className={`text-xl font-semibold ${
                    remainingSeconds !== null && remainingSeconds <= 10
                      ? "text-amber-200"
                      : "text-white"
                  }`}
                >
                  {remainingSeconds === null ? "—" : formatSeconds(remainingSeconds)}
                </p>
              </div>
              <button
                type="button"
                onClick={resetLocal}
                className="text-[11px] font-medium text-white/70 underline underline-offset-2"
              >
                Exit game
              </button>
              {isStale && !isMaster && (
                <button
                  className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15"
                  onClick={handleTakeOver}
                  type="button"
                >
                  Take over (master inactive)
                </button>
              )}
            </div>
          </div>

          {/* Phase scene */}
          <div className="mt-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-white/10 shadow-2xl ring-1 ring-white/10 backdrop-blur">
              <div className="text-white">{scene.icon}</div>
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">{scene.title}</h1>
            <p className="mt-2 text-sm text-white/75">{scene.subtitle}</p>
          </div>

          {/* Main action panel */}
          <div className="mt-8 rounded-3xl bg-white/10 p-5 shadow-2xl ring-1 ring-white/10 backdrop-blur">
            {gameState.phase === "LOBBY" && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-sm text-white/80">
                    Ask friends to join with the game code. Minimum{" "}
                    {MIN_PLAYERS_TO_START} players to start.
                  </p>
                  <p className="text-xs text-white/60">
                    Tip: everyone can keep this open; the game is resumable.
                  </p>
                </div>

                <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <p className="text-sm font-semibold text-white">Scan to join</p>
                  <div className="rounded-xl bg-white p-3">
                    {/*
                      Encode a URL (not just the raw code) so phone camera scanners open the app.
                      The app will parse ?join=... and prefill the join code.
                    */}
                    <QRCode
                      value={`${window.location.origin}/?join=${encodeURIComponent(gameState.id)}`}
                      size={180}
                      level="M"
                      style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                    />
                  </div>
                  <p className="text-xs text-white/70">Game code: {gameState.id}</p>
                </div>

                {isMaster && settingsDraft && (
                  <details className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <summary className="cursor-pointer select-none text-sm font-semibold text-white">
                      Settings
                    </summary>
                    <div className="mt-4 grid gap-3">
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
                                prev
                                  ? { ...prev, daySeconds: Number(e.target.value) }
                                  : prev,
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
                                  ? {
                                      ...prev,
                                      votingSeconds: Number(e.target.value),
                                    }
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

                      <label className="flex items-center gap-2 text-sm text-white/80">
                        <input
                          type="checkbox"
                          checked={settingsDraft.revealRoleOnDeath}
                          onChange={(e) =>
                            setSettingsDraft((prev) =>
                              prev
                                ? { ...prev, revealRoleOnDeath: e.target.checked }
                                : prev,
                            )
                          }
                        />
                        Reveal role when a player is eliminated/killed
                      </label>

                      <button
                        className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15"
                        onClick={handleSaveSettings}
                        type="button"
                      >
                        Save settings
                      </button>
        </div>
                  </details>
                )}

                {isMaster ? (
                  <button
                    className="w-full rounded-2xl bg-violet-500 px-4 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleStartGame}
                    disabled={totalCount < MIN_PLAYERS_TO_START}
                    type="button"
                  >
                    Start game
                  </button>
                ) : (
                  <p className="text-sm text-white/70">
                    Waiting for the master device to start the game…
                  </p>
                )}
              </div>
            )}

            {gameState.phase === "NIGHT" && (
              <div className="space-y-4">
                {playerRole && playerRole !== "VILLAGER" ? (
                  <>
                    <p className="text-sm text-white/80">
                      Choose a target and submit your action.
                    </p>
                    <select
                      className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white outline-none focus:ring-2 focus:ring-cyan-300/70"
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
                      className="w-full rounded-2xl bg-white/10 px-4 py-3 text-base font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={handleSubmitAction}
                      disabled={!selectedTarget}
                      type="button"
                    >
                      Submit{" "}
                      {playerRole === "MAFIA"
                        ? "kill"
                        : playerRole === "DOCTOR"
                          ? "save"
                          : "inspect"}
                    </button>
                  </>
                ) : (
                  (() => {
                    const ritual = pickRitual(gameState.currentNight, client.playerId);
                    const ritualDone = ritualSubmittedNight === gameState.currentNight;
                    return (
                      <div className="space-y-4">
                        <p className="text-sm text-white/85">{ritual.prompt}</p>
                        <div className="grid gap-2">
                          {ritual.choices.map((choice) => (
                            <button
                              key={choice}
                              type="button"
                              className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold ring-1 transition ${
                                ritualChoice === choice
                                  ? "bg-cyan-400/20 text-cyan-100 ring-cyan-300/30"
                                  : "bg-white/10 text-white ring-white/15 hover:bg-white/15"
                              }`}
                              onClick={() => setRitualChoice(choice)}
                              disabled={ritualDone}
                            >
                              {choice}
                            </button>
                          ))}
                        </div>
                        <button
                          className="w-full rounded-2xl bg-white/10 px-4 py-3 text-base font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={handleSubmitRitual}
                          disabled={ritualDone}
                          type="button"
                        >
                          {ritualDone ? "Ritual complete" : "Confirm ritual"}
                        </button>
                        <p className="text-xs text-white/60">
                          This does not affect the game — it’s just camouflage so everyone taps.
                        </p>
    </div>
  );
                  })()
                )}
              </div>
            )}

            {gameState.phase === "DAY" && (
              <div className="space-y-4">
                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <p className="text-sm font-semibold text-white">Overnight</p>
                  <p className="mt-1 text-sm text-white/80">
                    {gameState.lastResolution?.killedPlayerId
                      ? `Eliminated: ${
                          gameState.players.find(
                            (p) => p.id === gameState.lastResolution?.killedPlayerId,
                          )?.name ?? "Unknown"
                        }${
                          gameState.lastResolution?.killedRole
                            ? ` (${gameState.lastResolution.killedRole})`
                            : ""
                        }`
                      : "No one was eliminated."}
                  </p>
                </div>
                {isMaster && (
                  <button
                    className="w-full rounded-2xl bg-amber-400 px-4 py-3 text-base font-semibold text-black shadow-lg shadow-amber-400/20 transition hover:bg-amber-300"
                    onClick={handleStartVoting}
                    type="button"
                  >
                    Start voting
                  </button>
                )}
              </div>
            )}

            {gameState.phase === "VOTING" && (
              <div className="space-y-4">
                <p className="text-sm text-white/80">Cast your vote (secret).</p>
                <select
                  className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white outline-none focus:ring-2 focus:ring-amber-300/70"
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
                  className="w-full rounded-2xl bg-amber-400 px-4 py-3 text-base font-semibold text-black shadow-lg shadow-amber-400/20 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleSubmitVote}
                  disabled={!voteTarget}
                  type="button"
                >
                  Submit vote
                </button>
              </div>
            )}

            {gameState.phase === "RESOLUTION" && (
              <div className="space-y-4">
                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <p className="text-sm font-semibold text-white">Vote result</p>
                  <p className="mt-1 text-sm text-white/80">
                    {gameState.lastVoteResult?.tie
                      ? "Tie — no one is eliminated."
                      : `Eliminated: ${
                          gameState.players.find(
                            (p) => p.id === gameState.lastVoteResult?.eliminatedPlayerId,
                          )?.name ?? "Unknown"
                        }${
                          gameState.lastVoteResult?.eliminatedRole
                            ? ` (${gameState.lastVoteResult.eliminatedRole})`
                            : ""
                        }`}
                  </p>
                </div>
                {isMaster && (
                  <button
                    className="w-full rounded-2xl bg-violet-500 px-4 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400"
                    onClick={handleStartNight}
                    type="button"
                  >
                    Start next night
                  </button>
                )}
              </div>
            )}

            {gameState.phase === "GAME_OVER" && (
              <div className="space-y-4">
                {gameState.winner && (
                  <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                    <p className="text-sm font-semibold text-white">Winner</p>
                    <p className="mt-1 text-2xl font-semibold">
                      {gameState.winner === "MAFIA" ? "Mafia" : "Villagers"}
                    </p>
                  </div>
                )}
                {gameState.revealedRoles && (
                  <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                    <p className="text-sm font-semibold text-white">Role reveal</p>
                    <div className="mt-3 grid gap-2">
                      {gameState.players.map((player) => (
                        <div
                          key={player.id}
                          className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/10"
                        >
                          <span className="text-sm font-medium">{player.name}</span>
                          <span className="text-sm font-semibold text-white/90">
                            {gameState.revealedRoles?.[player.id] ?? "Unknown"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {isMaster && (
                  <button
                    className="w-full rounded-2xl bg-violet-500 px-4 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400"
                    onClick={handleRestartWithSamePlayers}
                    type="button"
                  >
                    Restart with same players
                  </button>
                )}
                <button
                  className="w-full rounded-2xl bg-white/10 px-4 py-3 text-base font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15"
                  onClick={resetLocal}
                  type="button"
                >
                  Leave game
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Bottom drawer: players + detective notes */}
        <div className="fixed inset-x-0 bottom-0 z-20 px-4 pb-4">
          <div className="mx-auto w-full max-w-xl">
            <button
              type="button"
              className="w-full rounded-2xl bg-white/10 px-4 py-3 text-left text-sm font-semibold text-white shadow-2xl ring-1 ring-white/10 backdrop-blur"
              onClick={() => setPlayersDrawerOpen((v) => !v)}
            >
              Players ({aliveCount}/{totalCount} alive)
              <span className="float-right text-white/70">
                {playersDrawerOpen ? "Hide" : "Show"}
              </span>
            </button>

            {playersDrawerOpen && (
              <div className="mt-3 max-h-[55vh] overflow-auto rounded-3xl bg-black/40 p-4 shadow-2xl ring-1 ring-white/10 backdrop-blur">
                <div className="grid gap-2 sm:grid-cols-2">
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

                {inspectionResults.length > 0 && (
                  <div className="mt-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                    <p className="text-sm font-semibold">Detective notes</p>
                    <div className="mt-2 space-y-1 text-sm text-white/80">
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
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Toast */}
        {statusMessage && (
          <div className="fixed left-0 right-0 top-3 z-30 px-4">
            <div className="mx-auto w-full max-w-xl rounded-2xl bg-black/60 px-4 py-3 text-sm text-white shadow-2xl ring-1 ring-white/10 backdrop-blur">
              {statusMessage}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
