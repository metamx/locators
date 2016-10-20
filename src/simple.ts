
import Promise = require("bluebird");

import {Locator, Location, LocatorFactory} from "./common";

const integerRegExp = /^\d+$/;

export interface SimpleLocatorParameters {
  resource : string;
  defaultPort? : number;
}

export class SimpleLocator {
    static getLocatorFactory() : LocatorFactory {
        return function simpleLocator(parameters : string|SimpleLocatorParameters) : Locator {
            let resource : string = null;
            let defaultPort : number = null;

            if (typeof parameters === "string") {
                resource = parameters;
            } else if (parameters) {
                resource = parameters.resource;
                defaultPort = parameters.defaultPort;
            }

            if (!resource) {
                throw new Error("must have resource");
            }


            let locations = resource.split(";").map((locationString) => {
                const prefix = locationString.indexOf('https') === 0 ?
                    'https://' : locationString.indexOf('http') === 0 ? 'http://' : '';

                const temp = locationString.replace(prefix, '');
                const parts = temp.split(":");
                if (parts.length > 2) {
                    throw new Error("invalid resource part '" + temp + "'");
                }
                const location : Location = { host: `${prefix}${parts[0]}` };
                if (parts.length === 2) {
                    if (!integerRegExp.test(parts[1])) {
                        throw new Error("invalid port in resource '" + parts[1] + "'");
                    }
                    location.port = Number(parts[1]);
                } else if (defaultPort) {
                    location.port = defaultPort;
                }

                return location;
            });

            return () => { return Promise.resolve<Location>(locations[Math.floor(Math.random() * locations.length)]); };
        };
    }
}
