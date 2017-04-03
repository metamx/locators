export const LocatorEvents : any = {
    BAD_RESPONSE: "bad response",
    CHILDREN_CHANGED: "child list has changed",
    CONNECTED: "connected",
    CONNECTING: "connecting",
    DISCONNECTED: "disconnected",
    EMPTY_POOL: "child pool is empty",
    EXPIRED: "expired",
    FAILED_TO_GET_CHILDREN: "failed to get child list",
    FAILED_TO_GET_CHILD_INFO: "failed to get individual child's info",
    NEW_POOL: "got a new child pool",
    PATH_FOUND: "zookeeper path is found",
    PATH_NOT_FOUND: "zookeeper path is not found",
    STATE_CHANGE: "state",
    ZK_LOCATOR_ERROR: "failed to find zookeeper"
};

export const CODE = LocatorEvents;

const errorCodes : {[key : string] : string} = CODE;

export function create(code : string) : Error {
    return new Error(errorCodes[code]);
}
