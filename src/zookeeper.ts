import {EventEmitter} from "events";
import http = require("http");
import zookeeper = require("node-zookeeper-client");
import Promise = require("bluebird");

import {DataExtractor, Location, Locator, LocatorEmitter, LocatorFactory} from "./common";
import LocatorException = require("./locatorException");

function deferredLocationRequest() : Promise.Resolver<Location> {
    let resolve, reject;
    /* tslint:disable */
    const promise = new Promise<Location>(function() {
        resolve = arguments[0];
        reject = arguments[1];
    });
    /* tslint:enable */
    return {
        callback: null,
        promise,
        reject,
        resolve
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
    public static DefaultLocatorTimeout : number = 2000;
    public static DefaultSessionTimeout : number = 10000;
    public static DefaultSpinDelay : number = 1000;
    public static DefaultRetries : number = 3;

    private static manager : ZookeeperLocatorFatory;

    public static getLocatorFactory(parameters : ZookeeperLocatorParameters) : LocatorFactory {
        ZookeeperLocator.manager = new ZookeeperLocatorFatory(parameters);
        return ZookeeperLocator.manager.getLocatorForPath;
    }

    public static DefaultDataExtractor : DataExtractor = (data : string) : Location => {
        let zkJS : ZookeeperJS;
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

    private connected : boolean;
    private pathLocatorFactories : {[key : string] : ZookeeperPathLocatorFactory};

    constructor(parameters : ZookeeperLocatorParameters) {
        super();
        const { serverLocator, path, dataExtractor, locatorTimeout, sessionTimeout, spinDelay, retries, strict } = parameters;

        this.connected = false;
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
            ((this as any).getLocatorForPath)[fnName] = this[fnName]
        );

        this.connect();
    }

    /**
     * given a path in a zookeeper cluster, return a Locator to resolve to a Location listed in that path
     * @param path
     * @returns {Locator}
     */
    public getLocatorForPath = (path : string) : LocatorEmitter => {
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

        return ((this as any).pathLocatorFactories[path].getLocator) as LocatorEmitter;
    }

    /**
     * Connect to the zookeeper cluster, rebuilding the client on session expired.
     */
    public connect = () => {
        this.serverLocator()
            .then((location) => {
                let zookeeperServer = location.host;
                if (location.port) {
                    zookeeperServer = zookeeperServer + ":" + location.port;
                }
                zookeeperServer = zookeeperServer + this.discoveryPath;

                this.client = zookeeper.createClient(zookeeperServer, {
                    retries: this.retries,
                    sessionTimeout: this.sessionTimeout,
                    spinDelay: this.spinDelay
                });

                this.clientWrapper.setClient(this.client);

                let disconnectedHandler = null;

                this.client.on("connected", () => {
                    this.connected = true;
                    this.emit(LocatorException.CODE.CONNECTED);
                    if (disconnectedHandler) {
                        clearTimeout(disconnectedHandler);
                    }
                });

                this.client.on("disconnected", () => {
                    this.connected = false;
                    this.emit(LocatorException.CODE.DISCONNECTED);

                    disconnectedHandler = setTimeout(() => {
                        if (!this.connected) {
                            process.nextTick(() => {
                                this.client.emit("expired");
                            });
                        }
                    }, this.sessionTimeout);
                });
                this.client.on('state', (state : any) => {
                    this.emit(LocatorException.CODE.STATE_CHANGE, state, this.client.getSessionId());
                });
                this.client.once("expired", () => {
                    this.client.removeAllListeners();
                    this.connected = false;
                    this.client.close();
                    this.emit(LocatorException.CODE.EXPIRED);
                    this.reconnect();
                });

                this.emit(LocatorException.CODE.CONNECTING);
                this.client.connect();
            })
            .catch((err) => {
                this.connected = false;
                this.client.close();
                this.emit(LocatorException.CODE.ZK_LOCATOR_ERROR, err);
                this.connect();
            });
    }

    private reconnect = () => {
        if (this.spinDelay) {
            setTimeout(() => {
                this.connect();
            }, this.spinDelay);
        } else {
            this.connect();
        }
    }
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
    private strict : boolean;
    private next : number;
    private locationPool : Location[];
    private cachedLocationPool : Location[];
    private locationRequestQueue : Array<Promise.Resolver<Location>>;
    private stale : boolean;

    constructor(clientWrapper : ZookeeperClientWrapper,
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
     * get a location from zookeeper for this path. 'implements' the EmitterLocator interface
     * @returns {Bluebird<R>}
     */
    public getLocator = () : Promise<Location> => {
        const locator = deferredLocationRequest();
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
    }

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
                    if ((_err as any).getCode() !== zookeeper.Exception.NO_NODE) {
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
    }

    /**
     * changed handler for zookeeper.client.getChildren method. when the list of locations change, fetch
     * the list of children and forward the event
     * @param event
     */
    private onLocationsChange = (event : Event) => {
        this.emitter.emit(LocatorException.CODE.CHILDREN_CHANGED, this.path, event);
        this.clientWrapper.client.getChildren(this.path, (this as any).onLocationsChange, this.onGetLocations);
    }

    /**
     * zookeeper.client.exists handler to check and see that a location path exists in the zookeeper cluster
     * @param error zookeeper client error
     * @param stat zookeeper.Stat object with information about the zookeeper location path
     */
    private onLocationPathExists = (error : Error, stat : zookeeper.Stat) => {
        if (stat) {
            this.stale = false;
            this.emitter.emit(LocatorException.CODE.PATH_FOUND, this.path);
            this.clientWrapper.client.getChildren(this.path, (this as any).onLocationsChange, this.onGetLocations);
        } else {
            this.stale = true;
            this.emitter.emit(LocatorException.CODE.PATH_NOT_FOUND, this.path);
            this.setLocationPool([]);
            this.processQueue();
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
        const chosenPool = this.getLocationPool();
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
