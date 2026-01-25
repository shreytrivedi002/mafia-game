import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import type { GameState } from "@/lib/types";
import type { GameDoc, InboxDoc } from "@/lib/db-types";

export const dynamic = "force-dynamic";

const DB_NAME = "mafia";

// POST /api/game/ritual - Submit a night ritual confirmation (for non-action roles)
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

    // Validate phase
    if (state.phase !== "NIGHT") {
      return NextResponse.json({ error: "not_night_phase" }, { status: 400 });
    }

    // Validate player is alive
    const player = state.players.find((p) => p.id === playerId);
    if (!player || !player.alive) {
      return NextResponse.json({ error: "player_not_alive" }, { status: 400 });
    }

    // Only non-action roles can submit rituals
    const role = player.role;
    if (role === "MAFIA" || role === "DOCTOR" || role === "DETECTIVE") {
      return NextResponse.json(
        { error: "action_roles_cannot_submit_ritual" },
        { status: 400 }
      );
    }

    // Check if already submitted ritual this night
    const existingRituals = gameDoc.rituals || [];
    const alreadySubmitted = existingRituals.some(
      (r) => r.playerId === playerId && r.nightNumber === state.currentNight
    );
    if (alreadySubmitted) {
      return NextResponse.json({ error: "ritual_already_submitted" }, { status: 400 });
    }

    // Add ritual confirmation
    await db.collection<GameDoc>("games").updateOne(
      { _id: gameId.toUpperCase() },
      {
        $push: {
          rituals: {
            playerId,
            nightNumber: state.currentNight,
            createdAt: Date.now(),
          } as any,
        },
        $set: { updatedAt: Date.now() },
      }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("POST /api/game/ritual error:", error);
    return NextResponse.json(
      { error: "internal_error", message: error?.message },
      { status: 500 }
    );
  }
}
