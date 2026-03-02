import { useCallback, useEffect, useRef, useState } from "react";
import { buildWsUrl } from "../lib/api";
import { seedMessage } from "../lib/seeding";

export function useSeedingSocket(address, roundId, options = {}) {
  const {
    enabled = false,
    nodeId = 0,
    signMessageAsync,
    onAlive,
    onStatus,
    onError,
    wsUrl
  } = options;

  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const sessionRef = useRef("");
  const manualStopRef = useRef(false);
  const callbacksRef = useRef({
    onAlive,
    onStatus,
    onError,
    signMessageAsync
  });
  const [isSeeding, setIsSeeding] = useState(false);

  useEffect(() => {
    callbacksRef.current = {
      onAlive,
      onStatus,
      onError,
      signMessageAsync
    };
  }, [onAlive, onStatus, onError, signMessageAsync]);

  const emitStatus = useCallback((message) => {
    callbacksRef.current.onStatus?.(message);
  }, []);

  const emitError = useCallback((message) => {
    callbacksRef.current.onError?.(message);
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const closeSocket = useCallback(
    (sendStopMessage = false) => {
      clearReconnectTimer();
      const socket = socketRef.current;
      socketRef.current = null;

      if (!socket) {
        return;
      }

      if (sendStopMessage && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ type: "seed-stop" }));
        } catch {
          // no-op
        }
      }

      try {
        socket.close();
      } catch {
        // no-op
      }
    },
    [clearReconnectTimer]
  );

  const scheduleReconnect = useCallback(
    (connect) => {
      if (reconnectTimerRef.current) {
        return;
      }

      reconnectAttemptRef.current += 1;
      const waitMs = Math.min(5000, 1200 + reconnectAttemptRef.current * 550);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, waitMs);
    },
    []
  );

  const connect = useCallback(() => {
    if (!enabled || !address || !nodeId || !Number.isInteger(roundId)) {
      return;
    }
    if (socketRef.current) {
      return;
    }

    const targetUrl = wsUrl || buildWsUrl();
    let socket;
    try {
      socket = new WebSocket(targetUrl);
    } catch {
      emitError("Failed to initialize seeding socket");
      return;
    }

    socketRef.current = socket;
    emitStatus(`Node ${nodeId}: waiting for seeding challenge...`);

    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
    };

    socket.onmessage = async (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (payload.type === "challenge") {
        try {
          if (!callbacksRef.current.signMessageAsync) {
            throw new Error("Wallet signature function unavailable");
          }
          const nonce = payload.nonce;
          const signature = await callbacksRef.current.signMessageAsync({
            message: seedMessage(nonce)
          });

          if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
            return;
          }

          socketRef.current.send(
            JSON.stringify({
              type: "seed-auth",
              nonce,
              wallet: address,
              node: nodeId,
              signature
            })
          );
        } catch (signError) {
          emitError(signError.message || "Seeding authorization failed");
          manualStopRef.current = true;
          closeSocket(true);
          setIsSeeding(false);
        }
        return;
      }

      if (payload.type === "seed-ack") {
        setIsSeeding(true);
        emitStatus(`Node ${nodeId}: seeding active`);
        return;
      }

      if (payload.type === "seed-revoked") {
        setIsSeeding(false);
        emitStatus(payload.message || "Seeder session replaced");
        manualStopRef.current = true;
        closeSocket(false);
        return;
      }

      if (payload.type === "alive") {
        callbacksRef.current.onAlive?.(payload);
        return;
      }

      if (payload.type === "error") {
        setIsSeeding(false);
        emitError(payload.message || "Seeding socket error");
      }
    };

    socket.onclose = () => {
      socketRef.current = null;
      setIsSeeding(false);
      if (!manualStopRef.current && enabled && address && nodeId) {
        scheduleReconnect(connect);
      }
    };

    socket.onerror = () => {
      emitError("Seeding socket connection error");
    };
  }, [
    address,
    closeSocket,
    emitError,
    emitStatus,
    enabled,
    nodeId,
    roundId,
    scheduleReconnect,
    wsUrl
  ]);

  useEffect(() => {
    if (!enabled || !address || !nodeId || !Number.isInteger(roundId)) {
      manualStopRef.current = true;
      closeSocket(true);
      setIsSeeding(false);
      sessionRef.current = "";
      return;
    }

    manualStopRef.current = false;
    const nextSession = `${address.toLowerCase()}:${roundId}:${nodeId}`;
    if (sessionRef.current !== nextSession) {
      sessionRef.current = nextSession;
      closeSocket(true);
      connect();
      return;
    }

    if (!socketRef.current) {
      connect();
    }
  }, [address, closeSocket, connect, enabled, nodeId, roundId]);

  useEffect(() => {
    return () => {
      manualStopRef.current = true;
      closeSocket(true);
      setIsSeeding(false);
    };
  }, [closeSocket]);

  const stopSeeding = useCallback(() => {
    manualStopRef.current = true;
    closeSocket(true);
    setIsSeeding(false);
  }, [closeSocket]);

  return {
    isSeeding,
    stopSeeding
  };
}
