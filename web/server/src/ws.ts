import type { FastifyInstance } from 'fastify';
import type { ClientMessage, RoomTokenPayload, ServerMessage } from 'shared';
import { fetchRoomGuardState } from './utils/roomGuard.js';
import { removeSocket, broadcast } from './broadcast.js';
import { recordPolo } from './marcopolo.js';
import { handleAuth } from './operations/auth.js';
import { handleUpdateNodePositions } from './operations/update_node_positions.js';
import { handleRotateZone } from './operations/rotate_zone.js';
import { handleUpdatePlotRoute } from './operations/update_plot_route.js';
import { handleCreateConnection } from './operations/create_connection.js';


export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/ws/rooms/:id',
    { websocket: true },
    (socket, request) => {
      const roomId = (request.params as { id: string }).id;
      let authenticated = false;
      let sessionToken: string | null = null;

      const send = (msg: ServerMessage) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(msg));
        }
      };

      /**
       * Verifies that the stored session token is still valid and belongs to
       * this room, returning its payload (or null after sending
       * `session_expired` and closing the socket with 4401).
       */
      const verifySessionPayload = (): RoomTokenPayload | null => {
        try {
          const payload = app.jwt.verify(sessionToken!) as RoomTokenPayload;
          if (payload.roomId !== roomId) {
            send({ type: 'session_expired', reason: 'Session expired, please log in again' });
            socket.close(4401, 'Session expired');
            return null;
          }
          return payload;
        } catch {
          send({ type: 'session_expired', reason: 'Session expired, please log in again' });
          socket.close(4401, 'Session expired');
          return null;
        }
      };

      const verifySession = (): boolean => verifySessionPayload() !== null;

      /**
       * Write gate for every mutating WS operation: the session must be valid
       * AND, when the room is locked, the token must carry the admin role.
       * Read-only viewers keep their socket open (they still receive
       * broadcasts) and just get an error message back.
       */
      const verifyWriteAccess = async (): Promise<boolean> => {
        const payload = verifySessionPayload();
        if (!payload) return false;
        const guard = await fetchRoomGuardState(app.db, roomId);
        if (guard?.locked && payload.role !== 'admin') {
          send({ type: 'error', message: 'Room is locked' });
          return false;
        }
        return true;
      };

      const authTimeout = setTimeout(() => {
        if (!authenticated) {
          socket.close(4401, 'Authentication required');
        }
      }, 10_000);

      socket.on('message', async (rawData) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(rawData.toString()) as ClientMessage;
        } catch {
          send({ type: 'error', message: 'Invalid JSON' });
          return;
        }

        const ctx = {
          app,
          socket,
          roomId,
          authenticated,
          setAuthenticated: (val: boolean) => { authenticated = val; },
          sessionToken,
          setSessionToken: (val: string | null) => { sessionToken = val; },
          verifySession,
          verifyWriteAccess,
          send,
          authTimeout,
        } as const;

        switch (msg.type) {
          case 'ping':
            broadcast(ctx.roomId, { type: 'ping', zoneName: (msg as any).zoneName, nodeId: (msg as any).nodeId });
            return;
          case 'polo':
            if (authenticated) recordPolo(socket);
            return;
          case 'auth':
            await handleAuth(ctx, msg as any);
            return;
          case 'update_node_positions':
            await handleUpdateNodePositions(ctx, msg as any);
            return;
          case 'rotate_zone':
            await handleRotateZone(ctx, msg as any);
            return;
          case 'update_plot_route':
            await handleUpdatePlotRoute(ctx, msg as any);
            return;
          case 'create_connection':
            await handleCreateConnection(ctx, msg as any);
            return;
        }

        if (!authenticated) {
          socket.close(4401, 'Not authenticated');
        }
      });

      socket.on('close', () => {
        clearTimeout(authTimeout);
        if (authenticated) {
          removeSocket(roomId, socket);
        }
      });

      socket.on('error', () => {
        clearTimeout(authTimeout);
        if (authenticated) {
          removeSocket(roomId, socket);
        }
      });
    },
  );
}

export { broadcast };
