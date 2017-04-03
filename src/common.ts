import {EventEmitter} from 'events';
import Promise = require("bluebird");

export type DataExtractor = (data : string) => any;

export type LocatorFactory = (parameters : any) => Locator;

export interface Locator {
    () : Promise<Location>;
}

export interface LocatorEmitter extends Locator, EventEmitter { }

export interface Location {
    host : string;
    port? : number;
}

export interface ReturnedLocation {
    address : string;
    port : number;
}
