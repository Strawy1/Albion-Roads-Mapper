import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from 'shared';

export interface OperationContext {
  app: FastifyInstance;
  socket: WebSocket;
  roomId: string;
  authenticated: boolean;
  setAuthenticated: (val: boolean) => void;
  sessionToken: string | null;
  setSessionToken: (val: string | null) => void;
  verifySession: () => boolean;
  verifyWriteAccess: () => Promise<boolean>;
  send: (msg: ServerMessage) => void;
  authTimeout: NodeJS.Timeout;
}

export type OperationHandler<T extends ClientMessage> = (
  ctx: OperationContext,
  msg: T
) => Promise<void> | void;
