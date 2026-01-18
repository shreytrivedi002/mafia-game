import type { GameState, RelayEvent, RelayEventWithIndex, SecretMessage } from "@/lib/types";

type RelayGame = {
  state?: GameState;
  events: Array<RelayEvent & { index: number }>;
  eventIds: Set<string>;
  inbox: Map<string, { token: string; messages: SecretMessage[] }>;
  nextEventIndex: number;
};

const store = new Map<string, RelayGame>();

function getGame(gameId: string): RelayGame {
  const existing = store.get(gameId);
  if (existing) {
    return existing;
  }
  const created: RelayGame = {
    events: [],
    eventIds: new Set(),
    inbox: new Map(),
    nextEventIndex: 1,
  };
  store.set(gameId, created);
  return created;
}

export function getState(gameId: string): GameState | undefined {
  return getGame(gameId).state;
}

export function setState(gameId: string, nextState: GameState): GameState {
  const game = getGame(gameId);
  game.state = nextState;
  return nextState;
}

export function addEvent(gameId: string, event: RelayEvent): number | null {
  const game = getGame(gameId);
  if (game.eventIds.has(event.id)) {
    return null;
  }
  const index = game.nextEventIndex++;
  game.events.push({ ...event, index });
  game.eventIds.add(event.id);

  if (event.type === "JOIN") {
    const { playerId, token } = event.payload;
    if (!game.inbox.has(playerId)) {
      game.inbox.set(playerId, { token, messages: [] });
    }
  }

  return index;
}

export function getEvents(gameId: string, afterIndex: number): RelayEventWithIndex[] {
  const game = getGame(gameId);
  return game.events.filter((event) => event.index > afterIndex);
}

export function pushInboxMessage(
  gameId: string,
  playerId: string,
  message: SecretMessage,
): boolean {
  const game = getGame(gameId);
  const inbox = game.inbox.get(playerId);
  if (!inbox) {
    return false;
  }
  inbox.messages.push(message);
  return true;
}

export function pullInboxMessages(
  gameId: string,
  playerId: string,
  token: string,
): SecretMessage[] | null {
  const game = getGame(gameId);
  const inbox = game.inbox.get(playerId);
  if (!inbox || inbox.token !== token) {
    return null;
  }
  const messages = [...inbox.messages];
  inbox.messages = [];
  return messages;
}
