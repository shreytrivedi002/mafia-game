import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { assignRoles } from "@/lib/game";
import type { GameState } from "@/lib/types";
import type { GameDoc, InboxDoc } from "@/lib/db-types";

export const dynamic = "force-dynamic";

const DB_NAME = "mafia";
const MIN_PLAYERS = 4;

// POST /api/game/start - Start the game (assign roles, move to NIGHT)
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

    if (state.phase !== "LOBBY") {
      return NextResponse.json({ error: "game_already_started" }, { status: 400 });
    }

    if (state.players.length < MIN_PLAYERS) {
      return NextResponse.json(
        { error: "not_enough_players", required: MIN_PLAYERS, current: state.players.length },
        { status: 400 }
      );
    }

    // Assign roles
    const playersWithRoles = assignRoles(state.players);
    const now = Date.now();

    const newState: GameState = {
      ...state,
      players: playersWithRoles,
      phase: "NIGHT",
      currentNight: 1,
      phaseStartedAt: now,
      version: state.version + 1,
      updatedAt: now,
    };

    // Update game state and clear actions/votes for fresh start
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

    // Send role assignments to all players
    for (const player of playersWithRoles) {
      if (player.role) {
        await db.collection<InboxDoc>("inbox").updateOne(
          { _id: `${gameId.toUpperCase()}:${player.id}` },
          {
            $push: {
              messages: {
                type: "ROLE_ASSIGNMENT",
                createdAt: now,
                payload: { role: player.role },
              } as any,
            },
            $set: { updatedAt: now },
          }
        );
      }
    }

    return NextResponse.json({ state: newState });
  } catch (error: any) {
    console.error("POST /api/game/start error:", error);
    return NextResponse.json(
      { error: "internal_error", message: error?.message },
      { status: 500 }
    );
  }
}
