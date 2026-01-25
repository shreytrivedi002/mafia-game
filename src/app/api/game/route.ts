import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import { generateId } from "@/lib/game";
import type { GameState, Player } from "@/lib/types";
import type { GameDoc, InboxDoc } from "@/lib/db-types";

export const dynamic = "force-dynamic";

const DB_NAME = "mafia";

// POST /api/game - Create a new game
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { playerName } = body;

    if (!playerName || typeof playerName !== "string") {
      return NextResponse.json({ error: "playerName required" }, { status: 400 });
    }

    const gameId = generateId(6);
    const playerId = generateId(8);
    const token = generateId(10);
    const now = Date.now();

    const player: Player = {
      id: playerId,
      name: playerName.trim(),
      alive: true,
      joinedAt: now,
      lastSeenAt: now,
    };

    const state: GameState = {
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
      masterPlayerId: playerId,
      version: 1,
      players: [player],
      createdAt: now,
      updatedAt: now,
    };

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    const gameDoc: GameDoc = {
      _id: gameId,
      gameId: gameId,
      state,
      actions: [],
      rituals: [],
      votes: [],
      nextEventIndex: 1,
      updatedAt: now,
    };

    await db.collection<GameDoc>("games").insertOne(gameDoc);

    const inboxDoc: InboxDoc = {
      _id: `${gameId}:${playerId}`,
      gameId,
      playerId,
      token,
      messages: [],
      updatedAt: now,
    };

    await db.collection<InboxDoc>("inbox").insertOne(inboxDoc);

    return NextResponse.json({
      gameId,
      playerId,
      token,
      state,
    });
  } catch (error: any) {
    console.error("POST /api/game error:", error);
    return NextResponse.json(
      { error: "internal_error", message: error?.message },
      { status: 500 }
    );
  }
}
