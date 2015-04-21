"use strict";

export var CODE: { [key: string]: string } = {
  BAD_RESPONSE: "bad response",
  ZK_LOCATOR_ERROR: "failed to find zookeeper",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  STATE_CHANGE: "state",
  EXPIRED: "expired",
  CONNECTING: "connecting",
};

export function create(code: string): Error {
  return new Error(CODE[code]);
}
