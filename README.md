### zookeeper(ZookeeperLocatorParameters)
Creates a locator that requests a service from Zookeeper which returns a path (a string that is formatted within ```manager()```) to the service. Also checks the connection and emits an event based on the status of the client.
##### Arguments
* ```parameters``` -  Provides information of type ```ZookeeperLocatorParameters``` about the specified Zookeeper locator. ```ZookeeperLocatorParameters``` is an interface for the locator that describes the client of the ```servers```.

##### Example
```javascript
var testLocator = {
    /* Initialize properties of the locator */
    
    servers: 'someString'; // Typically a URL 
    /* dataExtractor is initialized later in the function as an optional */
    locatorTimeout: 10000; // Time before locator fails. Can also be initialized as an optional. 
    sessionTimeout: 10000; // Time before an attempt to create a session times out
    spinDelay: 800; // Delay between retries
    retries: 3; // How many times it will attempt to reconnect after successive failures
};
zookeeperLocatorFactory(testLocator); // Returns path of the requested service
```
