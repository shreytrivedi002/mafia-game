import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { generateId } from "@/lib/game";
import type { GameState, Player } from "@/lib/types";
import type { GameDoc, InboxDoc } from "@/lib/db-types";

export const dynamic = "force-dynamic";

const DB_NAME = "mafia";

// POST /api/game/join - Join an existing game
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameId, playerName } = body;

    if (!gameId || typeof gameId !== "string") {
      return NextResponse.json({ error: "gameId required" }, { status: 400 });
    }
    if (!playerName || typeof playerName !== "string") {
      return NextResponse.json({ error: "playerName required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    // Get current game state
    const gameDoc = await db.collection<GameDoc>("games").findOne({ _id: gameId.toUpperCase() });
    if (!gameDoc) {
      return NextResponse.json({ error: "game_not_found" }, { status: 404 });
    }

    const state = gameDoc.state;
    if (state.phase !== "LOBBY") {
      return NextResponse.json({ error: "game_already_started" }, { status: 400 });
    }

    // Check if player name already exists
    const nameExists = state.players.some(
      (p) => p.name.toLowerCase() === playerName.trim().toLowerCase()
    );
    if (nameExists) {
      return NextResponse.json({ error: "name_taken" }, { status: 400 });
    }

    const playerId = generateId(8);
    const token = generateId(10);
    const now = Date.now();

    const newPlayer: Player = {
      id: playerId,
      name: playerName.trim(),
      alive: true,
      joinedAt: now,
      lastSeenAt: now,
    };

    // Atomically add player to game
    const result = await db.collection<GameDoc>("games").findOneAndUpdate(
      { _id: gameId.toUpperCase(), "state.phase": "LOBBY" },
      {
        $push: { "state.players": newPlayer as any },
        $inc: { "state.version": 1 },
        $set: { "state.updatedAt": now, updatedAt: now },
      },
      { returnDocument: "after" }
    );

    if (!result) {
      return NextResponse.json({ error: "join_failed" }, { status: 400 });
    }

    // Create inbox for this player
    await db.collection<InboxDoc>("inbox").updateOne(
      { _id: `${gameId.toUpperCase()}:${playerId}` },
      {
        $set: {
          gameId: gameId.toUpperCase(),
          playerId,
          token,
          updatedAt: now,
        },
        $setOnInsert: { messages: [] },
      },
      { upsert: true }
    );

    return NextResponse.json({
      gameId: gameId.toUpperCase(),
      playerId,
      token,
      state: result.state,
    });
  } catch (error: any) {
    console.error("POST /api/game/join error:", error);
    return NextResponse.json(
      { error: "internal_error", message: error?.message },
      { status: 500 }
    );
  }
}
