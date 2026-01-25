import { NextResponse } from "next/server";
import type { SecretMessage } from "@/lib/types";
import { pullInboxMessages, pushInboxMessage } from "@/lib/relayStore";

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/mongodb(\+srv)?:\/\/[^ \n)]+/gi, "mongodb://***")
    .slice(0, 300);
}

function requestId(): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return (globalThis.crypto as any)?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get("gameId");
    const playerId = searchParams.get("playerId");
    const token = searchParams.get("token");

    if (!gameId || !playerId || !token) {
      return NextResponse.json({ error: "gameId, playerId, token required" }, { status: 400 });
    }

    const messages = await pullInboxMessages(gameId, playerId, token);
    if (!messages) {
      return NextResponse.json({ error: "unauthorized" }, { status: 403 });
    }

    return NextResponse.json({ messages });
  } catch (error) {
    const id = requestId();
    console.error(`[${id}] GET /api/relay/inbox error:`, error);
    const err = error as any;
    const message =
      typeof err?.message === "string" ? sanitizeErrorMessage(err.message) : "unknown_error";
    return NextResponse.json(
      { error: "internal_error", requestId: id, details: { name: err?.name, code: err?.code, message } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      gameId?: string;
      playerId?: string;
      message?: SecretMessage;
    };
    if (!body.gameId || !body.playerId || !body.message) {
      return NextResponse.json({ error: "gameId, playerId, message required" }, { status: 400 });
    }

    const pushed = await pushInboxMessage(body.gameId, body.playerId, body.message);
    if (!pushed) {
      return NextResponse.json({ error: "player_not_registered" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const id = requestId();
    console.error(`[${id}] POST /api/relay/inbox error:`, error);
    const err = error as any;
    const message =
      typeof err?.message === "string" ? sanitizeErrorMessage(err.message) : "unknown_error";
    return NextResponse.json(
      { error: "internal_error", requestId: id, details: { name: err?.name, code: err?.code, message } },
      { status: 500 },
    );
  }
}
