import {EventEmitter} from "events";
import http = require("http");
import zookeeper = require("node-zookeeper-client");
import Promise = require("bluebird");

import {Location, Locator, LocatorEmitter, LocatorFactory, DataExtractor} from "./common";
import LocatorException = require("./locatorException");

function deferredLocationRequest() : Promise.Resolver<Location> {
    var resolve, reject;
    var promise = new Promise<Location>(function() {
        resolve = arguments[0];
        reject = arguments[1];
    });
    return {
        resolve: resolve,
        reject: reject,
        promise: promise,
        callback: null
    };
}

interface ZookeeperJS {
    address : string;
    port : number;
}

export interface ZookeeperLocatorParameters {
    serverLocator : Locator;
    path : string;
    dataExtractor? : DataExtractor;
    locatorTimeout? : number;
    sessionTimeout? : number;
    spinDelay? : number;
    retries? : number;
    strict? : boolean;
}


export class ZookeeperLocator {

    private static manager : ZookeeperLocatorFatory;

    static getLocatorFactory(parameters : ZookeeperLocatorParameters) : LocatorFactory {
        ZookeeperLocator.manager = new ZookeeperLocatorFatory(parameters);
        return ZookeeperLocator.manager.getLocatorForPath;
    };

    static DefaultLocatorTimeout : number = 2000;

    static DefaultSessionTimeout : number = 10000;

    static DefaultSpinDelay : number = 1000;

    static DefaultRetries : number = 3;

    static DefaultDataExtractor : DataExtractor = (data : string) : Location => {
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
    };
}


/**
 * ZookeeperLocatorFactory manages a zookeeper client connection as well as constructing
 * ZookeeperPathLocatorFactories for each path requests, passing them a handle to the zookeeper
 * client via ZookeeperClientWrapper
 */
class ZookeeperLocatorFatory extends EventEmitter {
    private client : zookeeper.Client;
    private clientWrapper : ZookeeperClientWrapper;
    private serverLocator : Locator;
    private discoveryPath : string;
    private dataExtractor : DataExtractor;
    private locatorTimeout : number;
    private sessionTimeout : number;
    private spinDelay : number;
    private retries : number;
    private strict : boolean;
    private pathLocatorFactories : { [key : string] : ZookeeperPathLocatorFactory};

    /**
     * given a path in a zookeeper cluster, return a Locator to resolve to a Location listed in that path
     * @param path
     * @returns {Locator}
     */
    getLocatorForPath = (path : string) : LocatorEmitter => {
        if (typeof path !== "string") {
            throw new TypeError("path must be a string");
        }
        if (path[0] !== "/") {
            path = "/" + path;
        }

        if (!this.pathLocatorFactories[path]) {
            this.pathLocatorFactories[path] = new ZookeeperPathLocatorFactory(
                this.clientWrapper,
                path,
                this,
                this.dataExtractor,
                this.locatorTimeout,
                this.strict
            );
        }

        return <LocatorEmitter>(<any>this.pathLocatorFactories[path].getLocator);
    };

    constructor(parameters : ZookeeperLocatorParameters) {
        super();
        let { serverLocator, path, dataExtractor, locatorTimeout, sessionTimeout, spinDelay, retries, strict } = parameters;

        this.serverLocator = serverLocator;
        this.discoveryPath = path;
        this.dataExtractor = dataExtractor ? dataExtractor : ZookeeperLocator.DefaultDataExtractor;
        this.locatorTimeout = locatorTimeout ? locatorTimeout : ZookeeperLocator.DefaultLocatorTimeout;
        this.sessionTimeout = sessionTimeout ? sessionTimeout : ZookeeperLocator.DefaultSessionTimeout;
        this.spinDelay = spinDelay ? spinDelay : ZookeeperLocator.DefaultSpinDelay;
        this.retries = retries ? retries : ZookeeperLocator.DefaultRetries;
        this.strict = strict == null ? true : strict;

        this.clientWrapper = new ZookeeperClientWrapper();
        this.pathLocatorFactories = {};

        // wire up wrapped event emitter to function getLocatorForPath to 'implement' the Locator interface
        // ugly, but this whole shared event emitter business sort of is :(
        // also, how only the zookeeper locator implements this :(
        Object.keys(EventEmitter.prototype).forEach((fnName) =>
            (<any>this.getLocatorForPath)[fnName] = this[fnName]
        );

        this.connect();
    }

    /**
     * Connect to the zookeeper cluster, rebuilding the client on session expired.
     */
    public connect = () => {
        this.serverLocator()
            .then((location) => {
                var zookeeperServer = location.host;
                if (location.port) {
                    zookeeperServer = zookeeperServer + ":" + location.port;
                }
                zookeeperServer = zookeeperServer + this.discoveryPath;

                if (this.client) {
                    this.client.removeAllListeners();
                    this.client = null;
                }

                this.client = zookeeper.createClient(zookeeperServer, {
                    sessionTimeout: this.sessionTimeout,
                    spinDelay: this.spinDelay,
                    retries: this.retries
                });

                this.clientWrapper.setClient(this.client);

                var disconnectedHandler = null;

                this.client.once("connected", () => {
                    this.emit(LocatorException.CODE.CONNECTED);
                    if (disconnectedHandler) {
                        clearTimeout(disconnectedHandler);
                    }
                });

                this.client.once("disconnected", (count : number) => {
                    this.emit(LocatorException.CODE.DISCONNECTED);

                    disconnectedHandler = setTimeout(() => {
                        this.client.close();
                        process.nextTick(() => {
                            this.client.emit("expired");
                        });
                    }, this.sessionTimeout);

                });
                this.client.on('state', (state : Object) => {
                    this.emit(LocatorException.CODE.STATE_CHANGE, state, this.client.getSessionId());
                });
                this.client.once("expired", () => {
                    this.emit(LocatorException.CODE.EXPIRED);
                    this.reconnect();
                });

                this.emit(LocatorException.CODE.CONNECTING);
                this.client.connect();
            })
            .catch((err) => {
                this.emit(LocatorException.CODE.ZK_LOCATOR_ERROR, err);
                this.connect();
            });
    };

    private reconnect = () => {
        if (this.spinDelay) {
            setTimeout(() => {
                this.connect();
            }, this.spinDelay);
        } else {
            this.connect();
        }
    };
}

/**
 * ZookeeperPathLocatorFactory provides Locators for a list of hosts stored in a path in a zookeeper cluster
 */
class ZookeeperPathLocatorFactory {
    private clientWrapper : ZookeeperClientWrapper;
    private path : string;
    private emitter : EventEmitter;
    private dataExtractor : DataExtractor;
    private locatorTimeout : number;
    strict : boolean;
    next : number;
    locationPool : Location[];
    cachedLocationPool : Location[];
    locationRequestQueue : Promise.Resolver<Location>[];
    stale : boolean;

    /**
     * zookeeper.client.getChildren response handler.  upon fetching the path we get a list of children nodes,
     * call getInfo on them, and store them in the location pool and kick of the location request processing queue
     * @param err
     * @param children
     */
    private onGetLocations = (err : Error, children : string[]) => {
        if (err) {
            this.emitter.emit(LocatorException.CODE.FAILED_TO_GET_CHILDREN, this.path, err);
            this.setLocationPool([]);
            this.processQueue();
            return;
        }

        const promises = children.map((child) => {
            const locator = deferredLocationRequest();

            this.clientWrapper.client.getData(this.path + "/" + child, (_err, data) => {
                if (_err) {
                    if (_err.getCode() !== zookeeper.Exception.NO_NODE) {
                        this.emitter.emit(LocatorException.CODE.FAILED_TO_GET_CHILD_INFO, this.path, _err);
                    }

                    locator.resolve(null);
                    return;
                }

                locator.resolve(this.dataExtractor(data.toString("utf8")));
                return;
            });
            return locator.promise;
        });

        Promise.all(promises)
            .then((newPool) => {
                this.setLocationPool(newPool.filter(Boolean));
                this.emitter.emit(LocatorException.CODE.NEW_POOL, this.path, this.locationPool);
                this.processQueue();
            }).catch((allErr) => {
                this.emitter.emit(LocatorException.CODE.FAILED_TO_GET_CHILDREN, this.path, allErr);
                this.setLocationPool([]);
                this.processQueue();
                return;
            });
    };

    /**
     * changed handler for zookeeper.client.getChildren method. when the list of locations change, fetch
     * the list of children and forward the event
     * @param event
     */
    private onLocationsChange = (event : Event) => {
        this.emitter.emit(LocatorException.CODE.CHILDREN_CHANGED, this.path, event);
        this.clientWrapper.client.getChildren(this.path, this.onLocationsChange, this.onGetLocations);
    };

    /**
     * zookeeper.client.exists handler to check and see that a location path exists in the zookeeper cluster
     * @param error zookeeper client error
     * @param stat zookeeper.Stat object with information about the zookeeper location path
     */
    private onLocationPathExists = (error : Error, stat : zookeeper.Stat) => {
        if (stat) {
            this.stale = false;
            this.emitter.emit(LocatorException.CODE.PATH_FOUND, this.path);
            this.clientWrapper.client.getChildren(this.path, this.onLocationsChange, this.onGetLocations);
        } else {
            this.stale = true;
            this.emitter.emit(LocatorException.CODE.PATH_NOT_FOUND, this.path);
            this.setLocationPool([]);
            this.processQueue();
        }
    };

    /**
     * get a location from zookeeper for this path. 'implements' the EmitterLocator interface
     * @returns {Bluebird<R>}
     */
    getLocator = () : Promise<Location> => {
        var locator = deferredLocationRequest();
        if (this.stale) {
            this.setLocationPool(null);
            this.clientWrapper.client.exists(this.path, this.onLocationPathExists);
        }

        if (this.locationPool) {
            this.resolveLocationRequest(locator);
        } else {
            this.locationRequestQueue.push(locator);
        }

        if (this.locatorTimeout) {
            setTimeout((() => {
                if (locator.promise.isPending()) {
                    locator.reject(new Error("ZOOKEEPER_TIMEOUT"));
                }
            }), this.locatorTimeout);
        }

        return locator.promise;
    };

    constructor (clientWrapper : ZookeeperClientWrapper,
                 path : string,
                 emitter : EventEmitter,
                 dataExtractor : DataExtractor,
                 locatorTimeout : number,
                 strict : boolean) {
        this.clientWrapper = clientWrapper;
        this.path = path;
        this.emitter = emitter;
        this.dataExtractor = dataExtractor;
        this.locatorTimeout = locatorTimeout;
        this.strict = strict;
        this.next = -1;
        this.locationPool = null;
        this.cachedLocationPool = null;
        this.locationRequestQueue = [];
        this.stale = false;

        clientWrapper.on('NEW_CLIENT', () => {
            this.setLocationPool(null);
            clientWrapper.client.exists(path, this.onLocationPathExists);
        });

        if (clientWrapper.client) {
            clientWrapper.client.exists(path, this.onLocationPathExists);
        }
    }

    /**
     * update the list of locations available at this path
     * @param newPool
     */
    private setLocationPool(newPool : Location[]) {
        this.locationPool = newPool;
        if (!this.cachedLocationPool || (newPool && newPool.length)) {
            this.cachedLocationPool = newPool;
        }
        return;
    }

    /**
     * get the list of locations if it exists or in strict mode, otherwise try the cached
     * list of locations
     * @returns {Location[]}
     */
    private getLocationPool() : Location[] {
        if (this.strict || (this.locationPool && this.locationPool.length)) {
            return this.locationPool;
        }
        if (this.cachedLocationPool && this.cachedLocationPool.length) {
            return this.cachedLocationPool;
        }
        return this.locationPool;
    }

    /**
     * resolve a location request with a location, or reject if the pool is empty or still loading
     * @param deferred
     */
    private resolveLocationRequest(deferred : Promise.Resolver<Location>) {
        var chosenPool = this.getLocationPool();
        if (!chosenPool) {
            return deferred.reject(Error("get next called on loading pool"));
        }

        if (chosenPool.length) {
            this.next++;
            return deferred.resolve(chosenPool[this.next % chosenPool.length]);
        } else {
            return deferred.reject(new Error(LocatorException.CODE.EMPTY_POOL));
        }
    }

    /**
     * process the queue of location requests for this zookeeper path
     */
    private processQueue() {
        while (this.locationRequestQueue.length) {
            this.resolveLocationRequest(this.locationRequestQueue.shift());
        }
    }
}


/**
 * ZookeeperClientWrapper is used to supply a zookeeper client
 * connection to each ZookeeperPathLocatorFactory by the ZookeeperLocatorFactory,
 * without having to update the references to the zookeeper client when it is replaced
 * due to expired session
 */
class ZookeeperClientWrapper extends EventEmitter {
    public client : zookeeper.Client;

    constructor() {
        super();
        this.client = null;
    }

    /**
     * Set the zookeeper client and emit an event in case anyone is watching
     * @param initialized client zookeeper client
     */
    public setClient(client : zookeeper.Client) {
        this.client = client;
        this.emit('NEW_CLIENT');
    }
}
