import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import type { GameState, Player } from "@/lib/types";
import type { GameDoc, InboxDoc } from "@/lib/db-types";

export const dynamic = "force-dynamic";

const DB_NAME = "mafia";

// POST /api/game/restart - Restart game with same players
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameId, playerId, token } = body;

    if (!gameId || !playerId || !token) {
      return NextResponse.json(
        { error: "gameId, playerId, and token required" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    // Verify player token
    const inbox = await db.collection<InboxDoc>("inbox").findOne({
      _id: `${gameId.toUpperCase()}:${playerId}`,
    });
    if (!inbox || inbox.token !== token) {
      return NextResponse.json({ error: "unauthorized" }, { status: 403 });
    }

    // Get current game
    const gameDoc = await db.collection<GameDoc>("games").findOne({ _id: gameId.toUpperCase() });
    if (!gameDoc) {
      return NextResponse.json({ error: "game_not_found" }, { status: 404 });
    }

    const state = gameDoc.state;

    // Can only restart from GAME_OVER
    if (state.phase !== "GAME_OVER") {
      return NextResponse.json(
        { error: "can_only_restart_from_game_over", currentPhase: state.phase },
        { status: 400 }
      );
    }

    const now = Date.now();

    // Reset all players to alive, remove roles
    const resetPlayers: Player[] = state.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: true,
      joinedAt: p.joinedAt,
      lastSeenAt: now,
    }));

    const newState: GameState = {
      id: state.id,
      status: "ACTIVE",
      phase: "LOBBY",
      currentNight: 0,
      phaseStartedAt: now,
      settings: state.settings,
      masterPlayerId: state.masterPlayerId,
      version: state.version + 1,
      players: resetPlayers,
      createdAt: state.createdAt,
      updatedAt: now,
    };

    // Reset game state and clear actions/votes
    await db.collection<GameDoc>("games").updateOne(
      { _id: gameId.toUpperCase() },
      {
        $set: {
          state: newState,
          actions: [],
          rituals: [],
          votes: [],
          updatedAt: now,
        },
      }
    );

    // Send GAME_RESET message to all players
    for (const player of resetPlayers) {
      await db.collection<InboxDoc>("inbox").updateOne(
        { _id: `${gameId.toUpperCase()}:${player.id}` },
        {
          $push: {
            messages: {
              type: "GAME_RESET",
              createdAt: now,
              payload: {},
            } as any,
          },
          $set: { updatedAt: now },
        }
      );
    }

    return NextResponse.json({ state: newState });
  } catch (error: any) {
    console.error("POST /api/game/restart error:", error);
    return NextResponse.json(
      { error: "internal_error", message: error?.message },
      { status: 500 }
    );
  }
}
