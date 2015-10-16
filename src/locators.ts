
import { simpleLocatorFactory } from './simple';
import { requestLocatorFactory } from './request';
import { zookeeperLocatorFactory } from './zookeeper';
import { CODE } from './locatorException'

module locators {
    export var simple = simpleLocatorFactory;
    export var request = requestLocatorFactory;
    export var zookeeper = zookeeperLocatorFactory;
    export var EXCEPTION_CODE = CODE;
}
