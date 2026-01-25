import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import type { Vote } from "@/lib/types";
import type { GameDoc, InboxDoc } from "@/lib/db-types";

export const dynamic = "force-dynamic";

const DB_NAME = "mafia";

// POST /api/game/vote - Submit a vote
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameId, playerId, token, targetPlayerId } = body;

    if (!gameId || !playerId || !token || !targetPlayerId) {
      return NextResponse.json(
        { error: "gameId, playerId, token, and targetPlayerId required" },
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
    if (state.phase !== "VOTING") {
      return NextResponse.json({ error: "not_voting_phase" }, { status: 400 });
    }

    // Validate voter is alive
    const voter = state.players.find((p) => p.id === playerId);
    if (!voter || !voter.alive) {
      return NextResponse.json({ error: "voter_not_alive" }, { status: 400 });
    }

    // Validate target is alive
    const target = state.players.find((p) => p.id === targetPlayerId);
    if (!target || !target.alive) {
      return NextResponse.json({ error: "invalid_target" }, { status: 400 });
    }

    // Check if already voted this phase
    const existingVotes = gameDoc.votes || [];
    const alreadyVoted = existingVotes.some(
      (v) => v.voterId === playerId && v.phaseId === state.phaseId
    );
    if (alreadyVoted) {
      return NextResponse.json({ error: "already_voted" }, { status: 400 });
    }

    // Create vote
    const vote: Vote = {
      gameId: gameId.toUpperCase(),
      phaseId: state.phaseId || `vote-${state.currentNight}`,
      voterId: playerId,
      targetPlayerId,
      createdAt: Date.now(),
    };

    // Add vote to game
    await db.collection<GameDoc>("games").updateOne(
      { _id: gameId.toUpperCase() },
      {
        $push: { votes: vote as any },
        $set: { updatedAt: Date.now() },
      }
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("POST /api/game/vote error:", error);
    return NextResponse.json(
      { error: "internal_error", message: error?.message },
      { status: 500 }
    );
  }
}
