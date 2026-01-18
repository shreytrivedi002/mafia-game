export type Role = "MAFIA" | "VILLAGER" | "DOCTOR" | "DETECTIVE";

export type Phase =
  | "CREATED"
  | "LOBBY"
  | "NIGHT"
  | "DAY"
  | "VOTING"
  | "RESOLUTION"
  | "GAME_OVER";

export type GameStatus = "ACTIVE" | "COMPLETED";

export type GameSettings = {
  nightSeconds: number;
  daySeconds: number;
  votingSeconds: number;
  autoAdvance: boolean;
  revealRoleOnDeath: boolean;
};

export type Player = {
  id: string;
  name: string;
  role?: Role;
  alive: boolean;
  joinedAt: number;
  lastSeenAt: number;
};

export type GameState = {
  id: string;
  status: GameStatus;
  phase: Phase;
  currentNight: number;
  phaseId?: string;
  phaseStartedAt: number;
  settings: GameSettings;
  masterPlayerId: string;
  version: number;
  players: Player[];
  lastResolution?: {
    killedPlayerId?: string;
    savedPlayerId?: string;
    killedRole?: Role;
  };
  lastVoteResult?: {
    eliminatedPlayerId?: string;
    tie: boolean;
    eliminatedRole?: Role;
  };
  winner?: "VILLAGERS" | "MAFIA";
  revealedRoles?: Record<string, Role>;
  createdAt: number;
  updatedAt: number;
};

export type ActionType = "KILL" | "SAVE" | "INSPECT";

export type Action = {
  gameId: string;
  nightNumber: number;
  playerId: string;
  type: ActionType;
  targetPlayerId: string;
  createdAt: number;
};

export type Vote = {
  gameId: string;
  phaseId: string;
  voterId: string;
  targetPlayerId: string;
  createdAt: number;
};

export type RelayEvent =
  | {
      type: "JOIN";
      id: string;
      createdAt: number;
      payload: {
        playerId: string;
        name: string;
        token: string;
      };
    }
  | {
      type: "ACTION";
      id: string;
      createdAt: number;
      payload: Action;
    }
  | {
      type: "RITUAL";
      id: string;
      createdAt: number;
      payload: {
        gameId: string;
        nightNumber: number;
        playerId: string;
        promptId: string;
        choice: string;
      };
    }
  | {
      type: "VOTE";
      id: string;
      createdAt: number;
      payload: Vote;
    };

export type RelayEventWithIndex = RelayEvent & { index: number };

export type SecretMessage =
  | {
      type: "ROLE_ASSIGNMENT";
      createdAt: number;
      payload: {
        role: Role;
      };
    }
  | {
      type: "GAME_RESET";
      createdAt: number;
      payload: Record<string, never>;
    }
  | {
      type: "ACTION_REJECTED";
      createdAt: number;
      payload: {
        reason: string;
      };
    }
  | {
      type: "INSPECTION_RESULT";
      createdAt: number;
      payload: {
        nightNumber: number;
        targetPlayerId: string;
        targetRole: Role;
      };
    };
