import { NextRequest, NextResponse } from "next/server";
import type { Db } from "mongodb";
import clientPromise from "@/lib/mongodb";
import type { GameState, Action, Vote, Role } from "@/lib/types";
import type { GameDoc, InboxDoc } from "@/lib/db-types";
import {
  getAlivePlayers,
  resolveNightActions,
  resolveVotes,
  checkWin,
} from "@/lib/game";

export const dynamic = "force-dynamic";

const DB_NAME = "mafia";

// Helper: Check if phase should auto-advance based on timer
function shouldAutoAdvance(state: GameState): boolean {
  if (!state.settings?.autoAdvance) return false;

  const elapsed = (Date.now() - state.phaseStartedAt) / 1000;

  switch (state.phase) {
    case "NIGHT":
      return elapsed >= state.settings.nightSeconds;
    case "DAY":
      return elapsed >= state.settings.daySeconds;
    case "VOTING":
      return elapsed >= state.settings.votingSeconds;
    default:
      return false;
  }
}

// Helper: Check if all required actions are submitted
function allNightActionsSubmitted(
  state: GameState,
  actions: Action[],
  rituals: Array<{ playerId: string; nightNumber: number }>
): boolean {
  const alivePlayers = getAlivePlayers(state.players);
  const currentNightActions = actions.filter((a) => a.nightNumber === state.currentNight);
  const currentNightRituals = rituals.filter((r) => r.nightNumber === state.currentNight);

  for (const player of alivePlayers) {
    const role = player.role;
    if (role === "MAFIA" || role === "DOCTOR" || role === "DETECTIVE") {
      const hasAction = currentNightActions.some((a) => a.playerId === player.id);
      if (!hasAction) return false;
    } else {
      const hasRitual = currentNightRituals.some((r) => r.playerId === player.id);
      if (!hasRitual) return false;
    }
  }
  return true;
}

// Helper: Check if all votes are in
function allVotesSubmitted(state: GameState, votes: Vote[]): boolean {
  const alivePlayers = getAlivePlayers(state.players);
  const currentPhaseVotes = votes.filter((v) => v.phaseId === state.phaseId);

  for (const player of alivePlayers) {
    const hasVoted = currentPhaseVotes.some((v) => v.voterId === player.id);
    if (!hasVoted) return false;
  }
  return true;
}

// Process phase transitions on the server
async function processPhaseTransitions(
  db: Db,
  gameDoc: GameDoc
): Promise<GameState> {
  let state = { ...gameDoc.state };
  const actions = gameDoc.actions || [];
  const rituals = gameDoc.rituals || [];
  const votes = gameDoc.votes || [];
  let stateChanged = false;

  // NIGHT phase logic
  if (state.phase === "NIGHT") {
    const allSubmitted = allNightActionsSubmitted(state, actions, rituals);
    const timerExpired = shouldAutoAdvance(state);

    if (allSubmitted || timerExpired) {
      const currentNightActions = actions.filter((a) => a.nightNumber === state.currentNight);
      const resolution = resolveNightActions(state, currentNightActions);

      let killedRole: Role | undefined;
      if (resolution.killedPlayerId && state.settings?.revealRoleOnDeath) {
        const killedPlayer = state.players.find((p) => p.id === resolution.killedPlayerId);
        killedRole = killedPlayer?.role;
      }

      state = {
        ...state,
        players: resolution.updatedPlayers,
        phase: "DAY",
        phaseStartedAt: Date.now(),
        lastResolution: {
          killedPlayerId: resolution.killedPlayerId,
          savedPlayerId: resolution.savedPlayerId,
          killedRole,
        },
        version: state.version + 1,
        updatedAt: Date.now(),
      };

      // Send inspection results to detectives
      for (const result of resolution.inspectionResults) {
        await db.collection<InboxDoc>("inbox").updateOne(
          { _id: `${state.id}:${result.detectiveId}` },
          {
            $push: {
              messages: {
                type: "INSPECTION_RESULT",
                createdAt: Date.now(),
                payload: {
                  nightNumber: state.currentNight,
                  targetPlayerId: result.targetPlayerId,
                  targetRole: result.targetRole,
                },
              } as any,
            },
            $set: { updatedAt: Date.now() },
          }
        );
      }

      // Check win condition
      const winner = checkWin(state.players);
      if (winner) {
        const revealedRoles: Record<string, Role> = {};
        for (const p of state.players) {
          if (p.role) revealedRoles[p.id] = p.role;
        }
        state = {
          ...state,
          phase: "GAME_OVER",
          status: "COMPLETED",
          winner,
          revealedRoles,
          version: state.version + 1,
          updatedAt: Date.now(),
        };
      }

      stateChanged = true;
    }
  }

  // DAY phase logic
  if (state.phase === "DAY") {
    if (shouldAutoAdvance(state)) {
      const phaseId = `vote-${state.currentNight}-${Date.now()}`;
      state = {
        ...state,
        phase: "VOTING",
        phaseId,
        phaseStartedAt: Date.now(),
        version: state.version + 1,
        updatedAt: Date.now(),
      };
      stateChanged = true;
    }
  }

  // VOTING phase logic
  if (state.phase === "VOTING") {
    const currentPhaseVotes = votes.filter((v) => v.phaseId === state.phaseId);
    const allVoted = allVotesSubmitted(state, votes);
    const timerExpired = shouldAutoAdvance(state);

    if (allVoted || timerExpired) {
      const voteResult = resolveVotes(state, currentPhaseVotes);

      let eliminatedRole: Role | undefined;
      if (voteResult.eliminatedPlayerId && state.settings?.revealRoleOnDeath) {
        const eliminatedPlayer = state.players.find((p) => p.id === voteResult.eliminatedPlayerId);
        eliminatedRole = eliminatedPlayer?.role;
      }

      state = {
        ...state,
        players: voteResult.updatedPlayers,
        lastVoteResult: {
          eliminatedPlayerId: voteResult.eliminatedPlayerId,
          tie: voteResult.tie,
          eliminatedRole,
        },
        version: state.version + 1,
        updatedAt: Date.now(),
      };

      // Check win condition
      const winner = checkWin(state.players);
      if (winner) {
        const revealedRoles: Record<string, Role> = {};
        for (const p of state.players) {
          if (p.role) revealedRoles[p.id] = p.role;
        }
        state = {
          ...state,
          phase: "GAME_OVER",
          status: "COMPLETED",
          winner,
          revealedRoles,
          version: state.version + 1,
          updatedAt: Date.now(),
        };
      } else {
        // Move to next night
        state = {
          ...state,
          phase: "NIGHT",
          currentNight: state.currentNight + 1,
          phaseStartedAt: Date.now(),
          version: state.version + 1,
          updatedAt: Date.now(),
        };
      }

      stateChanged = true;
    }
  }

  // Save state if changed
  if (stateChanged) {
    await db.collection<GameDoc>("games").updateOne(
      { _id: state.id },
      {
        $set: {
          state,
          updatedAt: Date.now(),
        },
      }
    );
  }

  return state;
}

// GET /api/game/state - Get current game state (with auto phase processing)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get("gameId")?.toUpperCase();
    const playerId = searchParams.get("playerId");

    if (!gameId) {
      return NextResponse.json({ error: "gameId required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const gameDoc = await db.collection<GameDoc>("games").findOne({ _id: gameId });
    if (!gameDoc) {
      return NextResponse.json({ error: "game_not_found" }, { status: 404 });
    }

    // Process any pending phase transitions
    const state = await processPhaseTransitions(db, gameDoc);

    // Update player's lastSeenAt if provided
    if (playerId) {
      await db.collection<GameDoc>("games").updateOne(
        { _id: gameId, "state.players.id": playerId },
        { $set: { "state.players.$.lastSeenAt": Date.now() } }
      );
    }

    return NextResponse.json({ state });
  } catch (error: any) {
    console.error("GET /api/game/state error:", error);
    return NextResponse.json(
      { error: "internal_error", message: error?.message },
      { status: 500 }
    );
  }
}
