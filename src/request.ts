/// <reference path="../typings/node/node.d.ts" />
/// <reference path="../typings/q/Q.d.ts" />
"use strict";

import Promise = require("q");
import http = require("http");
import https = require("https");

import Locator = require("./common");
import Location = Locator.Location;
import LocatorException = require("./locatorException");

export interface RequestLocatorParameters {
  url: string;
  dataExtractor?: Locator.DataExtractor;
}

function defaultDataExtractor(data: string): Location {
  var locations: Locator.ReturnedLocation[];
  try {
    locations = JSON.parse(data).servers;
  } catch (e) {
    return null;
  }

  if (!locations) return null;

  var location = locations[Math.floor(Math.random() * locations.length)];

  return {
    host: location.address,
    port: location.port
  };
}

export function requestLocatorFactory(): Function {
  function resourceLocator(parameters: string): Locator.Locator;
  function resourceLocator(parameters: RequestLocatorParameters): Locator.Locator;
  function resourceLocator(parameters: any): Locator.Locator {
    if (typeof parameters === "string") parameters = { url: parameters };
    var url: string = parameters.url;
    var request: any;
    if (url.indexOf('http://') === 0) {
      request = http;
    } else if (url.indexOf('https://') === 0) {
      request = https;
    } else {
      throw new Error(`invalid url: ${url}`);
    }

    var dataExtractor: Locator.DataExtractor = parameters.dataExtractor;
    dataExtractor || (dataExtractor = defaultDataExtractor);

    if (!url) throw new Error("must have resource");

    var deferred = <Promise.Deferred<Location>>Promise.defer();

    request.get(url, function(res: http.ClientResponse) {
      var output: string[] = [];
      res.setEncoding('utf8');

      res.on('data', function (chunk: string) {
        output.push(chunk);
      });

      res.on('end', function () {
        if (200 <= res.statusCode && res.statusCode < 300) {
          var result = output.join('');
          deferred.resolve(dataExtractor(result));
        } else {
          deferred.reject(LocatorException.create("BAD_RESPONSE"));
        }
      });
    }).on('error', function (err: Error) {
      deferred.reject(err);
    });

    return () => deferred.promise;
  }

  return resourceLocator;
}
