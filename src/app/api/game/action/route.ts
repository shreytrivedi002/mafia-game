import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import type { GameState, Action, ActionType } from "@/lib/types";
import type { GameDoc, InboxDoc } from "@/lib/db-types";

export const dynamic = "force-dynamic";

const DB_NAME = "mafia";

// POST /api/game/action - Submit a night action
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameId, playerId, token, actionType, targetPlayerId } = body;

    if (!gameId || !playerId || !token || !actionType || !targetPlayerId) {
      return NextResponse.json(
        { error: "gameId, playerId, token, actionType, and targetPlayerId required" },
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

    // Validate action type matches role
    const role = player.role;
    let validActionType: ActionType | null = null;
    if (role === "MAFIA") validActionType = "KILL";
    else if (role === "DOCTOR") validActionType = "SAVE";
    else if (role === "DETECTIVE") validActionType = "INSPECT";

    if (actionType !== validActionType) {
      return NextResponse.json(
        { error: "invalid_action_for_role", role, actionType },
        { status: 400 }
      );
    }

    // Validate target
    const target = state.players.find((p) => p.id === targetPlayerId);
    if (!target || !target.alive) {
      return NextResponse.json({ error: "invalid_target" }, { status: 400 });
    }

    // Mafia can't kill Mafia
    if (actionType === "KILL" && target.role === "MAFIA") {
      return NextResponse.json({ error: "mafia_cannot_kill_mafia" }, { status: 400 });
    }

    // Check if already submitted action this night
    const existingActions = gameDoc.actions || [];
    const alreadySubmitted = existingActions.some(
      (a) => a.playerId === playerId && a.nightNumber === state.currentNight
    );
    if (alreadySubmitted) {
      return NextResponse.json({ error: "action_already_submitted" }, { status: 400 });
    }

    // Create action
    const action: Action = {
      gameId: gameId.toUpperCase(),
      nightNumber: state.currentNight,
      playerId,
      type: actionType,
      targetPlayerId,
      createdAt: Date.now(),
    };

    // Add action to game
    await db.collection<GameDoc>("games").updateOne(
      { _id: gameId.toUpperCase() },
      {
        $push: { actions: action as any },
        $set: { updatedAt: Date.now() },
      }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("POST /api/game/action error:", error);
    return NextResponse.json(
      { error: "internal_error", message: error?.message },
      { status: 500 }
    );
  }
}
