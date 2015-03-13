# Locators: a simple service locators 
There are three different locators packaged in this library: simple, request and zookeeper locators.

### simple locator
simple locator takes a list of known servers and randomly returns one of the servers.

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

### request locator
request locator takes a remote http/https endpoint and retrieves a list of servers and randomly returns one of the servers.

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

### zookeeper locator
zookeeper locator uses [zookeeper](http://zookeeper.apache.org) to find other services. It is different from other locators in that it takes a locator for zookeeper services as well. So that if you are using an [exhibitor](https://github.com/Netflix/exhibitor), you can make use of its list api.

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