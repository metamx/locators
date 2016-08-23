# Locators: a simple service discovery library
Locators is a library to wrap various service discovery mechanisms into a unified promise based format. At it's core, it revolves
around the concept of `Location`s which are represented as a simple object with a `host` and `port` property, and `Locator`s, which 
are a function which return a `Promise<Location>`. Additionally, a locator implementation may optionally expose a `LocatorEmitter`
instead of a `Locator`, which is a `Locator` + `EventEmitter`.

There are currently three different locators, packaged in this library: `SimpleLocator`, `RequestLocator` and `ZookeeperLocator`. All locators
expose a single static method `getLocatorFactory` which may or may not take a configuration depending on the locator type, and returns a function
which can produce Locators that can be resolved in the normal promise flow. 
  
### SimpleLocator
`SimpleLocator` takes no configuration to it's factory creation method. 
It's locator takes a list of known servers and randomly returns one of the servers.

#### example
```typescript
import { SimpleLocator } from 'locators';
const simpleLocator = SimpleLocator.getLocatorFactory();
const locator = simpleLocator({
    resource: "localhost;koalastothemax.com:80",
    defaultPort: 8181
});
locator.then((location) => {
    console.log(location); // either { host: "localhost", port: 8181 } or { host: "koalastothemax.com", port: "80" }
});
```

### RequestLocator
`RequestLocator` takes no configuration to it's factory creation method.
It's locator method takes a remote http/https endpoint that returns a list of servers, 
and retrieves a list of servers and randomly returns one of the servers, 
and optionally a data extractor to properly translate the response into a `Location`. 
The `RequestLocator` has a default data extractor which expects the server to respond
with an object which has a `servers` property which is an array of objects which 
have `address` and `port` properties, since it was originally built to work with 
the [exhibitor](https://github.com/Netflix/exhibitor) api call 
`exhibitor/v1/cluster/list`[docs](https://github.com/Netflix/exhibitor/wiki/REST-Cluster).


#### example
```typescript
import { RequestLocator } from 'locators'
const requestLocator = RequestLocator.getLocatorFactory();
const locator = requestLocator({
    url: "http://www.test-endpoint.com:8080/list" // returns {"blah": [{"address": "localhost", "port": 8080}, {"address": "localhost", "port": 1234}]}
    dataExtractor: (data) => {
        location = JSON.parse(data).blah[1],
        return {
            host: location.address,
            port: location.port
        }
});
locator.then((location) => { 
    console.log(location); //returns { host: 'localhost', port: 1234 }
})
```

### ZookeeperLocator
`ZookeeperLocator` uses [zookeeper](http://zookeeper.apache.org) to find other services. 
For maximum dog-fooding, it's factory creation method takes a Locator for the zookeeper cluster. 
If you are using [exhibitor](https://github.com/Netflix/exhibitor), you can make use of its 
list api with the `RequestLocator`, or if the servers exist in dns, a list 
of hosts, or ip addresses, then with a `SimpleLocator`. It is built on top of 
[node-zookeeper-client](https://github.com/alexguan/node-zookeeper-client)

#### example
```typescript
import { SimpleLocator, ZookeeperLocator } from 'locators';
const simpleLocator = SimpleLocator.getLocatorFactory();
const zookeeperLocator = Zookeeper.getLocatorFactory({
    serverLocator: simpleLocator('localhost:2181')
    path: '/discovery'
    locatorTimeout: 2000
});
const locator = zookeeperLocator('my:service');
locator.then((location) => {
    console.log(location); // returns host and port from zookeeper localhost:2181 
});
```

The `ZookeeperLocator` implements the `LocatorEmitter` pattern

```
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
```
The codes emitted are exported as `EXCEPTION_CODE` from the library, i.e.
```
import { EXCEPTION_CODE } from 'locators';
import { ZookeeperLocator } from 'locators';

const zookeeperLocator = Zookeeper.getLocatorFactory({
    serverLocator: simpleLocatorFactory()('localhost:2181')
    path: '/discovery'
    locatorTimeout: 2000
});
const locator = zookeeperLocator('my:service');
locator.then((location) => {
    console.log(location); // returns host and port from zookeeper localhost:2181 
});
locator.on(EXCEPTION_CODE.EXPIRED, () => {
    console.log('expired');
});

```

## shorthand syntax
A shorthand syntax exists for using the locators provide by this library for legacy reasons, and can be used as such.

### SimpleLocator
#### example
```coffeescript
simpleLocatorFactory = require('locators').simple

locator = simpleLocatorFactory()({
    resource: "localhost;koalastothemax.com:80"
    defaultPort: 8181
})
locator.then((location) -> 
    console.log location #either { host: "localhost", port: 8181 } or { host: "koalastothemax.com", port: "80" }
)
```

### RequestLocator
#### example
```coffeescript
requestLocatorFactory = require('locators').request

locator = requestLocatorFactory()({
    url: "http://www.test-endpoint.com:8080/list" # returns {"blah": [{"address": "localhost", "port": 8080}, {"address": "localhost", "port": 1234}]}
    dataExtractor: (data) ->
        location = JSON.parse(data).blah[1]
        return {
            host: location.address
            port: location.port
        }
})
locator.then((location) -> 
    console.log location #returns { host: 'localhost', port: 1234 }
)
```

### ZookeeperLocator
#### example
```
zookeeperLocatorFactory = require('locators').zookeeper

zookeeperLocator = zookeeperLocatorFactory({
    serverLocator: simpleLocatorFactory()('localhost:2181')
    path: '/discovery'
    locatorTimeout: 2000
})
myServiceLocator = zookeeperLocator('my:service')
myServiceLocator.then((location) ->
    console.log location #returns host and port from zookeeper localhost:2181 
)
```


## Development
`npm run build` to compile.

The `ZookeeperLocator` test currently require a local installation of zookeeper to run successfully, specified
by the `zkServerCommandPath` variable which is defined near the beginning of the tests. 