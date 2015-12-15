
import http = require("http");
import EventEmitterModule = require("events");
import EventEmitter = EventEmitterModule.EventEmitter;
import async = require("async");
import Promise = require("q");
import zookeeper = require("node-zookeeper-client");
import Client = zookeeper.Client;
var Exception = zookeeper.Exception;

import { Location, Locator } from "./common";
import LocatorException = require("./locatorException");


interface ZookeeperJS {
  address : string;
  port : number;
}

export interface DataExtractor {
  (data : string) : Location;
}

class ClientWrapper {
  public client : Client;
  public emitter : EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.client = null;
  }

  public setClient(client : Client) {
    this.client = client;
    this.emitter.emit('NEW_CLIENT');
  }
}

function defaultDataExtractor(data : string) : Location {
  var zkJS : ZookeeperJS;
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

function defaultServerExtractor(data : string) : string[] {
  return JSON.parse(data);
}

// TODO: turn manager into a class
function makeManagerForPath(clientWrapper : ClientWrapper,
                            path : string,
                            emitter : EventEmitter,
                            dataExtractor : DataExtractor,
                            locatorTimeout : number,
                            strict : boolean) : Locator {
  var next = -1;
  var pool : Location[] = null;
  var cachedPool : Location[] = null;
  var queue : Promise.Deferred<Location>[] = [];
  var stale = false;

  function setPool(newPool : Location[]) {
    pool = newPool;
    if (!cachedPool || (newPool && newPool.length)) {
      cachedPool = newPool;
    }
    return;
  }

  function getPool() : Location[] {
    if (strict || (pool && pool.length)) {
      return pool;
    }
    if (cachedPool && cachedPool.length) {
      return cachedPool;
    }
    return pool;
  }

  function dispatch(deferred : Promise.Deferred<Location>) {
    var chosenPool = getPool();
    if (!chosenPool) {
      throw new Error("get next called on loading pool");
    }

    if (chosenPool.length) {
      next++;
      return deferred.resolve(chosenPool[next % chosenPool.length]);
    } else {
      return deferred.reject(new Error(LocatorException.CODE["EMPTY_POOL"]));
    }
  }

  function processQueue() {
    while (queue.length) {
      dispatch(queue.shift());
    }
  }

  function onGetChildren(err : Error, children : string[]) {
    if (err) {
      emitter.emit(LocatorException.CODE["FAILED_TO_GET_CHILDREN"], path, err);
      setPool([]);
      processQueue();
      return;
    }

    var promises = children.map(function (child) {
      var deferred = Promise.defer<Location>();

      clientWrapper.client.getData(path + "/" + child, (_err, data) => {
        if (_err) {
          if (_err.getCode() !== Exception.NO_NODE) {
            emitter.emit(LocatorException.CODE["FAILED_TO_GET_CHILD_INFO"], path, _err);
          }

          deferred.resolve(null);
          return;
        }

        deferred.resolve(dataExtractor(data.toString("utf8")));
        return;
      });
      return deferred.promise;
    });

    Promise.all(promises)
        .then((newPool) => {
          setPool(newPool.filter(Boolean));
          emitter.emit(LocatorException.CODE["NEW_POOL"], path, pool);
          processQueue();
        })
        .done();
  }

  function onChildrenChange(event : Event) {
    emitter.emit(LocatorException.CODE["CHILDREN_CHANGED"], path, event);
    clientWrapper.client.getChildren(path, onChildrenChange, onGetChildren);
  }

  function onExists(error : Error, stat : zookeeper.Stat) {
    if (stat) {
      stale = false;
      emitter.emit(LocatorException.CODE["PATH_FOUND"], path);
      clientWrapper.client.getChildren(path, onChildrenChange, onGetChildren);
    } else {
      stale = true;
      emitter.emit(LocatorException.CODE["PATH_NOT_FOUND"], path);
      setPool([]);
      processQueue();
    }
  }

  clientWrapper.emitter.on('NEW_CLIENT', () => {
    setPool(null);
    clientWrapper.client.exists(path, onExists);
  });

  if (clientWrapper.client) {
    clientWrapper.client.exists(path, onExists);
  }

  return function () {
    var deferred = Promise.defer<Location>();
    if (stale) {
      setPool(null);
      clientWrapper.client.exists(path, onExists);
    }

    if (pool) {
      dispatch(deferred);
    } else {
      queue.push(deferred);
    }

    if (locatorTimeout) {
      setTimeout((() => {
        if (deferred.promise.isPending()) {
          deferred.reject(new Error("ZOOKEEPER_TIMEOUT"));
        }
      }), locatorTimeout);
    }

    return deferred.promise;
  };
}

export interface ZookeeperLocatorParameters {
  serverLocator : Locator;
  path : string;
  dataExtractor? : (data : string) => Location;
  locatorTimeout? : number;
  sessionTimeout? : number;
  spinDelay? : number;
  retries? : number;
  strict? : boolean;
}

export function zookeeperLocatorFactory(parameters : ZookeeperLocatorParameters) : Function {
  var serverLocator = parameters.serverLocator;
  var path = parameters.path;
  var dataExtractor = parameters.dataExtractor;
  var locatorTimeout = parameters.locatorTimeout;
  var sessionTimeout = parameters.sessionTimeout;
  var spinDelay = parameters.spinDelay;
  var retries = parameters.retries;
  var strict = parameters.strict;

  dataExtractor = dataExtractor ? dataExtractor : defaultDataExtractor;
  locatorTimeout = locatorTimeout ? locatorTimeout : 2000;
  sessionTimeout = sessionTimeout ? sessionTimeout : 10000;
  retries = retries ? retries : 0;

  if (!(typeof strict !== 'undefined' && strict !== null)) {
    strict = true;
  }

  var emitter = new EventEmitter();
  var client : zookeeper.Client;
  var clientWrapper = new ClientWrapper();

  var connect = function () {
    serverLocator()
        .then(function (location) {
          var zookeeperServer = location.host;
          if (location.port) {
            zookeeperServer = zookeeperServer + ":" + location.port;
          }
          zookeeperServer = zookeeperServer + path;

          client = zookeeper.createClient(zookeeperServer, {
            sessionTimeout: sessionTimeout,
            spinDelay: spinDelay,
            retries: retries
          });

          clientWrapper.setClient(client);

          var disconnectedHandler : NodeJS.Timer = null; // NodeJS.Timer is coming from the definitely typed.

          client.on("connected", () => {
            emitter.emit(LocatorException.CODE["CONNECTED"]);

            if (disconnectedHandler) {
              clearTimeout(disconnectedHandler);
            }
          });
          client.on("disconnected", (count : number) => {
            emitter.emit(LocatorException.CODE["DISCONNECTED"]);

            disconnectedHandler = setTimeout(
                () => {
                  client.close();

                  // further delaying the emitt of 'expired' event seems to avoid
                  // intermittent errors thrown by node-zookeeper-client
                  setTimeout(() => {
                    client.emit("expired");
                  }, 1000);
                }
                , sessionTimeout);
          });
          client.on('state', (state : Object) => emitter.emit(LocatorException.CODE["STATE_CHANGE"], state, client.getSessionId()));
          client.on("expired", () => {
            emitter.emit(LocatorException.CODE["EXPIRED"]);
            connect();
          });
          emitter.emit(LocatorException.CODE["CONNECTING"]);
          client.connect();
        })
        .catch((err) => {
          emitter.emit(LocatorException.CODE["ZK_LOCATOR_ERROR"], err);
          connect();
        })
        .done();
  };

  connect();

  var pathManager : { [path : string] : Locator } = {};

  function manager(_path : string) : Locator {
    if (typeof _path !== "string") {
      throw new TypeError("path must be a string");
    }
    if (_path[0] !== "/") {
      _path = "/" + _path;
    }
    pathManager[_path] = pathManager[_path] ? pathManager[_path] : makeManagerForPath(
        clientWrapper,
        _path,
        emitter,
        dataExtractor,
        locatorTimeout,
        strict
    );
    return pathManager[_path];
  }

  Object.keys(EventEmitter.prototype).forEach((fnName) =>
          (<any>manager)[fnName] = function () {
            return (<any>emitter)[fnName].apply(emitter, arguments);
          }
  );
  return manager;
}

