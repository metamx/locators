
export const LocatorEvents : any = {
  BAD_RESPONSE: "bad response",

  // zookeeper locator specific code
  ZK_LOCATOR_ERROR: "failed to find zookeeper",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  STATE_CHANGE: "state",
  EXPIRED: "expired",
  CONNECTING: "connecting",
  FAILED_TO_GET_CHILDREN: "failed to get child list",
  EMPTY_POOL: "child pool is empty",
  FAILED_TO_GET_CHILD_INFO: "failed to get individual child's info",
  NEW_POOL: "got a new child pool",
  CHILDREN_CHANGED: "child list has changed",
  PATH_FOUND: "zookeeper path is found",
  PATH_NOT_FOUND: "zookeeper path is not found"
};

export const CODE = LocatorEvents;

const errorCodes : { [key : string] : string } =  CODE;

export function create(code : string) : Error {
  return new Error(errorCodes[code]);
}
