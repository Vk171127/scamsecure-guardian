export const GATEWAY_HTTP: string =
  import.meta.env.VITE_GATEWAY_HTTP_URL ?? "http://127.0.0.1:8000";
export const GATEWAY_WS: string =
  import.meta.env.VITE_GATEWAY_WS_URL ?? "ws://127.0.0.1:8000/v1/ws";
export const E2E: boolean = import.meta.env.VITE_E2E === "1";
export const DECISION_TIMEOUT_MS: number = Number(
  import.meta.env.VITE_DECISION_TIMEOUT_MS ?? 400,
);
