import type { Action, GameState, Player, Role, Vote } from "@/lib/types";

export const REQUIRED_ROLES: Role[] = ["MAFIA", "DOCTOR", "DETECTIVE"];

export const ACTIVE_POLL_INTERVAL_MS = 3000;
export const MASTER_STALE_MS = 15000;

export function generateId(length = 6): string {
  return Math.random().toString(36).slice(2, 2 + length).toUpperCase();
}

export function createInitialState(
  gameId: string,
  masterPlayerId: string,
  players: Player[],
): GameState {
  const now = Date.now();
  return {
    id: gameId,
    status: "ACTIVE",
    phase: "LOBBY",
    currentNight: 0,
    phaseStartedAt: now,
    settings: {
      nightSeconds: 60,
      daySeconds: 120,
      votingSeconds: 60,
      autoAdvance: true,
      revealRoleOnDeath: false,
    },
    masterPlayerId,
    version: 1,
    players,
    createdAt: now,
    updatedAt: now,
  };
}

function calculateMafiaCount(totalPlayers: number): number {
  // Mafia game balance rules:
  // 4-6 players: 1 Mafia
  // 7-9 players: 2 Mafia
  // 10-12 players: 2 Mafia
  // 13-15 players: 3 Mafia
  // 16-18 players: 3 Mafia
  // 19-21 players: 4 Mafia
  // 22+ players: ~1 Mafia per 5-6 players
  if (totalPlayers <= 6) {
    return 1;
  } else if (totalPlayers <= 9) {
    return 2;
  } else if (totalPlayers <= 12) {
    return 2;
  } else if (totalPlayers <= 15) {
    return 3;
  } else if (totalPlayers <= 18) {
    return 3;
  } else if (totalPlayers <= 21) {
    return 4;
  } else {
    // For very large games, roughly 1 Mafia per 5-6 players
    return Math.max(4, Math.floor(totalPlayers / 5.5));
  }
}

export function assignRoles(players: Player[]): Player[] {
  if (players.length < 4) {
    throw new Error("At least 4 players required");
  }

  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const mafiaCount = calculateMafiaCount(players.length);
  
  // Build roles array: multiple MAFIA, one DOCTOR, one DETECTIVE, rest are VILLAGERS
  const roles: Role[] = [
    ...Array(mafiaCount).fill("MAFIA"),
    "DOCTOR",
    "DETECTIVE",
    ...Array(Math.max(shuffled.length - mafiaCount - 2, 0)).fill("VILLAGER"),
  ];

  // Shuffle roles again to randomize which players get which roles
  const shuffledRoles = [...roles].sort(() => Math.random() - 0.5);

  const assigned = shuffled.map((player, index) => ({
    ...player,
    role: shuffledRoles[index] ?? "VILLAGER",
  }));

  // Safety check: ensure at least one MAFIA was assigned
  const finalMafiaCount = assigned.filter((p) => p.role === "MAFIA").length;
  if (finalMafiaCount === 0) {
    // Fallback: assign first player as MAFIA if somehow none was assigned
    assigned[0]!.role = "MAFIA";
  }

  return assigned;
}

export function getAlivePlayers(players: Player[]): Player[] {
  return players.filter((player) => player.alive);
}

export function getRoleCount(players: Player[], role: Role): number {
  return players.filter((player) => player.alive && player.role === role).length;
}

export function resolveNightActions(
  state: GameState,
  actions: Action[],
): {
  updatedPlayers: Player[];
  killedPlayerId?: string;
  savedPlayerId?: string;
  inspectionResults: Array<{
    detectiveId: string;
    targetPlayerId: string;
    targetRole: Role;
  }>;
} {
  const alivePlayers = getAlivePlayers(state.players);
  const mafiaActions = actions.filter((action) => action.type === "KILL");
  const doctorAction = actions.find((action) => action.type === "SAVE");
  const detectiveActions = actions.filter((action) => action.type === "INSPECT");

  // Multiple Mafia: majority vote on kill target. Tie => no kill.
  const killVotes = new Map<string, number>();
  for (const action of mafiaActions) {
    if (!action.targetPlayerId) {
      continue;
    }
    killVotes.set(action.targetPlayerId, (killVotes.get(action.targetPlayerId) ?? 0) + 1);
  }

  let killTargetId: string | undefined;
  if (killVotes.size > 0) {
    let max = 0;
    for (const count of killVotes.values()) {
      max = Math.max(max, count);
    }
    const top = [...killVotes.entries()].filter(([, c]) => c === max).map(([id]) => id);
    killTargetId = top.length === 1 ? top[0] : undefined;
  }

  const savedPlayerId = doctorAction?.targetPlayerId;
  const killTarget = killTargetId
    ? state.players.find((player) => player.id === killTargetId)
    : undefined;
  const killTargetIsMafia = killTarget?.role === "MAFIA";
  const shouldKill =
    killTargetId && killTargetId !== savedPlayerId
      ? alivePlayers.some((player) => player.id === killTargetId) && !killTargetIsMafia
      : false;

  const updatedPlayers = state.players.map((player) => {
    if (shouldKill && player.id === killTargetId) {
      return { ...player, alive: false };
    }
    return player;
  });

  const inspectionResults = detectiveActions
    .map((action) => {
      const target = state.players.find(
        (player) => player.id === action.targetPlayerId,
      );
      if (!target || !target.role) {
        return null;
      }
      return {
        detectiveId: action.playerId,
        targetPlayerId: target.id,
        targetRole: target.role,
      };
    })
    .filter(Boolean) as Array<{
    detectiveId: string;
    targetPlayerId: string;
    targetRole: Role;
  }>;

  return {
    updatedPlayers,
    killedPlayerId: shouldKill ? killTargetId : undefined,
    savedPlayerId: savedPlayerId && savedPlayerId === killTargetId ? savedPlayerId : undefined,
    inspectionResults,
  };
}

export function resolveVotes(
  state: GameState,
  votes: Vote[],
): {
  updatedPlayers: Player[];
  eliminatedPlayerId?: string;
  tie: boolean;
} {
  const alivePlayers = getAlivePlayers(state.players);
  const validVotes = votes.filter((vote) =>
    alivePlayers.some((player) => player.id === vote.voterId),
  );

  const counts = new Map<string, number>();
  for (const vote of validVotes) {
    counts.set(vote.targetPlayerId, (counts.get(vote.targetPlayerId) ?? 0) + 1);
  }

  let maxVotes = 0;
  for (const count of counts.values()) {
    maxVotes = Math.max(maxVotes, count);
  }

  const topTargets = [...counts.entries()]
    .filter(([, count]) => count === maxVotes)
    .map(([targetId]) => targetId);

  const tie = topTargets.length !== 1;
  const eliminatedPlayerId = tie ? undefined : topTargets[0];

  const updatedPlayers = state.players.map((player) => {
    if (eliminatedPlayerId && player.id === eliminatedPlayerId) {
      return { ...player, alive: false };
    }
    return player;
  });

  return { updatedPlayers, eliminatedPlayerId, tie };
}

export function checkWin(players: Player[]): "VILLAGERS" | "MAFIA" | null {
  const mafiaCount = getRoleCount(players, "MAFIA");
  const villagerCount = getAlivePlayers(players).filter(
    (player) => player.role !== "MAFIA",
  ).length;

  if (mafiaCount === 0) {
    return "VILLAGERS";
  }

  if (mafiaCount >= villagerCount) {
    return "MAFIA";
  }

  return null;
}
