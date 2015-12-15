
import { simpleLocatorFactory, SimpleLocatorParameters } from './simple';
import { requestLocatorFactory, RequestLocatorParameters } from './request';
import { zookeeperLocatorFactory, DataExtractor, ZookeeperLocatorParameters } from './zookeeper';
import { CODE } from './locatorException';

export var simple : typeof simpleLocatorFactory = simpleLocatorFactory;
export var request : typeof requestLocatorFactory = requestLocatorFactory;
export var zookeeper : typeof zookeeperLocatorFactory = zookeeperLocatorFactory;
export var EXCEPTION_CODE : typeof CODE = CODE;
