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
    },
    masterPlayerId,
    version: 1,
    players,
    createdAt: now,
    updatedAt: now,
  };
}

export function assignRoles(players: Player[]): Player[] {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const roles: Role[] = [
    "MAFIA",
    "DOCTOR",
    "DETECTIVE",
    ...Array(Math.max(shuffled.length - 3, 0)).fill("VILLAGER"),
  ];

  return shuffled.map((player, index) => ({
    ...player,
    role: roles[index] ?? "VILLAGER",
  }));
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
  const mafiaAction = actions.find((action) => action.type === "KILL");
  const doctorAction = actions.find((action) => action.type === "SAVE");
  const detectiveActions = actions.filter((action) => action.type === "INSPECT");

  const killTargetId = mafiaAction?.targetPlayerId;
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
