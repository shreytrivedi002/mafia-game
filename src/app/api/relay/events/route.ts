import { NextResponse } from "next/server";
import type { RelayEvent } from "@/lib/types";
import { addEvent, getEvents } from "@/lib/relayStore";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gameId = searchParams.get("gameId");
  const after = Number(searchParams.get("after") ?? "0");
  if (!gameId) {
    return NextResponse.json({ error: "gameId required" }, { status: 400 });
  }

  const events = getEvents(gameId, Number.isNaN(after) ? 0 : after);
  return NextResponse.json({ events });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { gameId?: string; event?: RelayEvent };
  if (!body.gameId || !body.event) {
    return NextResponse.json({ error: "gameId and event required" }, { status: 400 });
  }

  const index = addEvent(body.gameId, body.event);
  if (index === null) {
    return NextResponse.json({ duplicated: true }, { status: 200 });
  }

  return NextResponse.json({ index });
}
