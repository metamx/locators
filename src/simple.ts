"use strict";

import Locator = require("./common");

var integerRegExp = /^\d+$/;

export interface SimpleLocatorParameters {
  resource: string;
  defaultPort?: number;
}

export function simpleLocatorFactory(parameters: SimpleLocatorParameters) {
  if (typeof parameters === "string") parameters = { resource: parameters };
  var resource = parameters.resource;
  if (!resource) throw new Error("must have resource");

  var defaultPort = parameters.defaultPort;
  var locatorTimeout, sessionTimeout, spinDelay, retries; // to be included?

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

  return (callback) => {
    callback(null, locations[Math.floor(Math.random() * locations.length)]);
  };
}
