/// <reference path="../typings/q/Q.d.ts" />
"use strict";
import Promise = require("q");

import Locator = require("./common");

var integerRegExp = /^\d+$/;

export interface SimpleLocatorParameters {
  resource: string;
  defaultPort?: number;
}

export function simpleLocatorFactory(params: SimpleLocatorParameters) {
  function simpleLocator(parameters: string): Locator.Locator;
  function simpleLocator(parameters: SimpleLocatorParameters): Locator.Locator;
  function simpleLocator(parameters: any): Locator.Locator {
    if (typeof parameters === "string") parameters = { resource: parameters };
    var resource: string = parameters.resource;
    var defaultPort: number = parameters.defaultPort;
    if (!resource) throw new Error("must have resource");

    var locations = resource.split(";").map((locationString) => {
      var parts = locationString.split(":");
      if (parts.length > 2) throw new Error("invalid resource part '" + locationString + "'");

      var location: Locator.Location = {
        host: parts[0]
      };
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

    return () => <Promise.Promise<Locator.Location>>Promise(locations[Math.floor(Math.random() * locations.length)])
  }

  return simpleLocator;
}
