declare module Locator {
    interface Location {
        host: string;
        port?: number;
    }
    interface Callback {
        (err: Error, location?: Location): void;
    }
    interface FacetLocator {
        (fn: Callback): void;
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
