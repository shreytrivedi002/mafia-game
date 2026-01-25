import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import type { GameSettings } from "@/lib/types";
import type { GameDoc, InboxDoc } from "@/lib/db-types";

export const dynamic = "force-dynamic";

const DB_NAME = "mafia";

// POST /api/game/settings - Update game settings (only in LOBBY)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameId, playerId, token, settings } = body;

    if (!gameId || !playerId || !token) {
      return NextResponse.json(
        { error: "gameId, playerId, and token required" },
        { status: 400 }
      );
    }

    if (!settings || typeof settings !== "object") {
      return NextResponse.json({ error: "settings required" }, { status: 400 });
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

    // Can only change settings in LOBBY
    if (state.phase !== "LOBBY") {
      return NextResponse.json({ error: "game_already_started" }, { status: 400 });
    }

    // Merge settings
    const newSettings: GameSettings = {
      nightSeconds: settings.nightSeconds ?? state.settings.nightSeconds,
      daySeconds: settings.daySeconds ?? state.settings.daySeconds,
      votingSeconds: settings.votingSeconds ?? state.settings.votingSeconds,
      autoAdvance: settings.autoAdvance ?? state.settings.autoAdvance,
      revealRoleOnDeath: settings.revealRoleOnDeath ?? state.settings.revealRoleOnDeath,
    };

    // Validate settings
    if (newSettings.nightSeconds < 10 || newSettings.nightSeconds > 300) {
      return NextResponse.json({ error: "nightSeconds must be 10-300" }, { status: 400 });
    }
    if (newSettings.daySeconds < 10 || newSettings.daySeconds > 600) {
      return NextResponse.json({ error: "daySeconds must be 10-600" }, { status: 400 });
    }
    if (newSettings.votingSeconds < 10 || newSettings.votingSeconds > 300) {
      return NextResponse.json({ error: "votingSeconds must be 10-300" }, { status: 400 });
    }

    // Update settings
    const result = await db.collection<GameDoc>("games").findOneAndUpdate(
      { _id: gameId.toUpperCase(), "state.phase": "LOBBY" },
      {
        $set: {
          "state.settings": newSettings,
          "state.version": state.version + 1,
          "state.updatedAt": Date.now(),
          updatedAt: Date.now(),
        },
      },
      { returnDocument: "after" }
    );

    if (!result) {
      return NextResponse.json({ error: "update_failed" }, { status: 400 });
    }

    return NextResponse.json({ state: result.state });
  } catch (error: any) {
    console.error("POST /api/game/settings error:", error);
    return NextResponse.json(
      { error: "internal_error", message: error?.message },
      { status: 500 }
    );
  }
}
