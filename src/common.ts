/// <reference path="../typings/q/Q.d.ts" />
"use strict";

import Q = require("q");

declare module Locator {
  interface Location {
    host: string;
    port?: number;
  }

  interface ReturnedLocation {
    address: string;
    port: number;
  }

  interface DataExtractor {
    (data: string): Locator.Location;
  }

  interface Locator {
    (): Q.Promise<Location>;

    // Event emitter extension
    addListener?(event: string, listener: Function): any;
    on?(event: string, listener: Function): any;
    once?(event: string, listener: Function): any;
    removeListener?(event: string, listener: Function): any;
    removeAllListeners?(event?: string): any;
    setMaxListeners?(n: number): void;
    listeners?(event: string): Function[];
    emit?(event: string, ...args: any[]): boolean;
  }
}
export = Locator;
