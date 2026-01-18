import { NextResponse } from "next/server";
import type { GameState } from "@/lib/types";
import { getState, setState } from "@/lib/relayStore";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gameId = searchParams.get("gameId");
  if (!gameId) {
    return NextResponse.json({ error: "gameId required" }, { status: 400 });
  }

  const state = getState(gameId);
  if (!state) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ state });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { gameId?: string; state?: GameState };
  if (!body.gameId || !body.state) {
    return NextResponse.json({ error: "gameId and state required" }, { status: 400 });
  }

  const current = getState(body.gameId);
  if (current && body.state.version <= current.version) {
    return NextResponse.json({ state: current, ignored: true }, { status: 200 });
  }

  const nextState = {
    ...body.state,
    updatedAt: Date.now(),
  };
  setState(body.gameId, nextState);

  return NextResponse.json({ state: nextState });
}
