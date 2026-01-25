import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";
import type { InboxDoc } from "@/lib/db-types";

export const dynamic = "force-dynamic";

const DB_NAME = "mafia";

// GET /api/game/inbox - Get and clear inbox messages
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get("gameId")?.toUpperCase();
    const playerId = searchParams.get("playerId");
    const token = searchParams.get("token");

    if (!gameId || !playerId || !token) {
      return NextResponse.json(
        { error: "gameId, playerId, and token required" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db(DB_NAME);

    // Find inbox
    const inbox = await db.collection<InboxDoc>("inbox").findOne({
      _id: `${gameId}:${playerId}`,
    });

    if (!inbox) {
      return NextResponse.json({ messages: [] });
    }

    if (inbox.token !== token) {
      return NextResponse.json({ error: "unauthorized" }, { status: 403 });
    }

    // Get messages and clear them
    const messages = [...inbox.messages];

    if (messages.length > 0) {
      await db.collection<InboxDoc>("inbox").updateOne(
        { _id: `${gameId}:${playerId}` },
        {
          $set: { messages: [], updatedAt: Date.now() },
        }
      );
    }

    return NextResponse.json({ messages });
  } catch (error: any) {
    console.error("GET /api/game/inbox error:", error);
    return NextResponse.json(
      { error: "internal_error", message: error?.message },
      { status: 500 }
    );
  }
}
