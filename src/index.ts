
import {LocatorFactory} from "./common";
import { CODE } from './locatorException';
import { RequestLocator, RequestLocatorParameters } from './request';
import { SimpleLocator, SimpleLocatorParameters } from './simple';
import { ZookeeperLocator, ZookeeperLocatorParameters } from './zookeeper';

export * from './common';
export * from './locatorException';
export * from './simple';
export * from './request';
export * from './zookeeper';

// shorthand exports for legacy compatibility
export const simple : () => LocatorFactory = SimpleLocator.getLocatorFactory;
export const request : () => LocatorFactory = RequestLocator.getLocatorFactory;
export const zookeeper : (params : ZookeeperLocatorParameters) => LocatorFactory = ZookeeperLocator.getLocatorFactory;
export const EXCEPTION_CODE : typeof CODE = CODE;
