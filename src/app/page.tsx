"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import type {
  GameState,
  GameSettings,
  Role,
  SecretMessage,
} from "@/lib/types";

const STORAGE_KEYS = {
  gameId: "mafia_game_id",
  playerId: "mafia_player_id",
  playerName: "mafia_player_name",
  playerToken: "mafia_player_token",
  playerRole: "mafia_player_role",
};

type ClientInfo = {
  gameId: string;
  playerId: string;
  playerName: string;
  playerToken: string;
};

const POLL_INTERVAL_MS = 2000;
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

function getPhaseDurationSeconds(
  phase: GameState["phase"],
  settings: GameSettings | undefined
): number | null {
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
    <svg className={baseIconClass} viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
      <path d="M7 11h10M7 15h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
      <path d="M12 3v18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 3h10v4a5 5 0 0 1-10 0V3Z" stroke="currentColor" strokeWidth="1.8" />
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
      subtitle: "Gather players. Configure settings and start the game.",
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

const NIGHT_RITUALS: Array<{ id: string; prompt: string; choices: string[] }> = [
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

// ============ API CALLS ============

async function apiCreateGame(playerName: string) {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create game");
  }
  return res.json() as Promise<{
    gameId: string;
    playerId: string;
    token: string;
    state: GameState;
  }>;
}

async function apiJoinGame(gameId: string, playerName: string) {
  const res = await fetch("/api/game/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, playerName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to join game");
  }
  return res.json() as Promise<{
    gameId: string;
    playerId: string;
    token: string;
    state: GameState;
  }>;
}

async function apiGetState(gameId: string, playerId?: string) {
  const url = playerId
    ? `/api/game/state?gameId=${gameId}&playerId=${playerId}`
    : `/api/game/state?gameId=${gameId}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  return data.state as GameState;
}

async function apiStartGame(gameId: string, playerId: string, token: string) {
  const res = await fetch("/api/game/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, playerId, token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to start game");
  }
  return res.json() as Promise<{ state: GameState }>;
}

async function apiSubmitAction(
  gameId: string,
  playerId: string,
  token: string,
  actionType: string,
  targetPlayerId: string
) {
  const res = await fetch("/api/game/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, playerId, token, actionType, targetPlayerId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to submit action");
  }
  return res.json();
}

async function apiSubmitRitual(gameId: string, playerId: string, token: string) {
  const res = await fetch("/api/game/ritual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, playerId, token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to submit ritual");
  }
  return res.json();
}

async function apiSubmitVote(
  gameId: string,
  playerId: string,
  token: string,
  targetPlayerId: string
) {
  const res = await fetch("/api/game/vote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, playerId, token, targetPlayerId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to submit vote");
  }
  return res.json();
}

async function apiUpdateSettings(
  gameId: string,
  playerId: string,
  token: string,
  settings: Partial<GameSettings>
) {
  const res = await fetch("/api/game/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, playerId, token, settings }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update settings");
  }
  return res.json() as Promise<{ state: GameState }>;
}

async function apiAdvancePhase(gameId: string, playerId: string, token: string) {
  const res = await fetch("/api/game/advance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, playerId, token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to advance phase");
  }
  return res.json() as Promise<{ state: GameState }>;
}

async function apiRestartGame(gameId: string, playerId: string, token: string) {
  const res = await fetch("/api/game/restart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, playerId, token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to restart game");
  }
  return res.json() as Promise<{ state: GameState }>;
}

async function apiGetInbox(gameId: string, playerId: string, token: string) {
  const res = await fetch(
    `/api/game/inbox?gameId=${gameId}&playerId=${playerId}&token=${token}`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.messages || []) as SecretMessage[];
}

// ============ COMPONENT ============

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
  const [settingsDraft, setSettingsDraft] = useState<GameSettings | null>(null);
  const [infoCardFlipped, setInfoCardFlipped] = useState(false);
  const [playersDrawerOpen, setPlayersDrawerOpen] = useState(false);
  const [ritualChoice, setRitualChoice] = useState<string>("");
  const [ritualSubmittedNight, setRitualSubmittedNight] = useState<number | null>(null);
  const [actionSubmittedNight, setActionSubmittedNight] = useState<number | null>(null);
  const [voteSubmittedPhase, setVoteSubmittedPhase] = useState<string | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  };

  const alivePlayers = useMemo(() => {
    if (!gameState) return [];
    return gameState.players.filter((p) => p.alive);
  }, [gameState]);

  // Load from localStorage on mount
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
    }
  }, []);

  // Deep link support
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const join = params.get("join") || params.get("gameId");
    if (join) {
      setJoinCode(join.toUpperCase());
      setShowQRScanner(true);
    }
  }, []);

  // PWA install prompt
  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    if (isStandalone) {
      setShowInstallPrompt(false);
      return;
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowInstallPrompt(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    const timeout = setTimeout(() => {
      setShowInstallPrompt(true);
    }, 1500);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  // Poll for game state
  useEffect(() => {
    if (!client?.gameId) return;

    let active = true;
    const poll = async () => {
      const state = await apiGetState(client.gameId, client.playerId);
      if (state && active) {
        setGameState(state);
      }
    };

    poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [client?.gameId, client?.playerId]);

  // Poll inbox for role assignments and inspection results
  useEffect(() => {
    if (!client) return;

    let active = true;
    const pollInbox = async () => {
      const messages = await apiGetInbox(client.gameId, client.playerId, client.playerToken);
      if (!active || messages.length === 0) return;

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
          setActionSubmittedNight(null);
          setRitualSubmittedNight(null);
          setVoteSubmittedPhase(null);
          setStatusMessage("Game restarted. Waiting in lobby.");
        }
        if (message.type === "INSPECTION_RESULT") {
          setInspectionResults((prev) => [...prev, message]);
        }
      }
    };

    pollInbox();
    const interval = window.setInterval(pollInbox, POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [client]);

  // Auto-dismiss status messages
  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  // Initialize settings draft
  useEffect(() => {
    if (!gameState) return;
    setSettingsDraft((prev) => prev ?? gameState.settings);
  }, [gameState?.id]);

  // Reset UI state on phase change
  useEffect(() => {
    setInfoCardFlipped(false);
    setPlayersDrawerOpen(false);
    setRitualChoice("");
  }, [gameState?.phase]);

  // ============ HANDLERS ============

  const handleCreateGame = async () => {
    if (!nickname.trim()) {
      setStatusMessage("Enter a nickname to create a game.");
      return;
    }
    setIsLoading(true);
    try {
      const result = await apiCreateGame(nickname.trim());
      localStorage.setItem(STORAGE_KEYS.gameId, result.gameId);
      localStorage.setItem(STORAGE_KEYS.playerId, result.playerId);
      localStorage.setItem(STORAGE_KEYS.playerName, nickname.trim());
      localStorage.setItem(STORAGE_KEYS.playerToken, result.token);
      setClient({
        gameId: result.gameId,
        playerId: result.playerId,
        playerName: nickname.trim(),
        playerToken: result.token,
      });
      setGameState(result.state);
      setSettingsDraft(result.state.settings);
    } catch (err: any) {
      setStatusMessage(err.message || "Failed to create game");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinGame = async () => {
    if (!nickname.trim() || !joinCode.trim()) {
      setStatusMessage("Enter a nickname and game code.");
      return;
    }
    setIsLoading(true);
    try {
      const result = await apiJoinGame(joinCode.trim().toUpperCase(), nickname.trim());
      localStorage.setItem(STORAGE_KEYS.gameId, result.gameId);
      localStorage.setItem(STORAGE_KEYS.playerId, result.playerId);
      localStorage.setItem(STORAGE_KEYS.playerName, nickname.trim());
      localStorage.setItem(STORAGE_KEYS.playerToken, result.token);
      setClient({
        gameId: result.gameId,
        playerId: result.playerId,
        playerName: nickname.trim(),
        playerToken: result.token,
      });
      setGameState(result.state);
      setSettingsDraft(result.state.settings);
      setShowQRScanner(false);
    } catch (err: any) {
      setStatusMessage(err.message || "Failed to join game");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartGame = async () => {
    if (!client || !gameState) return;
    if (gameState.players.length < MIN_PLAYERS_TO_START) {
      setStatusMessage(`At least ${MIN_PLAYERS_TO_START} players required.`);
      return;
    }
    setIsLoading(true);
    try {
      const result = await apiStartGame(client.gameId, client.playerId, client.playerToken);
      setGameState(result.state);
    } catch (err: any) {
      setStatusMessage(err.message || "Failed to start game");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!client || !gameState || !settingsDraft) return;
    setIsLoading(true);
    try {
      const result = await apiUpdateSettings(
        client.gameId,
        client.playerId,
        client.playerToken,
        {
          nightSeconds: clampNumber(settingsDraft.nightSeconds, 10, 1800),
          daySeconds: clampNumber(settingsDraft.daySeconds, 10, 3600),
          votingSeconds: clampNumber(settingsDraft.votingSeconds, 10, 1800),
          autoAdvance: settingsDraft.autoAdvance,
          revealRoleOnDeath: settingsDraft.revealRoleOnDeath,
        }
      );
      setGameState(result.state);
      setStatusMessage("Settings saved.");
    } catch (err: any) {
      setStatusMessage(err.message || "Failed to save settings");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitAction = async () => {
    if (!client || !gameState || !selectedTarget || !playerRole) return;
    const actionType =
      playerRole === "MAFIA" ? "KILL" : playerRole === "DOCTOR" ? "SAVE" : "INSPECT";

    setIsLoading(true);
    try {
      await apiSubmitAction(
        client.gameId,
        client.playerId,
        client.playerToken,
        actionType,
        selectedTarget
      );
      setActionSubmittedNight(gameState.currentNight);
      setSelectedTarget("");
      setStatusMessage("Action submitted. Waiting for others...");
    } catch (err: any) {
      setStatusMessage(err.message || "Failed to submit action");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitRitual = async () => {
    if (!client || !gameState) return;
    if (!ritualChoice) {
      setStatusMessage("Pick an option to complete your night ritual.");
      return;
    }
    setIsLoading(true);
    try {
      await apiSubmitRitual(client.gameId, client.playerId, client.playerToken);
      setRitualSubmittedNight(gameState.currentNight);
      setStatusMessage("Ritual complete. Waiting for others...");
    } catch (err: any) {
      setStatusMessage(err.message || "Failed to submit ritual");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitVote = async () => {
    if (!client || !gameState || !voteTarget) return;
    setIsLoading(true);
    try {
      await apiSubmitVote(client.gameId, client.playerId, client.playerToken, voteTarget);
      setVoteSubmittedPhase(gameState.phaseId || null);
      setVoteTarget("");
      setStatusMessage("Vote submitted. Waiting for others...");
    } catch (err: any) {
      setStatusMessage(err.message || "Failed to submit vote");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartVoting = async () => {
    if (!client || !gameState) return;
    setIsLoading(true);
    try {
      const result = await apiAdvancePhase(client.gameId, client.playerId, client.playerToken);
      setGameState(result.state);
    } catch (err: any) {
      setStatusMessage(err.message || "Failed to start voting");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestartGame = async () => {
    if (!client || !gameState) return;
    setIsLoading(true);
    try {
      const result = await apiRestartGame(client.gameId, client.playerId, client.playerToken);
      setGameState(result.state);
      setPlayerRole(null);
      localStorage.removeItem(STORAGE_KEYS.playerRole);
      setInspectionResults([]);
      setActionSubmittedNight(null);
      setRitualSubmittedNight(null);
      setVoteSubmittedPhase(null);
    } catch (err: any) {
      setStatusMessage(err.message || "Failed to restart game");
    } finally {
      setIsLoading(false);
    }
  };

  const handleInstallPWA = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setShowInstallPrompt(false);
        setDeferredPrompt(null);
      }
    } else {
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
    setInspectionResults([]);
    setActionSubmittedNight(null);
    setRitualSubmittedNight(null);
    setVoteSubmittedPhase(null);
  };

  // ============ RENDER ============

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
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              className="flex-1 rounded-xl bg-violet-500 px-4 py-2 font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400 disabled:opacity-50"
              onClick={handleCreateGame}
              disabled={isLoading}
            >
              {isLoading ? "Creating..." : "Create Game"}
            </button>
            <div className="flex flex-1 gap-2">
              <input
                className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-violet-400/70"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
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
                className="rounded-xl bg-white/10 px-4 py-2 font-medium text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
                onClick={handleJoinGame}
                disabled={isLoading}
              >
                Join
              </button>
            </div>
          </div>
          {showQRScanner && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
              <div className="w-full max-w-md rounded-2xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-lg font-semibold text-white">Join Game</p>
                  <button
                    type="button"
                    onClick={() => setShowQRScanner(false)}
                    className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-3">
                  <p className="text-sm text-white/80">Enter the game code to join.</p>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-violet-400/70"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="Game code"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="w-full rounded-xl bg-violet-500 px-4 py-2 font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400 disabled:opacity-50"
                    onClick={() => {
                      if (joinCode.trim() && nickname.trim()) {
                        handleJoinGame();
                      } else if (!nickname.trim()) {
                        setStatusMessage("Enter a nickname first.");
                      }
                    }}
                    disabled={isLoading}
                  >
                    {isLoading ? "Joining..." : "Join Game"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {statusMessage && <p className="text-sm text-white/80">{statusMessage}</p>}
        </div>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-950 via-slate-950 to-black px-6 py-10 text-white">
        <div className="mx-auto w-full max-w-xl space-y-4 rounded-3xl bg-white/10 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur">
          <h1 className="text-xl font-semibold">Loading game {client.gameId}...</h1>
          <p className="text-sm text-white/80">Please wait...</p>
          <button className="text-sm underline text-white/80" onClick={resetLocal}>
            Leave game
          </button>
        </div>
      </div>
    );
  }

  const duration = getPhaseDurationSeconds(gameState.phase, gameState.settings);
  const remainingSeconds =
    duration === null
      ? null
      : duration - (Date.now() - (gameState.phaseStartedAt ?? Date.now())) / 1000;
  const scene = phaseToScene(gameState.phase, gameState.currentNight);
  const aliveCount = alivePlayers.length;
  const totalCount = gameState.players.length;

  const actionAlreadySubmitted = actionSubmittedNight === gameState.currentNight;
  const ritualAlreadySubmitted = ritualSubmittedNight === gameState.currentNight;
  const voteAlreadySubmitted = voteSubmittedPhase === gameState.phaseId;

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
                  <p className="text-[11px] uppercase tracking-wide text-white/60">Player</p>
                  <p className="truncate text-lg font-semibold leading-6">{client.playerName}</p>
                  <p className="mt-1 text-xs text-white/60">
                    Tap to flip • {aliveCount}/{totalCount} alive
                  </p>
                </div>
                <div className="flip-face flip-back absolute inset-0 rounded-2xl bg-white/10 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wide text-white/60">Game</p>
                      <p className="text-lg font-semibold leading-6">{gameState.id}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-white/70">
                    Role: <span className="font-semibold text-white">{playerRole ?? "Hidden"}</span>
                  </p>
                </div>
              </div>
            </button>

            <div className="flex flex-col items-end gap-2">
              <div className="rounded-2xl bg-white/10 px-4 py-3 text-right shadow-2xl ring-1 ring-white/10 backdrop-blur">
                <p className="text-[11px] uppercase tracking-wide text-white/60">Time left</p>
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
                    Ask friends to join with the game code. Minimum {MIN_PLAYERS_TO_START} players.
                  </p>
                </div>

                <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <p className="text-sm font-semibold text-white">Scan to join</p>
                  <div className="rounded-xl bg-white p-3">
                    <QRCode
                      value={`${typeof window !== "undefined" ? window.location.origin : ""}/?join=${encodeURIComponent(gameState.id)}`}
                      size={180}
                      level="M"
                      style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                    />
                  </div>
                  <p className="text-xs text-white/70">Game code: {gameState.id}</p>
                </div>

                {settingsDraft && (
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
                                prev ? { ...prev, nightSeconds: Number(e.target.value) } : prev
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
                                prev ? { ...prev, daySeconds: Number(e.target.value) } : prev
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
                                prev ? { ...prev, votingSeconds: Number(e.target.value) } : prev
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
                              prev ? { ...prev, autoAdvance: e.target.checked } : prev
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
                              prev ? { ...prev, revealRoleOnDeath: e.target.checked } : prev
                            )
                          }
                        />
                        Reveal role when a player is eliminated/killed
                      </label>

                      <button
                        className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
                        onClick={handleSaveSettings}
                        disabled={isLoading}
                        type="button"
                      >
                        Save settings
                      </button>
                    </div>
                  </details>
                )}

                <button
                  className="w-full rounded-2xl bg-violet-500 px-4 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleStartGame}
                  disabled={isLoading || totalCount < MIN_PLAYERS_TO_START}
                  type="button"
                >
                  {isLoading ? "Starting..." : "Start game"}
                </button>
              </div>
            )}

            {gameState.phase === "NIGHT" && (
              <div className="space-y-4">
                {playerRole && playerRole !== "VILLAGER" ? (
                  actionAlreadySubmitted ? (
                    <div className="text-center">
                      <p className="text-sm text-white/80">Action submitted. Waiting for others...</p>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-white/80">Choose a target and submit your action.</p>
                      <select
                        className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white outline-none focus:ring-2 focus:ring-cyan-300/70"
                        value={selectedTarget}
                        onChange={(e) => setSelectedTarget(e.target.value)}
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
                        disabled={!selectedTarget || isLoading}
                        type="button"
                      >
                        {isLoading
                          ? "Submitting..."
                          : `Submit ${playerRole === "MAFIA" ? "kill" : playerRole === "DOCTOR" ? "save" : "inspect"}`}
                      </button>
                    </>
                  )
                ) : (
                  (() => {
                    const ritual = pickRitual(gameState.currentNight, client.playerId);
                    return (
                      <div className="space-y-4">
                        {ritualAlreadySubmitted ? (
                          <div className="text-center">
                            <p className="text-sm text-white/80">
                              Ritual complete. Waiting for others...
                            </p>
                          </div>
                        ) : (
                          <>
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
                                >
                                  {choice}
                                </button>
                              ))}
                            </div>
                            <button
                              className="w-full rounded-2xl bg-white/10 px-4 py-3 text-base font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={handleSubmitRitual}
                              disabled={isLoading}
                              type="button"
                            >
                              {isLoading ? "Submitting..." : "Confirm ritual"}
                            </button>
                            <p className="text-xs text-white/60">
                              This does not affect the game — it's camouflage so everyone taps.
                            </p>
                          </>
                        )}
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
                            (p) => p.id === gameState.lastResolution?.killedPlayerId
                          )?.name ?? "Unknown"
                        }${
                          gameState.lastResolution?.killedRole
                            ? ` (${gameState.lastResolution.killedRole})`
                            : ""
                        }`
                      : "No one was eliminated."}
                  </p>
                </div>
                <button
                  className="w-full rounded-2xl bg-amber-400 px-4 py-3 text-base font-semibold text-black shadow-lg shadow-amber-400/20 transition hover:bg-amber-300 disabled:opacity-50"
                  onClick={handleStartVoting}
                  disabled={isLoading}
                  type="button"
                >
                  {isLoading ? "Starting..." : "Start voting"}
                </button>
              </div>
            )}

            {gameState.phase === "VOTING" && (
              <div className="space-y-4">
                {voteAlreadySubmitted ? (
                  <div className="text-center">
                    <p className="text-sm text-white/80">Vote submitted. Waiting for others...</p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-white/80">Cast your vote (secret).</p>
                    <select
                      className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white outline-none focus:ring-2 focus:ring-amber-300/70"
                      value={voteTarget}
                      onChange={(e) => setVoteTarget(e.target.value)}
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
                      disabled={!voteTarget || isLoading}
                      type="button"
                    >
                      {isLoading ? "Submitting..." : "Submit vote"}
                    </button>
                  </>
                )}
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
                            (p) => p.id === gameState.lastVoteResult?.eliminatedPlayerId
                          )?.name ?? "Unknown"
                        }${
                          gameState.lastVoteResult?.eliminatedRole
                            ? ` (${gameState.lastVoteResult.eliminatedRole})`
                            : ""
                        }`}
                  </p>
                </div>
                <p className="text-center text-sm text-white/60">
                  Next night will start automatically...
                </p>
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
                <button
                  className="w-full rounded-2xl bg-violet-500 px-4 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400 disabled:opacity-50"
                  onClick={handleRestartGame}
                  disabled={isLoading}
                  type="button"
                >
                  {isLoading ? "Restarting..." : "Restart with same players"}
                </button>
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
                        if (result.type !== "INSPECTION_RESULT") return null;
                        const target = gameState.players.find(
                          (p) => p.id === result.payload.targetPlayerId
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
