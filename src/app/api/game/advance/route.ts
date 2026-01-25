import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import type { GameState } from "@/lib/types";
import type { GameDoc, InboxDoc } from "@/lib/db-types";

export const dynamic = "force-dynamic";

const DB_NAME = "mafia";

// POST /api/game/advance - Manually advance phase (DAY -> VOTING)
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

    // Can only manually advance from DAY to VOTING
    if (state.phase !== "DAY") {
      return NextResponse.json(
        { error: "can_only_advance_from_day", currentPhase: state.phase },
        { status: 400 }
      );
    }

    const phaseId = `vote-${state.currentNight}-${Date.now()}`;
    const now = Date.now();

    const newState: GameState = {
      ...state,
      phase: "VOTING",
      phaseId,
      phaseStartedAt: now,
      version: state.version + 1,
      updatedAt: now,
    };

    await db.collection<GameDoc>("games").updateOne(
      { _id: gameId.toUpperCase() },
      {
        $set: {
          state: newState,
          updatedAt: now,
        },
      }
    );

    return NextResponse.json({ state: newState });
  } catch (error: any) {
    console.error("POST /api/game/advance error:", error);
    return NextResponse.json(
      { error: "internal_error", message: error?.message },
      { status: 500 }
    );
  }
}
