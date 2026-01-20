import { NextResponse } from "next/server";
import type { RelayEvent, RelayEventWithIndex } from "@/lib/types";
import { addEvent, getEvents } from "@/lib/relayStore";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get("gameId");
    const after = Number(searchParams.get("after") ?? "0");
    if (!gameId) {
      return NextResponse.json({ error: "gameId required" }, { status: 400 });
    }

    const events = await getEvents(gameId, Number.isNaN(after) ? 0 : after);
    return NextResponse.json({ events });
  } catch (error) {
    console.error("GET /api/relay/events error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { gameId?: string; event?: RelayEvent };
    if (!body.gameId || !body.event) {
      return NextResponse.json({ error: "gameId and event required" }, { status: 400 });
    }

    const index = await addEvent(body.gameId, body.event);
    if (index === null) {
      return NextResponse.json({ duplicated: true }, { status: 200 });
    }

    return NextResponse.json({ index });
  } catch (error) {
    console.error("POST /api/relay/events error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
