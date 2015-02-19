/// <reference path="../typings/node/node.d.ts" />
/// <reference path="../typings/async/async.d.ts" />
/// <reference path="../typings/node-zookeeper-client/node-zookeeper-client.d.ts" />
"use strict";

import http = require("http")
import EventEmitterModule = require("events")
import EventEmitter = EventEmitterModule.EventEmitter

import async = require("async");

import zookeeper = require("node-zookeeper-client");
import Client = zookeeper.Client;
var Exception = zookeeper.Exception;

import Locator = require("./common");

var debug = false;

interface ZookeeperJS {
  address: string;
  port: number;
}

export interface DataExtractor {
  (data: string): Locator.Location;
}

class ClientWrapper {
  public client: Client;
  public emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.client = null;
  }

  public setClient(client: Client) {
    this.client = client;
    this.emitter.emit('new_client');
  }
}

function defaultDataExtractor(data: string): Locator.Location {
  var zkJS: ZookeeperJS;
  try {
    zkJS = JSON.parse(data);
  } catch (e) {
    return null;
  }

  if (!zkJS.address || !zkJS.port) {
    return null;
  }

  return {
    host: zkJS.address,
    port: zkJS.port
  };
}

function defaultServerExtractor(data: string): string[] {
  return JSON.parse(data);
}

function makeManagerForPath(clientWrapper: ClientWrapper, path: string, emitter: EventEmitter, dataExtractor: DataExtractor, locatorTimeout: number): Locator.FacetLocator {
  var next = -1;
  var pool: Locator.Location[] = null;
  var queue: Locator.Callback[] = [];

  function dispatch(callback: Locator.Callback) {
    if (!pool) {
      throw new Error("get next called on loading pool");
    }
    if (pool.length) {
      next++;
      return callback(null, pool[next % pool.length]);
    } else {
      return callback(new Error("Empty pool"));
    }
  }

  function processQueue() {
    while (queue.length) {
      dispatch(queue.shift());
    }
  }

  function onGetChildren(err: Error, children: string[]) {
    if (err) {
      if (debug) {
        console.log("Failed to list children of %s due to: %s.", path, err);
      }
      emitter.emit("childListFail", path, err);
      pool = [];
      processQueue();
      return;
    }

    async.map(children, (child, callback) => clientWrapper.client.getData(path + "/" + child, (err, data) => {
      if (err) {
        if (err.getCode() === Exception.NO_NODE) {
          callback(null, null);
        } else {
          emitter.emit("nodeDataFail", path, err);
          callback(null, null);
        }
        return;
      }

      return callback(null, dataExtractor(data.toString("utf8")));
    }), (err: Error, newPool: Locator.Location[]) => {
      pool = newPool.filter(Boolean);
      emitter.emit("newPool", path, pool);
      processQueue();
    });
  }

  function onChange(event: Event) {
    if (debug) {
      console.log("Got watcher event: %s", event);
    }
    emitter.emit("change", path, event);
    clientWrapper.client.getChildren(path, onChange, onGetChildren);
  }

  clientWrapper.emitter.on('new_client', function () {
    pool = null;
    clientWrapper.client.getChildren(path, onChange, onGetChildren);
  });

  return (callback) => {
    if (pool) {
      dispatch(callback);
      return;
    }

    queue.push(callback);

    if (locatorTimeout) {
      setTimeout((() => {
        if (queue.indexOf(callback) < 0) {
          return;
        }
        queue = queue.filter((c) => c !== callback);
        return callback(new Error("Timeout"));
      }), locatorTimeout);
    }
  };
}

export interface ZookeeperLocatorParameters {
  exhibitorUrl: string;
  dataExtractor: (data: string) => Locator.Location;
  serverExtractor: (data: string) => string[];
  locatorTimeout: number;
  sessionTimeout: number;
  spinDelay: number;
  retries: number;
}

export function zookeeperLocatorFactory(parameters: ZookeeperLocatorParameters): Function {
  if (!parameters.exhibitorUrl) {
    throw new Error("need only one exhibitor url");
  }

  var exhibitorUrl = parameters.exhibitorUrl;
  var dataExtractor = parameters.dataExtractor;
  var serverExtractor = parameters.serverExtractor;
  var locatorTimeout = parameters.locatorTimeout;
  var sessionTimeout = parameters.sessionTimeout;
  var spinDelay = parameters.spinDelay;
  var retries = parameters.retries;

  serverExtractor || (serverExtractor = defaultServerExtractor);
  dataExtractor || (dataExtractor = defaultDataExtractor);
  locatorTimeout || (locatorTimeout = 2000);

  var emitter = new EventEmitter();
  var client: zookeeper.Client;
  var clientWrapper = new ClientWrapper();
  var connect = function () {
    http.get(exhibitorUrl, function(res: http.ClientResponse) {
      var output: string[] = [];
      res.setEncoding('utf8');

      res.on('data', function (chunk: string) {
        output.push(chunk);
      });

      res.on('end', function () {
        client = zookeeper.createClient(serverExtractor(output.join('')).join(','), {
          sessionTimeout: sessionTimeout,
          spinDelay: spinDelay,
          retries: retries
        });

        clientWrapper.setClient(client);

        client.on("connected", () => emitter.emit("connected"));
        client.on("disconnected", () => emitter.emit("disconnected"));
        client.on('state', (state: Object) => emitter.emit('state', state, client.getSessionId()));
        client.on("expired", function () {
          emitter.emit("expired");
          connect();
        });
        emitter.emit('connecting');
        client.connect();
      });
    }).on('error', function () {
      emitter.emit("exhibitor_error");
      connect();
    });
  };

  connect();

  var pathManager: { [path: string]: Locator.FacetLocator } = {};
  function manager(path: string): Locator.FacetLocator {
    if (typeof path !== "string") {
      throw new TypeError("path must be a string");
    }
    if (path[0] !== "/") path = "/" + path;
    pathManager[path] || (pathManager[path] = makeManagerForPath(clientWrapper, path, emitter, dataExtractor, locatorTimeout));
    return pathManager[path];
  }

  Object.keys(EventEmitter.prototype).forEach((fnName) =>
    (<any>manager)[fnName] = function() {
      return (<any>emitter)[fnName].apply(emitter, arguments);
    }
  );
  return manager;
}
