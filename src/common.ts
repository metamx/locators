
import Q = require("q");

export interface Location {
  host: string;
  port?: number;
}


export interface ReturnedLocation {
  address: string;
  port: number;
}

export interface DataExtractor {
  (data: string): any;
}

export interface Locator {
  (): Q.Promise<any>;

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
